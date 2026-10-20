# 🧺 Fresh Food Map

An open-source app for finding farmers markets near you — iOS, Android, and web from one
Expo codebase, built to run on **almost nothing**: a static site, keyless map tiles, and a
dataset in git instead of a database.

**The app runs at `staging.freshfoodmap.app`**, and `freshfoodmap.app` sends browsers there
until a production deployment exists. The web build is a static export (`npm run build:web`)
and also runs locally with no backend, no env and no keys.

**It is a map of farmers markets, and that is all it is.** Three tabs — map, list, submit —
one dataset, and a submission pipeline that ends in a pull request.
[docs/trd.md](docs/trd.md) is the canonical description of the architecture — read it before
changing anything here. The short version:

- **Markets** live as open data in [`data/markets.json`](data/markets.json) — versioned in
  git, bundled with the app, served from a CDN, forkable by anyone. It is the **only** data
  tier ([TRD §2](docs/trd.md#2-the-dataset-is-the-product)).
- **No accounts.** No sign-in, no sign-up, no sessions, no roles, no database of users.
  Nobody ever needed an account to find a market, and submitting one doesn't need an account
  either.
- **A pin opens a summary, not a new screen.** Pressing a market on the map shows a card
  anchored to that pin — name, town, whether it is open now, the week strip and any tags —
  with `VIEW DETAILS` for the full screen. The map keeps the camera and the filters you set.
- **Tags filter the list and the map.** Markets carry `tags` from a closed vocabulary
  ([`src/constants/tags.ts`](src/constants/tags.ts)), and both screens filter on them from
  one `TagFilter` component, so neither can narrow to something the other cannot reach.
- **Open now is the first filter on both screens**, sharing one switch between the map and
  the list. `isOpenNow()` checks a market's day, hours and season against the *market's* own
  clock — every record carries an IANA timezone, so a market three zones away is judged where
  it stands rather than where you are. No hours listed means never open, and there is no
  "open this weekend".
- **Submissions become pull requests.** The intake service in [`server/`](server/) validates
  mechanically and a batching agent turns the queue into a PR; humans review on GitHub, and
  merging is the gate and the check ([TRD §4](docs/trd.md#4-the-submission-pipeline)). You can
  skip the whole pipeline — opening a pull request against the file yourself is the route that
  always works, and it is the reason the data lives in git.
- **Merging is the check.** A market is in the file because a person read the pull request and
  merged it. There is no separate verified state, no verification UI, and no account system that
  would gate one ([TRD §3](docs/trd.md#3-what-merging-means)).
- **Maps** are MapLibre + [OpenFreeMap](https://openfreemap.org) tiles: no API keys, no billing account.

Design docs live in [`docs/`](docs/): [PRD](docs/prd.md) · [TRD](docs/trd.md) ·
[Style guide](docs/style-guide.md). The intake service documents itself in
[`server/README.md`](server/README.md).

The look is "market-stand editorial" — [Fraunces](https://fonts.google.com/specimen/Fraunces)
display type, a kraft-and-market-green palette, and a week-strip schedule glyph. Every map
pin is the same green sprout: the pin's job is to say *market*, and the tags say what kind.
Tokens and rules live in the style guide; all colors and spacing come from
`src/constants/theme.ts`.

## Quick start

```bash
git clone https://github.com/Black-Unicorn-Design-Studio/fresh-food-map && cd fresh-food-map
npm install
npm run web
```

That is the whole setup. **No backend, no `.env`, no keys** — the map, the list and the
detail screen read the dataset bundled at build time, and the tiles need no account. If
markets appear, your environment is correct and you can start working. Node 22 (`.nvmrc`,
and what CI uses): `npm test` and the intake service both want `node:sqlite`.

The **Submit** tab is the only screen that wants something running, and with nothing
configured it doesn't pretend otherwise: `EXPO_PUBLIC_INTAKE_URL` unset means the tab says
submissions aren't set up on this build and points you at the repository instead — the route
every submission ends up taking anyway. Set it if you want to exercise the form end to end.

### Running on iOS/Android

The MapLibre native module isn't in Expo Go, so both platforms need a development build —
which is what the `ios`/`android` scripts do (`expo run:*`, not `expo start`):

```bash
npm run ios       # or: npm run android
```

iOS needs **Xcode 26.4 or newer** ([the SDK 57 support
table](https://docs.expo.dev/versions/v57.0.0/)). On anything older the build fails compiling
`expo-modules-jsi` with `'weak' must be a mutable variable` — repeated across a dozen or so
files under `node_modules/`, which reads like a corrupt install and is not one. Check
`xcodebuild -version` before touching dependencies; reinstalling them cannot fix it.

A freshly updated Xcode also needs `sudo xcodebuild -runFirstLaunch` and its own simulator
runtime (`xcodebuild -downloadPlatform iOS`) — it ships an SDK but no runtime to match, and
it will not fall back to an older one, so every destination is rejected until that lands.

**If the app builds cleanly and then dies the instant it launches**, with
`dyld: Library not loaded: @rpath/React.framework/React` and `signal 6`, the pods are in a
split state and `npm run ios` now refuses to build until it is fixed
([`scripts/verify-ios-link.sh`](scripts/verify-ios-link.sh)). React Native decides whether to
use its prebuilt core by running `curl` against Maven during `pod install`; anything but a
literal `200` — a DNS blip, a proxy, a redirect it does not follow — and it builds from
source as static libraries, prints one line, and exits 0. Expo's precompiled modules do not
follow it down, because they gate on the *request* (`RCT_USE_PREBUILT_RNCORE`) rather than
the outcome, and their xcframeworks ship inside npm so they need no network at all. You end
up with six Expo frameworks loading a `React.framework` that nothing built. Xcode reports no
error because the static linker never chases a framework's own transitive `@rpath` loads.
The fix is `cd ios && rm -rf Pods Podfile.lock && pod install`, checking for
`[ReactNativeCore] Building from source: false`; if the probe keeps failing, break the
coupling instead with `expo-build-properties` and `ios.usePrecompiledModules: false`.

## Running the intake service

Optional. Nothing in discovery depends on it — it exists so somebody can add a market
without touching git. Two processes: an HTTP endpoint that validates and queues, and a
batching agent that turns the queue into a pull request. Neither publishes anything;
merging does.

```bash
# 1. the endpoint — Node 22+, for node:sqlite
INTAKE_IP_SALT=$(openssl rand -hex 16) npm run intake

# 2. point the app at it, in another shell
echo 'EXPO_PUBLIC_INTAKE_URL=http://127.0.0.1:8787' >> .env && npm run web

# 3. drain the queue into a pull request
GITHUB_TOKEN=<repo-scoped token> npm run intake:batch
```

Both scripts read `.env` when it exists, so those variables can live there instead of on the
command line. `INTAKE_IP_SALT` is required and salts the hashed IP buckets the rate limiter
counts — it is checked at boot, so a service missing it refuses to start rather than
reporting healthy and failing on the first person to submit. The batching agent needs a
token with Contents and Pull requests write on one repository, and that token is the only
secret this project has.

Policy — batch size, rate limits, dedupe radius, the flag list — lives in
[`intake.config.json`](intake.config.json), committed on purpose: changing a spam threshold
should be a pull request someone can object to, not something that happened on a server.
The storage backends (SQLite by default, or a branch in the repo when the host gives you no
persistent disk), the proxy-header trap, and what each check does are in
[`server/README.md`](server/README.md).

## Scripts

| Command | What it does |
|---|---|
| `npm start` / `npm run web` | Start the app. `web` needs nothing configured. |
| `npm run ios` / `npm run android` | Native development builds (`expo run:*`) — MapLibre isn't in Expo Go. |
| `npm run typecheck` | TypeScript, strict. |
| `npm run lint` | ESLint (expo config). |
| `npm run validate-data` | Check `data/markets.json` against the schema (runs in CI). |
| `npm test` | Unit suite — `node:test` via tsx. No network, no env, no service (runs in CI). |
| `npm run build:web` | Copy the dataset into `public/` and export the static web build to `dist/`. |
| `npm run intake` | Run the submission intake endpoint. Needs `INTAKE_IP_SALT`; see [`server/README.md`](server/README.md). |
| `npm run intake:batch` | Turn queued submissions into a pull request. Needs `GITHUB_TOKEN`. |
| `node scripts/gen-icons.js` | Regenerate app icon/splash/favicon from the Fraunces font (needs `npm i --no-save opentype.js@1.3.4 sharp`). |

## How data flows

Everything that changes the dataset arrives the same way — as a pull request against
`data/markets.json`:

```
a submission ──▶ intake service ──▶ queue ──▶ batching agent ──┐
an ingest script (not built) ─────────────────────────────────┤
you, editing the file ────────────────────────────────────────┤
                                                              ▼
                                                       a pull request
                                                              │
                                                     review and merge
                                                              ▼
                                            data/markets.json (in git)
                                                              │
                                                       bundled + CDN
                                                              ▼
                                                            the app
```

Merging **publishes** a market, and merging is the only check it gets. Nothing else does, and
no human decision happens on a server: the intake service only validates mechanically —
schema, honeypot, timing, per-IP rate limit — and every judgement call happens on GitHub, so
reviewing is never gated on server access. The agent auto-accepts but **never auto-rejects**;
accepted and uncertain submissions both reach the PR, the uncertain ones flagged with a
reason. The reasoning, and the properties that design is protecting, are in
[TRD §4](docs/trd.md#4-the-submission-pipeline) — read it there rather than here.

**You can skip the pipeline entirely.** The dataset is a file in a repository, so adding or
correcting a market is an ordinary pull request: edit `data/markets.json`, run
`npm run validate-data`, open a `data:`-prefixed PR. CI runs the same check — the schema,
duplicate ids, and same-name-within-100m records. Every property key has to be present,
`tags` included (`[]` is fine); a tag outside the vocabulary in
[`src/constants/tags.ts`](src/constants/tags.ts) fails the check, which is what keeping the
set closed is for. That route isn't a workaround — it's the reason the data lives in git,
and it is what makes every failure in the pipeline recoverable by a human with an editor.

Every record in `data/markets.json` got there through a merged pull request — that review is
the check, and there is no second state a listing can earn ([TRD §3](docs/trd.md#3-what-merging-means)).
Every record does carry a `source` naming where the data came from — provenance for whoever
reviews the next edit to it, not a grade, and not shown per record in the app. The dataset is
ODbL, so credit is given for the collection: one line under the list
([`src/components/attribution.tsx`](src/components/attribution.tsx)).

## Contributing

**Read [CONTRIBUTING.md](CONTRIBUTING.md) first** — this repository is a downstream
publication of a private development line, and code contributed here does not appear in the
published app. That's an unusual arrangement and it's stated plainly there rather than left
to be discovered. There is no CLA either: the copyright in what you write stays yours. Market
data is the contribution that does reach users.

- `npm run typecheck && npm run lint && npm run validate-data && npm test` before pushing;
  CI also runs the web export (`npx expo export -p web`), so run `npm run build:web` too if
  you touched anything the export sees — same export, plus the dataset copy.
- Commits need a DCO sign-off (`git commit -s`). Data-only PRs are exempt.
- Dataset changes go in `data:`-prefixed PRs; CI validates the schema and catches duplicates.
- **v1 is a tag, not a branch**, cut from `main` — which is what has been reviewed.
- **Work happens on a feature branch**, reaches `staging` by pull request, and `main` only
  after review. `main` is protected and takes no direct pushes. Minor changes — a copy tweak,
  a stale comment, a one-liner — may go straight onto `staging`, never onto `main`.
- See [docs/trd.md](docs/trd.md) for architecture and [docs/style-guide.md](docs/style-guide.md)
  for design tokens and code conventions.

## Not built yet

Things a reader might reasonably expect to find and won't:

- **Pin clustering.** Above roughly 200 points in the viewport the map will need it
  ([TRD §9](docs/trd.md#9-budgets)). It isn't there.
- **Ingestion normalizers.** [`scripts/ingest/README.md`](scripts/ingest/README.md) holds
  the plan and the contract, and records why the USDA portal was ruled out as a source. The
  markets in the file today were hand-assembled or submitted.
- **A service worker.** A manifest sits in `public/`, nothing links it, and no worker is
  registered — so the web build is not installable ([TRD §6](docs/trd.md#6-platform)).
- **Component or rendering tests.** `npm test` is 312 cases across twelve files over the pure
  logic — the shared schema, the intake checks, the batching agent's provenance, the
  service's boot-time env check, IP bucketing, the geocoder's caching and rate limiting, the
  distance, tag and open-now logic both screens share, the submit form's per-day hours and its error routing,
  the sprout mark's geometry, the map callout's placement and the correction-issue URL
  — and CI runs it beside typecheck, lint, dataset validation, the web export and the DCO
  check. Nothing mounts a screen, and browser behaviour is checked by driving
  the app with Playwright during development rather than in CI
  ([TRD §8](docs/trd.md#8-testing-and-ci)).
- **Store builds.** [`eas.json`](eas.json) is configured (see [Store builds](#store-builds))
  but nothing has been built or submitted yet; the `npm run ios` / `npm run android` dev
  builds are the mobile story today. The app identifies as `app.freshfoodmap` on both platforms
  (`ios.bundleIdentifier` and `android.package`), replacing the `com.anonymous.*` placeholder
  `expo prebuild` invents — that string becomes permanent the moment a first store submission
  lands, so it wanted a name someone owns before anything shipped. `ios/` is gitignored and regenerates
  from `app.json`, and `expo prebuild` has since been re-run, so the Xcode project carries
  that identifier too. A device still holding a build made under the placeholder sees the
  renamed app as a different one and installs it alongside rather than over — delete the old
  icon by hand.

[docs/prd.md](docs/prd.md) is the one place feature status is tracked — check there rather
than here if this reads stale.

## Deployment

**There is no production deployment yet.** The staging box serves the app at
`staging.freshfoodmap.app`, and also answers for `freshfoodmap.app` and `www`, because that is
the name the store builds are compiled against: there it serves `/markets.json` and
`/intake/*` itself and sends everything else to staging with a `308`. The app's own paths are
served rather than redirected because a redirected `POST` is not portable — Android's HTTP
client will not follow one — so an installed app would lose its form. When production is set
up, the store builds already point at it and need no rebuild.

| Piece | Where |
|---|---|
| Web | **Staging only**, at `staging.freshfoodmap.app`; `freshfoodmap.app` redirects there. Intended for production: `freshfoodmap.app`, from any static host: `npm run build:web`, publish `dist/`. A static export, not an installable PWA — no service worker ships. |
| Dataset CDN | `https://freshfoodmap.app/markets.json`, served by the staging box from the `staging` branch's dataset. `build:web` copies `data/markets.json` into `public/`, and `EXPO_PUBLIC_DATA_URL` points at that URL for over-the-air data updates. Unset, which is the default for a local build, means bundled-only — a working app rather than a broken fetch. |
| Intake service | A small host with **persistent disk** — the SQLite queue must survive a redeploy. Without one, switch `INTAKE_STORE` to `github` ([`server/README.md`](server/README.md)). |
| Staging | `Dockerfile`, `docker-compose.yml` (profiles `persistent` and `ephemeral`) and a `Caddyfile` are in the repo, and run one box through either queue backend. The runbook for the box this project actually uses is not published — it describes a privately funded server, and naming a host's shape in public is a favour to nobody but an attacker. |
| Database | **None.** Discovery is static, and the intake queue is operational state rather than a data tier — losing it loses only submissions not yet batched into a pull request. |
| Mobile | Expo EAS ([below](#store-builds)). Apple $99/yr, Google $25 once. Nothing submitted yet. |

### Store builds

Release builds go through EAS; day-to-day development stays on `npm run ios` /
`npm run android`. [`eas.json`](eas.json) has two profiles, and both compile in the same
three URLs — `EXPO_PUBLIC_DATA_URL`, `EXPO_PUBLIC_INTAKE_URL` and `EXPO_PUBLIC_SOURCE_URL`
— so where a store build talks to is decided by a reviewed file rather than by whatever was
in somebody's shell. None of them is a secret; `EXPO_PUBLIC_*` is public by construction.

- `preview` — an internal build for testers: an installable `.apk` on Android, ad hoc on iOS.
- `production` — the store build. `appVersionSource` is `remote`, so EAS owns the build
  number and increments it; both stores reject a repeated one.

A local `.env` does not reach these builds: it is gitignored, and EAS uploads what git
tracks. That is the point — an `EXPO_PUBLIC_INTAKE_URL=http://127.0.0.1:8787` from local
development must never ship.

```bash
npx eas-cli login                          # once
npx eas-cli init                           # once: creates the Expo project, writes its id into app.json
npx eas-cli build -p all -e production     # EAS creates signing credentials on first run
npx eas-cli submit -p ios -e production    # to App Store Connect → TestFlight
npx eas-cli submit -p android -e production  # to Play's internal track, as a draft
```

Play will not take a first upload through its API, so the very first Android build is
uploaded by hand in the Play Console; `eas submit` works from the second on.

For the store listings: the app version is `1.0.0` (`app.json`, matched by `package.json`);
the privacy policy URL is `https://freshfoodmap.app/privacy`, which is the app's own
`/privacy` screen; and the support URL is the repository's issue tracker.
`ios.config.usesNonExemptEncryption` is `false` — the app uses only the system's HTTPS — so
App Store Connect does not ask the export-compliance question on every upload.

## License

Code is licensed under the **GNU AGPL-3.0-or-later** ([LICENSE](LICENSE)). In short:
use it for anything, but if you distribute a modified version — or run one as a
network service — you must make your complete modified source available under the
same license. That keeps every fork and hosted offshoot as open as this repo.

Market data is separate from the code license: each record in `data/markets.json`
carries `source` attribution, and OpenStreetMap-derived records are
© OpenStreetMap contributors, licensed [ODbL](https://opendatacommons.org/licenses/odbl/).
`REUSE.toml` states both, per path. Note the dataset ships *inside* the app bundle, so every
client receives a copy of it — ODbL attribution therefore has to be readable without
interacting with anything, which is why it sits under the list rather than behind a tap on
a market.

### Publication is deliberate

There is no private tier to submit into: the dataset is the only place a market can land,
and it gets there through a pull request against this repository, reviewed in the open.
Anything submitted is therefore proposed for publication under ODbL by construction — and a
reviewer who thinks a record shouldn't be published simply doesn't merge it. Declining to
merge is the only editorial control this project has; merging is the check itself.
[CONTRIBUTING.md](CONTRIBUTING.md) says the same thing to submitters: whichever route you
take, what you write is headed for a public pull request.

The consequence worth understanding: the open dataset is *guaranteed* open, because
everything in it was put there deliberately, under a licence nobody can withdraw. That is a
stronger promise than "we intend to keep it open".

### What the licence does not reach

Copyleft covers **code**. If you run your own instance, these stay yours and you are never
obliged to publish them:

- the rows in any queue you run — pending submissions, rate-limit counters
- your review decisions, editorial standards and governance
- your `.env` credentials and configuration

What AGPL asks of you is source availability, and the obligation runs to **your users**,
not upstream to this project. If you modify the code and run it as a service, offer your
users your source. Set `EXPO_PUBLIC_SOURCE_URL` to your own repository so the in-app link
points at the code you actually shipped — the upstream link would be wrong for a modified
build.

### Distributing to app stores

The Apple Developer Program agreement imposes EULA terms that sit awkwardly with AGPL §10,
which is why copyleft apps on the App Store are generally published by a project that holds
all the rights to its own code. This project is in that position and can ship its own
builds. **A fork wanting to distribute on the App Store should ask first** — that is a
deliberate choice, not an oversight. Google Play and F-Droid do not raise the same problem.
