# Submission intake service

Accepts a market from anyone, with no account, applies mechanical checks, and queues it.
It never decides whether a market belongs in the dataset — the batching agent turns the
queue into a pull request and a human decides there. See
[`docs/trd.md` §4](../docs/trd.md#4-the-submission-pipeline).

```bash
INTAKE_IP_SALT=$(openssl rand -hex 16) npm run intake
```

**Run it from the repository root.** `intake.config.json` and `data/markets.json` are both
resolved against the working directory: the config is read at import, so a service started
anywhere else dies immediately, and the dataset is read on the first submission, which is a
worse place to find out. In a unit file this is `WorkingDirectory=`.

Node 22 or newer. The npm scripts pass `--experimental-sqlite` — the default backend uses
the runtime's own `node:sqlite` rather than a dependency — and `--env-file-if-exists=.env`,
so a `.env` at the repository root is read when present and shrugged off when not.

The one-liner above mints a fresh salt every boot, which is fine for a trial and wrong for a
deployment: rotating the salt resets every rate-limit counter. Keep it in `.env`.

Two endpoints. `POST /submit` takes the form's JSON, capped at 64 KB, and `GET /health`
returns `{"ok":true}` for a probe or an uptime check. CORS is a wildcard on purpose rather
than out of laziness — no credentials are involved and the dataset is public, so any site
may host a submission form.

## Choosing a storage backend

One codebase, one switch — deliberately not two builds, because two builds of the same
service drift exactly like two copies of a schema do.

| Where you run it | `INTAKE_STORE` | Also set |
|---|---|---|
| A VPS or anything with a real disk | `sqlite` *(default)* | `INTAKE_DB_PATH` if not the working directory |
| A container **with a mounted volume** | `sqlite` | `INTAKE_DB_PATH` pointing at the mount |
| A container with **no** volume | `github` | nothing — it uses the token it already has |

**The middle row is the one people get wrong.** A container is fine with SQLite as long as
the file is on a volume; reach for `github` only when the platform gives you no persistent
disk at all. The first row is the one to aim for: a VPS, `sqlite`, and `INTAKE_DB_PATH` on a
disk that survives a redeploy. If you have a disk, you do not want the other backend.

SQLite runs in WAL mode, so the queue is three files — `intake.db` and its `-wal` and `-shm`
siblings. All three are gitignored; back up all three together, or use `sqlite3 .backup`.

**Why the second backend is the repository and not a database.** The queue is the one piece
of unrecoverable state here. Rate-limit counters resetting on redeploy is harmless; a
pending submission evaporating means somebody was told "received" and it was not true, and
nothing can rebuild it from the repo unless it was written there. So it is written there —
to a JSON file on a side branch, using the GitHub write access this service needs for pull
requests anyway.

That keeps a no-volume container **fully self-contained**: outbound HTTPS and nothing else.
No volume, no database, no account beyond the one that owns the repo, and a forker can run
it without signing up for anything. The cost is a commit and an API round trip per accepted
submission, and a write conflict when two arrive together — handled by optimistic
concurrency on the blob SHA, re-reading and retrying rather than clobbering, because losing
a concurrent submission is the exact failure this backend exists to prevent. Hard fails
never reach the store, so spam does not become commit noise.

One behavioural difference to know about. Under `sqlite` the rate-limit tick is recorded
before validation, so malformed payloads still cost the sender their quota — otherwise
spraying rubbish is free. The `github` backend records the tick as part of enqueueing, since
a commit per rate-limit tick would be absurd, so there only submissions that make it into
the queue count against the limit.

**Running this in a container?** `docker-compose.yml` and the `Caddyfile` in this repository
are a worked deployment of both rows above, with the image and Caddy in front. The runbook
that drives them on this project's own box is unpublished, along with its appendix on cutting
the image from ~1.3 GB to ~350 MB, and why
that is not the default.

**The failure this table exists to prevent:** SQLite on an ephemeral container filesystem is
recreated empty on every deploy. Pending submissions vanish, every rate-limit counter
resets, and *nothing errors* — the service looks healthy and quietly loses work. The startup
log prints the queue path for exactly this reason.

The queue is operational state, not a data tier. Market data lives in git whichever backend
you pick; losing this table loses only submissions not yet batched into a pull request.

## Configuration

Policy lives in [`intake.config.json`](../intake.config.json), committed on purpose:
changing a spam threshold should be a pull request someone can object to, not something that
happened on a server. Secrets and placement come from the environment.

| Variable | Required | Notes |
|---|---|---|
| `INTAKE_IP_SALT` | **yes** | Salt for hashing IP buckets. Rotating it resets rate limiting. Checked at boot by `assertServiceEnv()`, so a missing one stops the service starting — it used to be read lazily on the first submission, which meant a misconfigured container started, reported healthy, and only failed when somebody actually submitted. |
| `INTAKE_STORE` | no | `sqlite` (default) or `github`. Any other value is a startup error, never a silent fallback |
| `INTAKE_DB_PATH` | no | `sqlite` backend. Default `./intake.db`. **Must be persistent disk.** |
| `INTAKE_QUEUE_BRANCH` | no | `github` backend. Default `intake-queue`, cut from the base branch if absent |
| `INTAKE_QUEUE_PATH` | no | `github` backend. Default `intake-queue.json` |
| `INTAKE_TRUSTED_PROXY_HEADER` | behind a proxy | e.g. `CF-Connecting-IP` |
| `PORT` | no | Default 8787 |
| `GITHUB_TOKEN` | batching agent, and the `github` store | One repository, Contents and Pull requests write. The `sqlite` service itself never reads it. **It must not be able to merge into `GITHUB_BASE_BRANCH`** — protect that branch so a pull request and a review are required, or Contents write lets the service commit straight to the base branch and mint records no person ever read |
| `GITHUB_REPO` | no | Default `Black-Unicorn-Design-Studio/fresh-food-map` |
| `GITHUB_BASE_BRANCH` | no | Default `main`. What pull requests target, and what the queue branch is cut from |

The app finds this service through `EXPO_PUBLIC_INTAKE_URL`, which belongs to the app's build
environment rather than to the service. Anything prefixed `EXPO_PUBLIC_` is inlined into the
bundle, so it must never hold a credential. Unset, the Submit tab says submissions are not
set up on this build and points at the repository instead — which needs nothing running and
is the route every submission ends up taking anyway.

Retention is applied once, at startup: `retention_days.rate_limit` days of rate-limit rows,
`retention_days.rejected` days of rejected ones. Doing it on boot rather than on a timer
means it cannot silently stop running — and also means a process up for a month never prunes
again. The startup line reports what it removed.

### If you are behind a proxy, read this

`X-Forwarded-For` is set by the *client*. A service that reads it unconditionally can be
defeated by sending a different value per request, and every request then looks like a new
address — which is the usual way an IP rate limiter ends up decorative.

So it is **ignored unless** `INTAKE_TRUSTED_PROXY_HEADER` names a header your proxy is known
to overwrite. Behind Cloudflare that is `CF-Connecting-IP`. Unset, only the socket address
is trusted, which is correct for a service reachable directly. The startup log tells you
which mode you are in. When the header is trusted, the *rightmost* value is taken: a proxy
appends, so anything a client injected sits to the left of it.

IPv6 is bucketed by `/64` — a household is routinely handed a whole one, so limiting per
address would give one person unlimited attempts. Buckets are stored hashed: equality is all
a limiter needs, and retaining a record of who submitted what from where is not something
this project's privacy stance supports.

## What the checks do

**Hard fails are dropped without a trace — nothing tallies them. Soft holds are queued
and flagged.** Never the
reverse: a wrong soft hold costs a reviewer ten seconds, a wrong hard fail is a silent
deletion nobody ever sees. So the hard list is short and boring.

| Hard — dropped | Soft — queued, flagged |
|---|---|
| honeypot field filled | no website |
| submitted faster than `min_seconds_to_submit` | no schedule |
| same name, case-insensitive, within `dedupe.radius_m` of an existing market | a *different* market within that radius |

Both thresholds are config: two seconds, and 100 m to match `scripts/validate-data.ts`,
which rejects same-name-within-100m at merge time. Catching that at intake means the
submitter is not waiting on a pull request nobody can fix.

**Every one of these outcomes returns the same `202 {"status":"received"}`.** A hard fail is
deliberately indistinguishable from an accept: telling a bot which check it tripped is
telling it how to pass next time, and a person who somehow trips one can still open a pull
request.

Two things that happen *before* the checks do answer honestly, because there the sender is a
form and not a bot:

- **429** when the bucket is over `rate_limit` — 5 an hour, 20 a day — with a message
  pointing at `data/markets.json`. This is checked before the body is even read.
- **422** with field-level issues when the payload does not match the submission schema, so
  the form can put each message next to its input.

Flags are filtered through `flag_for_review`, so removing a name from that list silences the
flag without changing whether the submission is queued. That list also names
`unreachable_website`, which nothing produces — no check fetches a submitted URL.

The dataset both duplicate checks compare against is read once and cached in the process.
After a batch merges, restart the service or it keeps deduplicating against the older file.

A submitter supplies facts about a market and never its provenance, so `id`, `source`,
`source_ref` and `active` are absent from the submission schema and stripped if sent.
Accepting `source` from the wire would let anyone label their own submission a state portal
import, which is a false attribution in a dataset published under ODbL.

## Running the batching agent

```bash
GITHUB_TOKEN=… npm run intake:batch
```

One shot. There is no daemon and no scheduler in this repository — run it by hand, or from
cron or a systemd timer at whatever cadence the volume deserves. It takes the oldest
`batch_size` pending submissions (5), and if there are none it prints `nothing pending` and
exits 0.

**One open batch at a time.** If a pull request from a previous batch is still open against
`GITHUB_BASE_BRANCH`, the agent says so, leaves the submissions queued and opens nothing:

```
#7 is still open; leaving 3 submission(s) queued. Merge or close it and run again.
```

That is not caution for its own sake. Every batch branches from the base and appends to the
same `data/markets.json`, so two outstanding pull requests always conflict — whichever merges
second goes stale, and the reviewer who did nothing wrong resolves it. Closing the loser is
worse than the conflict: those rows are already `batched` and carry that pull request's URL,
so the agent never offers them again and accepted submissions disappear with no trace on any
screen. **Never close a batch pull request you have not merged** — edit it down to nothing
instead if you want none of it, so the rows stay accounted for.

Waiting costs nothing: the rows stay `pending` and the next run takes them. It also means no
reviewer is ever under time pressure to merge before the next batch lands on top of them. The
longer-term answer is a merge driver that unions `data/markets.json` by id, since that is the
only correct resolution for appended records; until then the agent declines to propose a
conflict.

Only batch branches count — a pull request whose head does not start with `intake/batch-` is
somebody else's work and does not hold up the queue.

What one run produces:

1. **A feature per submission.** The submitter supplied facts; everything else is assigned
   here — a fresh UUID, `source: "community"`, `source_ref: null`, `active: true` — without
   exception.
2. **A validated collection.** `data/markets.json` is read from the base branch, the
   features appended, and the whole thing re-checked against the same schema CI uses. If it
   would not pass, the agent throws and opens nothing: a pull request that fails CI spends a
   reviewer's time on a problem the submitter cannot fix.
3. **A branch, a commit, a pull request.** Branch `intake/batch-<date>-<8 hex>`, one commit
   to `data/markets.json`, one pull request against `GITHUB_BASE_BRANCH`. The body lists
   what was flagged and why, quotes submitter notes as review context — the `note` field is
   never published — and says plainly that merging is the check, so nobody merges expecting
   a later pass to catch what they missed.
4. **The queue updated.** Batched rows carry the pull request URL: under `sqlite` their
   status becomes `batched`, under `github` they leave the queue file.

It prints the pull request URL on success and exits 1 with the failure on anything else.
Nothing in it is a judgement — it accepts and flags, and the only things it refuses were
already refused at intake by checks that essentially cannot false-positive. The gate is the
merge, the merge is a person, and the merge is the check
([TRD §3](../docs/trd.md#3-what-merging-means)).

This is not a sketch: the pipeline has already opened and merged a pull request adding three
markets to the dataset.
