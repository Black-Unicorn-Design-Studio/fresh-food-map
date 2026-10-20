# Contributing

Thanks for looking. Before anything else, there's an unusual arrangement here that you
should know about up front, because it affects what happens to work you contribute.

## Read this first: what this repository is

**This repository is a downstream publication, not the primary development line.**

Fresh Food Map is developed privately and published here under the AGPL. Builds distributed
through app stores are produced from that private line, and can contain only code the
maintainer owns outright.

The consequence for you is direct and worth stating without dressing it up:

> **Code you contribute here will not appear in any published app.**

Not "probably won't", not "eventually might". A published build can only contain code the
maintainer is free to relicense, and your contribution stays yours. So a patch you land here
improves the public source, and improves it for anyone who forks it — but a published app is
built from a different line, and your fix is not in it unless the maintainer independently
writes an equivalent one.

There is no CLA, and that is a deliberate trade in both directions. **You keep your
copyright**, and the maintainer gets no right to relicense your work or take it anywhere you
did not put it. The flip side is that they also cannot ship it.

If that arrangement is not one you want to contribute under, that is a completely reasonable
conclusion, and better reached now than after you have written the patch. Forking is a fully
supported option — see [Forking](#forking) below.

One consequence worth naming rather than discovering: distributing a copyleft app through
the Apple App Store is a rights question before it is a build question, because the
Developer Program agreement imposes EULA terms that sit awkwardly with AGPL §10. The
[README](README.md#distributing-to-app-stores) sets out where that stands. Nothing about it
restricts running, modifying, hosting or forking this code — see [Forking](#forking).

## What actually reaches users

Two things do, and they're the most valuable contributions here:

**Market data.** `data/markets.json` is the point of this project. It's licensed
separately from the code (ODbL, see [`REUSE.toml`](REUSE.toml)), it isn't
copyright-encumbered the way source is, and it flows freely in both directions. A market
you add or correct reaches every user of every build. **If you want your contribution to
matter, contribute data.**

That file is now the whole data tier — there is no database and no accounts, and the
canonical description of that is [TRD §2](docs/trd.md#2-the-dataset-is-the-product), which
is worth reading before you touch anything here. The practical consequence for a
contributor is short: **every data change is a pull request, and merging it both publishes
the change and is the only check it gets.** Mechanics are under
[Submitting market data](#submitting-market-data) below.

**Bug reports.** A clear report of something broken is worth a great deal, because the
reproduction is the scarce part and the fix rarely is. Reproduction steps, what you
expected, what happened.

Documentation, typo fixes and translations land here too, and help everyone reading the
project or forking it.

## Forking

Fork it. That's the licence working as intended, and nothing about the arrangement above restricts you.

Under AGPL-3.0-or-later you may run it, modify it, host it, and charge money for it. What
you must do is publish your source — including to the users of a hosted instance, which is
what the AGPL's network clause is for. You can't take it closed; only the copyright holder
can do that, which is exactly the asymmetry that keeps this project's code open no matter
what happens to the project.

Two practical notes for a serious fork:

- **Set `EXPO_PUBLIC_SOURCE_URL`** to your own repository. The app links to its own source
  from the list screen, and pointing it upstream would send people to code that isn't what
  you shipped. That variable reaches the list screen and nothing else: the Submit tab's
  fallback card — the one a build without `EXPO_PUBLIC_INTAKE_URL` shows — links to *this*
  repository from a URL hardcoded in `src/app/(tabs)/submit.tsx`, so a fork that hasn't
  deployed its own intake service should edit that line too, or its users open their data
  pull requests here rather than against your dataset.
- **The name and the mark are not licensed.** Copyright licences don't grant trademark
  rights. Call your fork something else.

## Sign your commits (DCO)

Every commit needs a `Signed-off-by` line:

```bash
git commit -s -m "fix: correct the Saturday hours for Dane County"
```

**Data-only pull requests are exempt.** A change that touches nothing but `data/` needs no
sign-off: the DCO is a statement about copyright in contributed *code*, and market records
are facts under ODbL. That also means someone correcting a market's opening hours does not
have to learn what a DCO is. A pull request that mixes data and code is not exempt.

That's the [Developer Certificate of Origin](https://developercertificate.org/) — you're
certifying you wrote the change, or otherwise have the right to submit it under this
project's licence. It is *not* a copyright assignment and it grants no relicensing rights.
It exists so provenance is traceable.

## Before you open a pull request

```bash
npm run typecheck     # tsc --noEmit, strict
npm run lint          # ESLint (expo config)
npm run validate-data # schema-checks data/markets.json
npm test              # unit suite (node:test via tsx)
npm run build:web     # the static export a deploy serves
```

CI runs all five on every pull request, with one difference in the last: it runs the bare
`expo export -p web`, because copying the dataset into `public/` is a deploy step rather
than a build step and nothing in CI exercises it ([TRD §8](docs/trd.md#8-testing-and-ci)).
Locally, run the npm script anyway — `expo export` on its own leaves `public/markets.json`
at whatever it was, so a deploy built that way serves a stale dataset from a URL that looks
current. The export is in the list at all because it is the thing a deploy actually serves,
and a broken build is worth catching here rather than on the host during a launch. The
sign-off check above runs in CI too, on anything that isn't a data-only change.

`npm test` needs nothing configured: no network, no service, no env, and no clock — anything
time-dependent takes "now" as an argument. It covers the pure logic guarding the project's
promises: the shared schema, the intake checks that must never auto-reject, the batching
agent's provenance, IP bucketing, the service's boot-time environment check, the submit
form's error routing, and the discovery logic behind both screens — distance and tag
filtering, the list's `isOpenNow`, and the box the map fits its camera to when you press
NEAR ME (`boundsAround`). It does **not** render anything; there are no component tests, and
browser behaviour is checked by driving the app with Playwright during development rather
than in CI ([TRD §8](docs/trd.md#8-testing-and-ci)). A single file runs with
`node --experimental-sqlite --import tsx --test test/checks.test.ts`.

If you change logic in `src/lib/` or `server/`, add a case. Name the test after the promise
being kept, not "it works".

**Commit messages** follow [Conventional Commits](https://www.conventionalcommits.org/):
`feat:`, `fix:`, `data:`, `docs:`, scope optional. Dataset changes go in `data:`-prefixed
PRs so they're easy to review as data rather than as code.

**Conventions worth reading before you write code:** [`CLAUDE.md`](CLAUDE.md) is the terse
version — the rules that bite. [`docs/style-guide.md`](docs/style-guide.md) covers design
tokens and code conventions, [`docs/trd.md`](docs/trd.md) the architecture. Never hardcode
a colour or a spacing value; everything comes from `src/constants/theme.ts`.

## Submitting market data

Two routes in, and both end in the same place: a pull request against `data/markets.json`,
reviewed on GitHub. There is no separate review tool and no account to make — review *is* the
pull request, and merging is the gate and the check.
[TRD §4](docs/trd.md#4-the-submission-pipeline) describes the pipeline.

**Through the Submit tab**, if you'd rather not touch the repository. The form posts to
the intake service in [`server/`](server/README.md), which validates the submission
mechanically — schema, honeypot, timing, rate limit — and queues it; a batching agent turns
the queue into a pull request for a human to read. The agent auto-accepts and never
auto-rejects: anything it's unsure about still reaches the PR, flagged with a reason, and
only hard failures are dropped. Nothing it accepts is published without a human merging it.
No account, at either end.

That route needs a service to post to, so it depends on the build:
`EXPO_PUBLIC_INTAKE_URL` supplies the address, and a build without one — a fresh checkout,
or a fork that hasn't deployed the service — says so on the tab and points you at the
repository instead.

**Through a pull request**, which is the direct route and the one that always works:

1. Add or edit the feature in `data/markets.json`. Every property key must be present even
   when the value is empty — `website`, `source_ref` and `season_start`/`season_end` are
   required keys with nullable values, `tags` is required too (`[]` is fine), and a
   hand-written record still carries `source` (`"manual"` when you typed it in yourself)
   and `active: true`. `source` is provenance for the collection-level ODbL credit and
   nothing more: no value of it means better-checked than another, and nothing in the app
   shows it per record ([TRD §3](docs/trd.md#3-what-merging-means)). The schema is
   [TRD §2](docs/trd.md#2-the-dataset-is-the-product); the enforcement is
   `scripts/validate-data.ts`. A new market needs a fresh UUID in `id` — it's the handle
   every later edit hangs off, so it never changes once merged.
2. **Say in the pull request how you know.** You stood there on a Saturday, you phoned the
   market manager, you read the market's own site — whichever it was, write it down.
   Merging is this project saying a person checked it, so the pull request body is the only
   place that check is ever recorded; there is no field to flip afterwards and no second
   state a listing can earn ([TRD §3](docs/trd.md#3-what-merging-means)).
3. Run `npm run validate-data`. It fails on a duplicate id, on two markets sharing a name
   within ~100m, on a season with only one end set, and on any property key the schema
   doesn't have — the property schema is strict, so a stray key (a `verified` copied off an
   old record, say) is a loud error rather than a silent strip.
4. Prefix the commit and PR `data:`, so it can be reviewed as data rather than as code.

**Hours are read, not just printed.** The list screen's `OPEN NOW` toggle evaluates
`schedule` against the reader's own device clock, and a record carries no timezone — so a
market in another zone is judged by the wrong one. That is a known limit of the dataset, not
something to compensate for in a record: write local opening times as they are posted at the
market. Two consequences for what you write. A market with an empty `schedule` is never
open, so it drops out of that filter rather than showing up as a maybe — hours are worth
chasing. And a season whose `season_end` falls *before* its `season_start` reads as a wrap
around the new year, which is how a November-to-March winter market is written rather than a
mistake the validator will catch.

**Data pull requests never automerge.** Nothing here merges on green, and nothing should be
wired to: a passing check says a record is well-formed, not that the market exists. The
deliberate human merge is the entire mechanism behind "merging is the check", and it is the
one thing a data-only PR's lighter path (no sign-off, above) must not also shorten.

**Tags are a closed vocabulary.** `tags` is a required key on every market (use `[]` if
none apply), and the permitted values live in `src/constants/tags.ts`, which the validator
imports — so CI rejects anything outside the list rather than letting `producer-owned`,
`producer_owned` and `Producer Owned` become three facets for one thing. Tagging an
existing market is an ordinary `data:` PR. *Adding a value to the vocabulary* is a
separate PR against that file, and a bigger conversation: read the note at the top of it
first, because a tag has to be checkable from a market's own listing and mustn't restate a
field the schema already has. A new value needs its `TAG_LABELS` entry and its one-line
`TAG_DESCRIPTIONS` gloss alongside it — both are `Record<MarketTag, string>`, so typecheck
fails without them — and write that gloss for a shopper, since the detail screen prints it
under the tag on every market carrying it.

One thing worth saying plainly: whichever route you take, what you write is headed for a
public pull request in a public repository. Don't put anything in a submission you wouldn't
want published.

## Licence

Code here is AGPL-3.0-or-later. Market data is ODbL. See [`REUSE.toml`](REUSE.toml) for
which is which, and the [README](README.md#license) for what copyleft does and doesn't
reach — in short, it reaches code, and never a forker's queue, their review decisions, or
their configuration.
