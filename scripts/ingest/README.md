# Ingestion scripts

One normalizer per public source, each producing features that conform to the
GeoJSON contract in
[docs/trd.md §2](../../docs/trd.md#2-the-dataset-is-the-product). Output always
lands as a pull request that changes only `data/`, for human review — never a
direct commit. That PR *is* the review: the dataset is the only tier, and merging
is the only gate and the only check anything crosses, ingested or submitted — see
[TRD §4](../../docs/trd.md#4-the-submission-pipeline).

`osm.ts` is written and has run once, for Maryland. The rest of this directory is still
plan and contract. `data/markets.json` now holds three provenances: hand-assembled seeds
carrying `source: "manual"`, accepted submissions carrying `source: "community"`, and
imported rows carrying `source: "osm"` with the element id in `source_ref`.

## Planned sources

| Script (planned) | Source | Status |
|---|---|---|
| `osm.ts` | OpenStreetMap Overpass API (`amenity=marketplace`, `shop=farm`) | **Written.** ODbL — attribution kept, `source_ref` is the element id for re-sync. Run `npx tsx scripts/ingest/osm.ts US-MD [--dry]`. |
| `ny-state.ts` | New York State open data, dataset [`qq4h-8p86`](https://data.ny.gov/d/qq4h-8p86) | **Second.** Lands `source: "state_portal"`. |
| `city.ts` | City open-data portals (per-city config) | Later. Start with cities that publish CSV/GeoJSON under open licences. |
| ~~`usda.ts`~~ | [USDA Local Food Portal](https://www.usdalocalfoodportal.com/) | **Do not use — see below.** |

## Why OSM first and New York second

Researched 2026-09-02.

**OSM is first because the licence question is already answered.** Its records are
ODbL, which is what `REUSE.toml` already commits `data/markets.json` to, so an OSM
import adds no obligation the dataset does not already carry — the opposite of the
USDA problem below. Coverage is national and thin rather than deep: roughly **519 US
records carry a complete enough address** to import as-is, which is the gating field,
since `validate-data.ts` requires `address`. The repo does now have a geocoder —
`src/lib/geocode.ts`, whose `reverseGeocode()` turns the coordinates an OSM node always
carries into the address it may not — but it is a Nominatim client shaped for one button
press on the submit form and held to one request a second by the usage policy, which
forbids exactly the bulk run a backfill would be. Using it here is a deliberate decision
about that policy, not a free step inside an adapter.

**New York is second because it is the opposite trade.** `qq4h-8p86` covers one state
and mixes farmers markets with farm stands; filter the stands out and roughly **500
records** remain — but **hours and season are filled on every one of them**. Those are
exactly the two fields the USDA dump could not supply at all, and the two that decide
whether a listing reads as useful or as "Hours not listed" forever. A smaller import
that arrives complete is worth more than a larger one that arrives empty.

Redistribution terms for any state or city portal get recorded *in this file* before
its adapter merges, the way the USDA finding is recorded below. An adapter is not
blocked on the answer; the merge is.

## Maryland Market Money: asked for, not taken

Researched 2026-09-16. `marylandmarketmoney.org/mmmlocations` publishes roughly 58-60
address-level access points — participating farmers markets, farm stands and CSAs —
each with day, hours, season and the benefits accepted (SNAP, FMNP, eWIC). It is a
program of the Maryland Department of Agriculture, supported by the FFARMD Foundation,
and it is the best-maintained record of Maryland's SNAP-accepting outlets that exists.

**It is not imported, because the page carries `© 2026 Maryland Market Money. All rights
reserved.` and grants no reuse terms.** That is the same disqualifying condition recorded
below for the USDA portal: no licence, no public-domain dedication, no redistribution
grant. The rule in this file is that terms get recorded before an adapter merges, so the
adapter is not written.

The counter-argument is real and is recorded here rather than acted on: the individual
facts — a market's name, address, day and hours — are not copyrightable in the US, the
country has no database right, and a comprehensive county-by-county listing is close to
the paradigm *unoriginal* compilation under *Feist v. Rural Telephone*. Copying those
facts is very likely lawful. But "very likely lawful" is a worse footing than a written
yes, and this project already declined a larger dataset on exactly this ground.

So the ask goes to MDA and FFARMD instead. If permission arrives, record it here with the
date and the wording, and `md-market-money.ts` becomes a normalizer landing
`source: "state_portal"`. If it does not, the rows stay out.

## USDA is not usable, and this is why

Researched 2026-09-02. Two independent grounds, either one disqualifying:

**No redistribution grant.** The portal publishes no licence, no public-domain dedication
and no reuse terms. "US government work is public domain" does not rescue it — 17 U.S.C.
§105 removes copyright from works authored by *federal employees*, and this content was
authored by market operators and by a contractor's scraper. The
[terms](https://www.usdalocalfoodportal.com/fe/termofservice) are a contract with businesses
that list themselves, and §5 gives them a withdrawal right at any time — structurally
incompatible with ODbL's irrevocability, which `REUSE.toml` already commits this dataset to.
The CC BY entries on data.gov describe the **2014 legacy directory** and all their resource
URLs are dead.

**Wrong shape anyway.** The bulk export returns ~7,100 records across 87 fields, and none of
them is hours, season or website — every imported market would read "Hours not listed"
forever, and `validate-data.ts` would pass it silently because an empty schedule is legal.
About 74% carries a `webscriping=1` flag from a single 2023 campaign, `listing_id` is not
unique, and cancelled markets are still listed.

Unresolved: the keyed search API may expose fields the bulk dump omits. If that is ever
worth chasing, the action is a written question to `directoryupdates@ams.usda.gov` asking
whether AMS asserts any redistribution grant — and the answer belongs in this file.

The `usda` value stays in the `source` enum — no screen renders `source` at all, so there is
nothing to remove but the enum entry, and removing it would only make an old record
unparseable. Nothing stamps it, and no adapter should.

## Architecture: thin adapters, one shared merge

A source adapter does two things and stops: fetch the upstream feed, and map its fields
onto the contract properties. Everything downstream of that — dedupe, id assignment,
preserving human edits, the summary, writing the file — lives in **one shared merge
module** (`merge.ts`) that every adapter feeds.

**Sources must not each implement dedupe.** Two reasons, both structural:

1. **Dedupe is cross-source by nature.** The case that matters is OSM's Union Square and
   New York's Union Square being one market, which no adapter that only ever sees its own
   feed can decide. Per-source dedupe cannot even represent the problem.
2. **Three copies of a proximity heuristic become three different radii**, and the one
   that is wrong is the one nobody reads. The radius is policy, versioned with the rest of
   the pipeline's thresholds in `intake.config.json` (`dedupe.radius_m`, 100 m, matching
   the validator) — not a constant retyped per adapter.

The same argument puts the don't-clobber-human-edits guard (checklist item 5) in the merge
module rather than in each adapter: it is an invariant about the dataset, not about a source.

## Normalizer checklist

**Adapter (per source):**

1. Map source fields → contract properties. Stamp `source` from the enum
   `usda | osm | state_portal | city_portal | community | manual` — `state_portal` for the
   New York import, `city_portal` for a city feed, and `manual` and `community` for the two
   things that never come from an adapter: hand-assembled rows and rows the intake service
   opened a pull request for. `src/lib/market-schema.ts` is the authority on the list, and
   `validate-data.ts` imports it rather than restating it.
2. Emit `tags` from the closed vocabulary in `src/constants/tags.ts` — CI rejects anything
   outside it. An empty array is the honest default: a tag the source does not actually
   state is a guess, and the point of the vocabulary is that a tag is checkable.
3. Emit the upstream id in `source_ref`. With `source` (item 1) that is the whole provenance
   record — attribution, and the handle a re-run re-identifies a row by. Emit nothing that
   claims a check: there is no field an importer can set to mean "nobody has looked at this
   yet", because an import's pull request is merged like any other and merging is the check
   ([TRD §3](../../docs/trd.md#3-what-merging-means)). So keep a batch small enough that a
   reviewer can read every row — a 500-record import is a 500-record claim. The OSM and New
   York passes above arrive as a series of small pull requests split on a stable boundary
   (state, then county), never as one.

**Merge (shared, once):**

4. Dedupe against existing `data/markets.json`: match on `source_ref` first, then name +
   <100 m proximity. Generate a UUID `id` stable per `source_ref` so re-runs don't duplicate.
5. Never overwrite a field a human corrected in git. A re-run that resets hours, a name or a
   tag from upstream deletes someone's review with no record that it happened
   ([TRD §3](../../docs/trd.md#3-what-merging-means)). Re-identify the row by `source_ref`,
   write only the fields that are genuinely new upstream, and report the rest as skips.
6. Print a human-readable summary of adds/updates/skips.
7. Write the merged collection, run `npm run validate-data`, open a PR.
