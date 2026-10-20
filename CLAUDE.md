@AGENTS.md

# Fresh Food Map

A map of farmers markets: one Expo codebase → iOS, Android, web. Three tabs — map, list,
submit — one dataset in git, and a submission pipeline that ends in a pull request.

**There are no accounts.** No sign-in, no sign-up, no sessions, no roles, no database, no
backend that discovery depends on. Read [`docs/trd.md`](docs/trd.md) before planning
anything — it is canonical, and this file deliberately does not restate it.

## Say so before you break a rule, not after

**If a request contradicts the style guide, this file, or an argument the code already makes,
stop and say so before implementing it. Name the rule, quote where it is written, say what the
request would cost, and ask whether to proceed. Then wait.**

The point is the order. Building it and noting the conflict afterwards puts the reader in front
of a change they have already got, which is an awkward place to disagree from — and it buries
the decision in a paragraph after the fact instead of making it once, deliberately, before the
work. A rule here is usually a decision somebody already made with reasons attached; the
request may well be right and the rule may well be stale, but which of those it is has to be
chosen rather than assumed.

What counts, concretely: a colour used against what §2 reserves it for; a control that carries
meaning in colour alone; a target under the floor; anything that would make the app write a
value its own CI would reject; a second copy of something the codebase keeps in one place; a
rule in these docs that the change would make false. What does not count: ordinary product
choices with no rule attached, and preferences of mine.

Say it in a sentence or two — the conflict, the cost, the question. A confirmed answer settles
it, and then the rule in the docs gets updated in the same change rather than left contradicting
the code.

## Built vs. not built

Keep these apart. Describing an unbuilt thing as shipped is the expensive mistake here.

- **Built** — map, list, detail, distance sort; a pin press opens a summary card anchored to
  that pin (`src/components/market-callout.tsx`) rather than navigating, with `VIEW DETAILS`
  for the push it used to do — one component, portalled into a `maplibregl.Popup` on the web
  and drawn as an **ordinary absolutely positioned view** over the native map, reorienting near
  an edge rather than hanging off it (`placeCallout` in `src/lib/callout-anchor.ts` answers in
  pixels; the web half is forcing the popup to choose again once React has filled it, because it
  measures an empty box otherwise). **The native card was a map annotation and is not any more,
  and that is a bug fix rather than a refactor.** On iOS a `Marker` *is* a `ViewAnnotation` is a
  `PointAnnotation` — the library substitutes it whatever the call site says — and an annotation
  moves what it *draws* for a corner anchor, a pixel offset or padding, while leaving its touch
  frame centred on the pin. A card against a screen edge therefore painted correctly and took
  presses half a card away: `VIEW DETAILS` survived by being wide enough to overlap its own
  displaced self, and the `✕`, a 44 pt corner, did nothing at all. Three fixes chased that
  before the card simply stopped being an annotation. An ordinary view has no second frame to
  diverge from — where it is drawn is where it is pressed — at the price of reprojecting the pin
  on `onRegionIsChanging` as well as `onRegionDidChange`, since the position is now JavaScript's
  to keep true rather than the native side's. What it shows is what decides the
  tap — which market, where, what kind — ruled into those parts by four kraft lines; **the week
  strip is not among them**, seven discs being the most expensive row on a 260 pt card and an
  answer to a question the reader is not yet asking. The card's root is `pointerEvents="none"`,
  which is load-bearing rather than tidy: a `View` with a background is a touch target on both
  platforms whether or not anything wants the press, and the card's own paint had grown over
  the `✕` and was swallowing it. A privacy policy at `/privacy` (`src/app/privacy.tsx`), linked
  from the list's credit line and the settings dialog through one `PrivacyLink` — the URL given
  to App Store Connect, and **every sentence in it is a claim about the code**, so a change that
  falsifies one edits it in the same pull request. `Flag or update this listing` at the foot of the detail screen, a
  prefilled repository issue (`reportUrl` in `src/constants/source.ts`) and deliberately not an
  intake submission, which would be dropped as a duplicate in silence; the closed tag
  vocabulary, collapsed on both the list and the map behind the sprout disc in
  `src/components/filter-toggle.tsx` — chips wrap on both screens and size to their own labels,
  with no column grid and no width breakpoints. **The grid was the list's alone**, pinning its
  chips to two equal columns below 768 and one below 360, to stop a four-chip row falling
  three-then-one and to stop `Producer-owned` wrapping inside a chip too narrow for it;
  word-width chips settle the second outright and make the first a ragged row rather than a
  broken one, which is the trade UAT asked for. (`TagFilter`'s `columns` prop survives and
  nothing passes it.) A tag no market in the dataset carries is not offered at all
  (`availableTags`), while a tag that is empty only under the current filters is still shown,
  disabled; on the
  list that panel spans the page and opens independently of the sort list — neither closes the
  other. `🕒 OPEN NOW` is the first chip in that row on **both** screens
  (`src/components/open-now-toggle.tsx`, through `TagFilter`'s `leading` slot) and shares one
  piece of state through `useFilters`, so the two tabs cannot disagree about it; its border is
  `highlight` — neon purple, not the app's own `tint` — on and off alike. **Every chip in that
  row keeps its own border colour on and off alike, so an edge there is identity and never
  state**: `tint` for the tags, `locator` (the `📍`'s own orange-red) for `📍 NEAR ME`, neon
  purple for the clock. Three colours rather than the two it had — the clock and `📍 NEAR ME`
  used to share the neon to say "we both ask about you", which reads as two *groups* beside
  four tags rather than as two questions, where three distinct edges simply read as three
  kinds of filter. What carries "on" is the fill, the label colour and `checked` on a
  `switch`.
  `🕒 OPEN NOW` and `📍 NEAR ME` share a centred line of their own above the tags on both
  screens, ruled off below in `textSecondary` — they are the two filters that ask about the
  *reader* where every tag asks about a kind of market. They led the wrapping row until their
  width pushed the tags into a ragged third line on an iPhone SE.
  The detail screen has no `GET DIRECTIONS`: the address above it is already a link to the
  same map, so the button was a second route to one destination. `VISIT WEBSITE` took the
  filled `tint` it vacated.
  What each tag *means* is an `ⓘ` away, on the detail screen and in both filter panels
  (`src/components/tag-info.tsx`) — **a disclosure, never a tooltip**: there is no hover on a
  phone, React Native has no tooltip primitive, and `title` never reaches the DOM through
  react-native-web's prop allowlist, so it opens on a press and stays until it is closed. The
  `ⓘ` is a *sibling* of the chip's switch and not a child of it: nested pressables let the
  inner press bubble, so asking what a tag meant would also have toggled the filter.
  On the detail screen the address is a link into a map app — the same destination
  `GET DIRECTIONS` has, because an address is what people press. It cannot use
  `ExternalLink`, which refuses any scheme but `https?://` on purpose; what makes a `maps:`
  URL safe here is that `directionsUrl()` builds it from the record's own numbers rather
  than taking it from a field.
  The submit form reads times loosely — `7` is `07:00`, `3pm` is `15:00`, `730` is `07:30`
  (`parseTimeInput` in `src/lib/time-input.ts`) — normalising on blur, never mid-keystroke,
  and refusing only what has no reading at all. The rewrite is announced, because changing
  text somebody did not type is silent otherwise.
  A `✕` clears any text field on any screen
  (`src/components/clear-button.tsx`, one control for the search box and every input on the
  submit form); its
  `SORT` button, which opens four named orders — closest, furthest, name A to Z, name Z to
  A (`isOpenNow()` and `sortByDistance()` in `src/lib/markets.ts`); `📍 NEAR ME`, which is a **filter** on both screens rather than a camera control —
  everything within 25 miles, widening to 50 then 100 only when the narrower radius finds
  nothing and saying so in the chip when it does (`nearestWithin` in `src/lib/geo.ts`,
  resolved once for both tabs by `useNearMe`). On the map, turning it on fits the camera to
  the radius *searched* rather than the markets found (`boundsForRadius`), because framing
  the results would zoom to whatever happens to be nearby and hide how far it looked. It
  asserts that frame only when the radius filter itself changes: with it on, a tag press
  leaves the camera alone, since re-handing an identical box is still a new array and the map
  would ease back to the radius, taking the reader's own panning with it. It
  moved out of the map's dock, which is now one control deep;
  `data/markets.json` bundled and optionally refetched from a CDN; the
  intake service in `server/` (form → mechanical checks → queue → batching agent → pull
  request), which has already opened and merged a real one; a `node:test` suite over the pure
  logic (schema, intake checks, batching agent, IP bucketing, geo/format/open-now, address
  geocoding, per-day hours, submit errors, boot-time env, the mark's geometry, callout
  placement, the correction-issue URL); a containerised staging deployment (Dockerfile, compose profiles,
  Caddy), which also answers for `freshfoodmap.app` — the app's two paths served, everything
  else 308'd to staging — because that is the name the store builds are compiled against.
- **Built, and easy to confuse with something that is not** — the list's search box narrows
  the loaded markets by name and address (`searchMarkets()` in `src/lib/markets.ts`), sitting
  above the tag chips in **both** filter panels from one `MarketSearch` component. In `NAME`
  it needs no geocoder and no network; it is a filter over data already in hand, and on the
  map it narrows the pins *and* the camera, so a frame cannot include a market it excluded.
  `NEAR` is the other half and **is** place search, on both screens: it geocodes what you
  typed and uses the result as an origin — the list sorts from it, the map frames it together
  with the nearest market, which answers the same question from a different starting point. It was the last thing on the not-built list and came cheap, because the camera and
  the sort were already written against an arbitrary point.
- **Not built** — pin clustering; any time filter beyond OPEN NOW (no "open this
  weekend", no day picker); service worker and installability (a manifest sits in `public/`,
  nothing links it); component or rendering tests; most of the ingestion normalizers in
  `scripts/ingest/` — `osm.ts` is written and has run once for Maryland, and the rest of that
  directory is still plan and contract; native store builds — `eas.json` is written and
  points them at `freshfoodmap.app`, and nothing has been built or submitted.

## Docs

Working knowledge lives in `docs/` — read the relevant one before changing that area.

- [`docs/trd.md`](docs/trd.md) — architecture: the dataset, the pipeline, platform, security.
- [`docs/prd.md`](docs/prd.md) — product scope, and what is deliberately out (no reviews,
  no vendor storefronts).
- [`docs/style-guide.md`](docs/style-guide.md) — design tokens, type system, code conventions.
- [`server/README.md`](server/README.md) — running intake: queue backends, proxy headers,
  IP hashing.
- `private/deploy-staging.md` — the staging runbook: both storage modes, TLS, and how to tell
  the two apart. Gitignored, and stays that way: it describes a privately hosted and funded
  box, and `private/` exists so that detail leaves no trace in a repository meant to go
  public. The compose files it drives are committed; the box it drives them on is not.

## Commands

- `npm run web` — run the app (no backend, no env, no keys; discovery works off bundled data)
- `npm run typecheck` / `npm run lint` — both must pass before pushing
- `npm run validate-data` — schema-check `data/markets.json` (CI runs this)
- `npm test` — the unit suite (`node:test` through tsx; needs no network, no service and no
  env set). Run one file with
  `node --experimental-sqlite --import tsx --test test/checks.test.ts`
- `npm run build:web` — copies the dataset to `public/` then exports the static web build
  to `dist/`. Use this over bare `expo export`, or the CDN copy ships stale. **A changed
  `EXPO_PUBLIC_*` value needs `--clear`.** Those are inlined at transform time and Metro's
  transform cache does not key on them, so a rebuild re-emits the old value in a
  byte-identical bundle — measured, flipping `EXPO_PUBLIC_INTAKE_URL` from `https://` to
  `http://` survived a full rebuild, same content-hash filename and all. The export succeeds
  either way, which is the trap: the stale value only surfaces at runtime, as the app talking
  to the wrong host. `cp data/markets.json public/markets.json && npx expo export -p web
  --clear`, then grep `dist/_expo/static/js/web/*.js` for the new value before trusting it.
- `npm run intake` — the intake HTTP endpoint; `npm run intake:batch` turns the queue into a
  pull request. Both resolve `intake.config.json` (and the endpoint, `data/markets.json`)
  against the working directory, so run them from the repository root. The endpoint needs
  `INTAKE_IP_SALT`, plus `GITHUB_TOKEN` when `INTAKE_STORE=github` — both checked at boot, so
  a misconfigured service refuses to start rather than failing on somebody's submission. The
  batch run needs `GITHUB_TOKEN`.
- `npm run ios` / `npm run android` — native dev builds (`expo run:*`; MapLibre isn't in
  Expo Go, so `expo start` on a device won't do). `ios` runs `ios:verify` first
  (`scripts/verify-ios-link.sh`): React Native picks its prebuilt core via a `curl` to Maven
  during `pod install` and falls back to a from-source static build on any non-200, while
  Expo's precompiled modules keep vendoring dynamic frameworks that link the
  `React.framework` nobody then built. That combination compiles with zero errors and dies
  at launch on `dyld: Library not loaded`, so it is checked before Xcode starts rather than
  discovered on a device. iOS needs Xcode 26.4 or newer — on anything
  older SDK 57 fails compiling `expo-modules-jsi` with `'weak' must be a mutable variable`,
  which reads like a corrupt install and is not one; [`README.md`](README.md) has that and the
  simulator runtime a freshly updated Xcode still needs.

Tests live in `test/` and run on `node:test` via tsx — no test framework was added and none
should be. They cover pure functions guarding real invariants; nothing renders a component.
See [TRD §8](docs/trd.md#8-testing-and-ci) for what is and is not covered.

## Branches

**Work happens on a feature branch. It reaches `staging` by pull request, and `main` only
after review.** `main` is protected and takes no direct pushes.

```
feature branch ──PR──▶ staging ──(reviewed)──PR──▶ main
```

That is a deliberate inversion of what this repo used to do, which was commit to `main` and
then promote `main` to `staging` — staging was downstream of the branch it was meant to be
vetting, so nothing was ever reviewed before it was merged. Now `staging` is where work is
seen running and `main` is what has survived that, which is the order the words already
implied. Two things follow from it and are easy to get backwards: **`staging` is ahead of
`main`, not behind it**, and a submission from the intake service targets `staging` like
everything else (`private/deploy-staging.md`) rather than being a special case.

The exception is **minor changes** — a copy tweak, a stale comment, a one-line fix — which may
go straight onto `staging`. They still never go straight onto `main`.

**Cut a feature branch from `staging`, not from `main`.** `main` is behind by design now, so
branching from it means opening a pull request that reverts whatever has landed since the last
promotion — a diff that looks like a feature and reads as an accident.

## Accessibility is designed in, not audited in

**Every design and implementation decision considers accessibility from the start.** This is
not a review step. It became a rule the expensive way: a retrofit audit found 27 defects,
and the worst of them was not cosmetic — the submit form's honeypot was reachable by
screen-reader form navigation, and tripping the honeypot is a hard fail, so an accessibility
gap had quietly become silent data loss landing on the users least able to notice it.

What that means concretely here:

- **A React Native accessibility prop is not guaranteed to reach the DOM.** react-native-web
  silently drops `accessible`, `accessibilityState`, `accessibilityHint`,
  `accessibilityElementsHidden` and `importantForAccessibility`. Add the W3C attribute
  *alongside* the RN one — never instead, or native regresses. **`hitSlop` on `Pressable` is
  dropped too**, and it is the one that reads as a sizing decision rather than an
  accessibility prop: a control sized 40 with 4 of slop is 44 on native and 40 on the web,
  and nothing says so. Targets that must hold a floor carry `minWidth`/`minHeight`; slop is
  a native-only bonus on top. `accessibilityRole` and
  `accessibilityLabel` *are* forwarded and need no duplicate. `aria-atomic` is broken
  upstream in 0.21.2 and never arrives at all. Verify against
  `node_modules/react-native-web/dist/` rather than assuming.
- **Never encode meaning in colour alone** — including on the map, which is where the rule
  had been dropped.
- **On native, a touch does not land where you drew it.** Three rules, all paid for on a device
  and none visible in a browser, because react-native-web clips none of this. **A view outside
  its parent's bounds is drawn and not pressed** — UIKit hit-tests against each ancestor's box,
  so the callout's `✕`, pulled into the card's padding by a negative margin, offered a target a
  third smaller than the 44 its own comment claimed. Move the glyph inside its box, never the
  box outside its parent. **A `View` with a background takes presses whether or not it wants
  them**, so decoration over anything interactive needs `pointerEvents="none"` — and `box-none`
  is not that: it exempts the view and leaves its *children* catching, which is how the
  wordmark's keyline went on swallowing presses after the plaque had stopped. **A press on a map
  source returns every feature in a 44×44 hitbox**, not the one pressed, so `features[0]` is the
  renderer's order rather than the reader's aim; `nearestFeature` picks by distance from the
  press. Taking the first opened the same market for every pin in a cluster, which reads as
  duplicate pins and was reported as one.
- **Anything that changes without a reload needs an already-mounted live region.** A region
  inserted at the same moment as its text is not reliably announced.
- **Every route sets a document title** with `PageTitle`. `Stack.Screen`'s `title` names the
  navigation chrome and never reaches the document. `PageTitle` renders on the web and
  nowhere else: `expo-router/head` exists on native to feed iOS handoff, and without a
  `headOrigin` in the `expo-router` plugin it throws on render, so every screen declaring a
  title crashed the native app. Adding handoff means setting that origin and dropping the
  platform guard — not removing the component.
- **Check it in a browser.** Run axe-core against the routes, and read the ARIA snapshot via
  the role engine — a DOM snapshot and the accessibility tree disagree, and the DOM one will
  tell you a hidden element is still exposed.
- **A Reanimated `entering` animation holds its subtree at `visibility: hidden` until the
  animation actually runs** — and an occluded or backgrounded browser tab throttles
  `requestAnimationFrame`, so it never does. The panel then has a real bounding box, `display:
  flex` and `opacity: 1`, and is invisible, unfocusable and absent from the accessibility
  tree. Every cheap check passes; Tab skips the contents and `.focus()` on them silently does
  nothing. It hits the filter panel and the sort list alike. So before checking anything
  inside one, `page.bringToFront()` or emulate `prefers-reduced-motion: reduce`, which drops
  `entering` altogether (`useReducedMotion()`), and confirm `visibility` is `visible` before
  trusting a single measurement taken inside it.
- **`aria-hidden` on a wrapper hides everything inside it.** Hiding decorative paint is
  routine here, and the props get copied from one element to the next — but a leaf and a
  container are not the same thing. Moving the map card's divider markup onto the `View` that
  *wraps* the tag chips took all four chips out of the accessibility tree while leaving them
  in the DOM, on both screens. It typechecks and it renders, and it survived an axe run —
  because the run printed violations, and this is not one. axe *does* raise it, as an
  **incomplete**: `aria-hidden-focus`, because the chips are focusable. So read `incomplete`
  as well as `violations`, and confirm with the role engine, which shows it outright. A bare
  `View` with no role and no text announces nothing to begin with, so there is never anything
  on one to hide.

## Conventions that bite

- **Git is the whole data tier.** `data/markets.json` is the only store; there is no
  database. The fallback for every failure is "a human edits the file", which needs no admin
  UI, no server access and no permissions system. Protect that property — anything whose
  recovery path requires logging into a box is the wrong design.
- **One schema, imported everywhere.** `src/lib/market-schema.ts` is the contract that CI
  (`scripts/validate-data.ts`), the intake service and the batching agent all import. Never
  write a second copy: the failure mode is a submission that passes intake and then fails CI,
  which is the worst possible place to find it. It may import zod and the tag vocabulary and
  nothing else — a Node server loads it and must not pull React Native in behind it.
- **Merging is verification.** There is no `verified` field and no `verified_at`: a market is
  in `data/markets.json` because a person read the pull request and merged it, and there is no
  second state a listing can earn. `MarketProperties` is a `z.strictObject`, so re-adding
  either key is a loud CI failure rather than a silent strip. `source` is provenance, never
  trust, and it is displayed nowhere — the ODbL obligation is discharged once for the whole
  collection by the credit line under the list (`src/components/attribution.tsx`), not per
  record. Anything turning `source` into a badge, a filter, a sort or a grade is a
  review-blocker, and so is copy implying a listing is still waiting to be checked ("not yet
  verified", "pending review"). Data pull requests never automerge: the deliberate human merge
  is the entire mechanism.
- **Never auto-reject a submission.** Accepted *and* flagged both reach the pull request
  (flagged with a reason); exactly **three** hard fails are dropped — honeypot tripped,
  submitted faster than the configured minimum, or a same-name-within-100m duplicate CI would
  reject anyway — and dropped without a trace: the same `202 {"status":"received"}` an accept
  gets, nothing queued and no rejected row, because telling a bot which check it tripped is
  telling it how to pass. The request is still *counted* against the hashed-IP bucket —
  `store.record()` runs before the checks, so spraying rubbish is never free. A wrong accept
  costs a review comment; a wrong reject is a silent deletion nobody sees.
  **Two outcomes are deliberately not silent**, and they are not hard fails: a payload that
  misses the schema gets `422` with field-level issues, so a person who mistyped can see
  which field, and a bucket over the limit gets `429` with a message pointing at the pull
  request path. Verified against the running service; `server/README.md` and
  [TRD §4](docs/trd.md) say the same.
- **No human decision happens on the server.** The intake service validates mechanically
  (schema, honeypot, timing, hashed-IP rate limit) and opens pull requests; every judgement
  call happens on GitHub, and merging is the gate. Reviewing must never become gated on SSH
  access.
- **Policy is versioned with the data.** Batch size, rate limits, dedupe radius and the flag
  list live in `intake.config.json`, committed — changing a spam threshold is a pull request
  someone can object to, not something that happened on a server.
- **Tags are a closed vocabulary**, six of them since `grocery-store` and `donations-available`
  joined in UAT.
  `src/constants/tags.ts` is the list; `tags` is a required
  key on every feature (`[]` is fine) and `validate-data.ts` rejects anything outside it.
  Adding a tag is a pull request, deliberately. Nothing there may restate a field the schema
  already has.
- **`isOpenNow()` reads the market's clock, not the device's.** Every record carries an IANA
  timezone and `marketClock` (`src/lib/market-clock.ts`) resolves the day and the minutes in
  it. This bullet used to say the opposite and prescribe the fix — "correcting it means adding
  a timezone to the schema, not patching the function" — and that is exactly what was done, so
  what is left here is the shape of the answer rather than the plan for it. A zone *name* and
  never a stored offset: daylight saving is a set of rules, so an offset would be an hour wrong
  for part of every year. Jamaica is the case that makes it obvious, keeping no daylight saving
  at all, so America/Jamaica matches America/New_York every winter and trails it every summer.
  Three behaviours there look like bugs and are not: no hours listed is never open (absent
  hours are unknown hours), a season ending *before* it starts wraps the new year rather than
  being empty, and a record carrying no zone falls back to the device — which only a CDN copy
  older than the app can produce, and answering roughly beats refusing to answer.
- **`EXPO_PUBLIC_` is inlined into the bundle** and is therefore public by construction —
  never put a credential behind that prefix. The intake service's GitHub token is a
  server-side variable and stays one.
- **Never hardcode colors/spacing** — everything comes from `src/constants/theme.ts`
  (`Colors`, `Spacing`, `Radii`, `Elevation`, `Display`, `MaxContentWidth`). A raw hex in a
  component is a review-blocker.
- Display type is Fraunces (`Display.*` tokens); body text stays system fonts.
- Map component is platform-split: `market-map.tsx` (native) / `market-map.web.tsx` — the
  web file imports `MarketMapProps` from the native one, so the props cannot drift. Keep it
  that way. A `bounds` set outranks `center`/`zoom` on both files, and the web map keys its
  fit on the array's identity rather than on the four numbers inside it: asking to be framed
  is an intent, and the same intent recurs unchanged when a frame is asked for twice from one
  spot. So the caller has to hold it, and `src/app/(tabs)/index.tsx` holds it in **state**.
  Not a memo: that was nearly right and wrong in one place, since a memo cannot hand back its
  previous value and therefore has no way to say *leave the camera alone*. It is refitted by
  comparing against the last inputs **during render**, which is neither of the two shapes the
  lint rules forbid — a ref read during render (`react-hooks/refs`) is a value React is free
  not to re-render for, and `setCamera` inside an effect (`react-hooks/set-state-in-effect`)
  fits the camera a render late, so the map paints the stale frame and then jumps.
  Three rules, and the order is the specification. **`📍 NEAR ME` frames the radius searched**,
  and is not re-asserted when only the tags change: the values would be identical but the array
  would be new, so the map would ease back to the radius and undo any panning the reader had
  done inside it. **Nothing matched means do not move** — falling through without setting the
  camera leaves `bounds` and `center` identical, so neither map effect fires, because a filter
  that empties the list must not also throw the view somewhere the reader then has to find
  their way back from. **Otherwise fit what is shown**, and fit the markets rather than the
  markets plus the reader: including the located point would zoom out to span the distance
  between them and shrink two adjacent markets to a speck to make room for a point whose
  position the reader already knows. The bug that forced all this: `bounds` was only computed
  when a place had been searched, so with no location the camera never re-fitted at all, and
  narrowing to two markets in Georgia left the map wherever it had last been panned.
  An inline literal re-fits on every render and fights the user for the camera.
- **Two different things are called a title, and they are set in different places.**
  `Stack.Screen`'s `title` names the **navigation chrome**; `PageTitle` sets the **HTML
  document** title and renders nothing off the web. The market detail screen is where the
  distinction earns its keep: the chrome carries the app's name, a constant set once in
  `src/app/_layout.tsx`, because the market's name was there *and* in the page heading a thumb
  below it. The document title keeps the market's name, because it is never on screen beside
  that heading and it is what names the tab, the bookmark, the history entry and what a screen
  reader announces on arrival — sixty-one pages called `Fresh Food Map` would be sixty-one
  indistinguishable entries (WCAG 2.4.2). Never "fix" the duplication by flattening the
  document title.
- **The back button names the tab it returns to**, not the group. A native stack labels it from
  the previous screen's `title`, and the previous screen is always `(tabs)` — so one static word
  there said `Markets` whether back led to the map or the list. `src/app/(tabs)/_layout.tsx`
  sets it from a `focus` listener per tab, through the navigation object that layout already
  holds: that component *is* the `(tabs)` route's element, so `useNavigation` returns the stack
  rather than the tab navigator. **Not `getFocusedRouteNameFromRoute`**, which is the documented
  answer and is not on expo-router's public surface — it lives under
  `expo-router/build/react-navigation/core/` and reads a route key the library marks private in
  as many words, so using it means importing a build path and depending on a private field.
  `src/constants/tabs.ts` is the one list of tab names, because each name has to reach both
  `options.title` and the stack's `title`, and a tab whose two copies disagreed would be a
  button promising one destination and delivering another. Order matters there: the root
  layout takes `TABS[0]` as its fallback, so a cold launch straight into a market URL is right
  by construction rather than by a rule to remember.
- **The dataset is narrowed to the reader's country, in `useMarkets` rather than per screen.**
  A reader in Manchester was being shown sixty-one American markets among eight British ones:
  every count four-fifths noise, `📍 NEAR ME` widening to a hundred miles through an ocean, and
  any filter press fitting a camera box from California to Oldham. It sits at the source
  because the two screens must never disagree about what exists — the rule `useFilters` was
  created for — and because it is not a *filter* in the sense the chips are: nothing in the
  panel turns it off and it is not counted as active. A record with no country survives the
  narrowing, since only a dataset older than that field can produce one and dropping markets
  because the CDN copy is stale is the worst way to find out.
- **The address lookup is shaped by Nominatim's usage policy, not around it**
  (`src/lib/geocode.ts`). One request a second, and **client-side autocomplete is forbidden
  outright** — so it is a button and can only ever be a button; as-you-type search is a
  policy breach, not a feature to add later. Answered addresses are cached and never asked
  twice, because identical repeat queries are how a client gets blocked. Every request
  identifies the app: the browser's `Referer` does it on the web, and `User-Agent` on
  native, which sends no `Referer` — the header is set unconditionally because the web
  forbids it and drops it silently. It is the only third party the app talks to besides the
  tile host, and it is on the submit path only; discovery still touches nothing.
- **The lookup runs both ways, and the two directions treat a typed address differently.**
  `🔎 Find it from the address` fills the coordinates and **replaces the address when what it
  found carries more** — `addressDetail()` scores both strings and a tie leaves the reader's
  own words in place. That reverses an older rule, "neither direction overwrites what a person
  typed", which was protecting the wrong half: it kept "1573 w broad" when the lookup knew
  "1573 W Broad St, Athens, GA 30606", so markets went into a committed file with half an
  address. `📍 Use my current location` still fills an *empty* address field only — the device
  knows where you are, not what you meant to write, and "west car park, behind the church" is
  better than the postal address that would replace it.
  **`addressDetail()` scores the string and never the country, and its postcode signal has to
  know every grammar the app supports** — it took `\d{5}` for a long time, so a British
  postcode scored nothing and the comma count decided everything: measured, `main st, keynsham,
  bristol` tied with `Main Street, Keynsham, Bristol BS31 1EQ` and the tie-keeps-typed rule
  threw the postcode away. Adding a country means adding its postal grammar here too, or the
  new country's readers quietly get the worse of the two answers. It takes no country
  *parameter* on purpose, because one function has to score what was typed and what came back
  and those are only comparable under the same rules. A five-digit house number is not a
  postcode either: the leading number is already paid for by its own signal and is stripped
  before the postal token is looked for.
  Both compose the address from Nominatim's components rather than pasting `display_name`,
  which runs to a country and a postcode and would breach the schema's 200-character cap: the
  app must never write a value its own CI would reject. The composed form matches what is
  already in the dataset — `<street>, <city>, <ST> <zip>`, the state abbreviated from the
  service's own `ISO3166-2-lvl4` rather than from a table of fifty states. Reverse asks at
  `zoom=18` and reports an `AddressPrecision`, so a point with no house number mapped is
  offered as a street and *said* to be one rather than dressed up as an address. **A forward
  lookup asks for three candidates and takes the most precisely placed** — Nominatim ranks by
  its own relevance rather than by placement, so a road can come first while a building sits
  second, and asking for one meant taking the road. Nothing asks the reader to choose; the pick
  is on precision. **Neither direction ever *fabricates* a house number** — neither will write
  one the service did not return — and that is the whole of the rule. It is **not** "reverse
  must not report a number it is unsure of", and reading it that way is a mistake somebody has
  already made here: it got the number stripped out of the reverse street fallback, which is
  the opposite of the decision on record.
  The forward direction is where fabrication would bite: measured, `12610 Old Gunpowder Road`
  matched a road 2.3 km from the device, so a number filled there would be wrong *and* far.
  **Reverse keeps whatever number comes back, including from the coarser `zoom=17` fallback**,
  because it is anchored to a real point: at that same spot it returns `12614`, the neighbour
  21 m away. A near miss somebody can correct beats an address with a hole in it, and that is
  a call the project has made deliberately rather than a gap to be tidied up — the reader is
  standing there and can see the door number.
- **A forward lookup says where it is asking from, because a postcode does not.** `20904` is
  Silver Spring, Maryland and also a real postcode in Aguascalientes, and Nominatim answered
  with México — five digits carry no country, so the query has to supply one. **The device's
  position comes first**: with a location the query carries a `viewbox` around it, which
  *biases* ranking rather than filtering, so somebody in Maryland searching for a market in
  Oregon still finds it, just below the local matches. Live proof that it works: "Portland"
  biased near Oregon returns Multnomah County, biased near Maine returns Cumberland County.
  Without a location it falls back to `GEOCODE_COUNTRIES` (default `us`, since every market
  in the dataset is). **Never both** — `countrycodes` is a hard filter, and sending it
  alongside would let a compiled-in default veto the reader's own position. The bias is part
  of the cache key, or one reader would be served another's answer. **Reverse lookups take
  neither**: a point is already in whatever country it is in.
- **A typed place is an origin, and it is the reader's own address as often as not.** The
  list's `NEAR` search geocodes what somebody types and sorts from it, so a home address can
  reach Nominatim. That is why `app.json`'s location permission copy names it; if the lookup
  ever moves off an explicit press, that copy stops being true again.
- **A geocoded coordinate is shown, never filled silently.** A wrong hit that nobody saw
  rides into a pull request looking exactly like a right one, and a complete-looking record
  is what survives a reviewer's skim. The fields stay editable and the found address is
  displayed next to them.
- The dataset is `.json` not `.geojson` because Metro can't bundle the latter extension.
- The app must run with **no env set at all** — that is the normal state, not a fallback.
  Unset `EXPO_PUBLIC_DATA_URL` means bundled-only; unset `EXPO_PUBLIC_INTAKE_URL` means the
  Submit tab explains how to open a pull request instead; unset `EXPO_PUBLIC_GEOCODE_URL`
  means the public Nominatim instance, which needs no key and no account — it is an origin,
  and both `/search` and `/reverse` hang off it; unset `EXPO_PUBLIC_GEOCODE_COUNTRIES` means
  `us`, which is what stops a bare postcode resolving to the wrong hemisphere.
- Icons/splash and the native map pin are generated — edit `scripts/gen-icons.js` and rerun it
  (`npm install --no-save opentype.js@1.3.4 sharp` first; neither is a dependency), don't
  hand-edit the PNGs in `assets/images/`. **A device that has had an older build will not show a changed splash** —
  it plays the previous launch screen at full opacity first and then cross-fades to the new
  one, which reads as the app having two splash screens and is one splash plus stale device
  state. **It is held by the device, not by the app, and it outlives more than you would
  expect:** measured, it survived an uninstall-and-reinstall, deleting
  `Library/SplashBoard/Snapshots/*` from the data container, a full simulator reboot, and a
  Metro restart with `--clear`. What proved where it lived was installing the same binary on a
  simulator that had never had the app: one splash, correct from the first frame. So judge a
  splash change on a device that has not carried the old build, and do not chase it in the
  app — check `assetutil --info` on the built `Assets.car` instead, which lists every
  rendition that actually shipped. Measure the result off a launch rather than off the PNG,
  because `imageWidth` in `app.json` decides what a given number of source pixels becomes on
  screen, and measure the disc and the wordmark separately — the name is wider than the mark,
  so a widest-run measurement silently reports the text. **One mark, two renderings,
  one file.** The pin is
  the filled sprout — green leaves on a white disc — and the filter disc is the same mark drawn
  as two bars along those leaves' own diagonals; the pin was briefly the filter disc shrunk and
  went back, because a stroked mark at 22px on pale tiles reads as a scratch. Both live in
  `src/constants/sprout.ts`: the web map inlines the leaves as SVG and
  `src/components/filter-toggle.tsx` derives its bars from the same endpoints, so the toggle no
  longer carries hand-copied numbers. `scripts/gen-icons.js` is the one remaining copy, because
  a MapLibre symbol layer takes an image and not a path and that script runs outside the app's
  module graph; it says so, and a shape change means rerunning it. `test/sprout.test.ts` pins
  the relationship — each bar spans its leaf's tip and base — so the two cannot drift quietly.
- **Every commit needs a `Signed-off-by` line** (`git commit -s`) or CI fails — except a pull
  request that touches only `data/`, since market records are ODbL facts submitted by people
  who never touch git. See [`CONTRIBUTING.md`](CONTRIBUTING.md).
