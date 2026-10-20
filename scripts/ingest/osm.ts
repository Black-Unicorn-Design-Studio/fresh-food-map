/**
 * OpenStreetMap normalizer — the first real importer, and the one the licence
 * question was already settled for.
 *
 * Run: npx tsx scripts/ingest/osm.ts US-MD          (writes data/markets.json)
 *      npx tsx scripts/ingest/osm.ts US-MD --dry    (prints what it would add)
 *
 * OSM records are ODbL, which is what REUSE.toml already commits
 * `data/markets.json` to, so this import adds no obligation the dataset does not
 * already carry. `source_ref` keeps the element id so a later run can re-sync a
 * row rather than duplicate it.
 *
 * **It never commits.** Output is a working-tree change to `data/` for a human to
 * open as a pull request — the merge is the only gate this project has, and an
 * importer that merged its own rows would remove it (scripts/ingest/README.md).
 *
 * What it deliberately does NOT do:
 *
 * - **Guess at hours.** OSM's `opening_hours` is a full grammar; this parses a
 *   conservative subset (`Mo-Fr 09:00-17:00`, `Jun-Oct Th 10:00-14:00`,
 *   semicolon-separated rules) and returns an empty schedule for anything else.
 *   An empty schedule reads as "hours not listed", which `isOpenNow()` already
 *   treats as never open. A wrong hour sends somebody to a closed car park.
 * - **Invent tags.** Maryland's OSM extract carries no `payment:snap` or EBT tag
 *   on any element, so almost every imported row lands with `tags: []`. That is
 *   the honest state of the source, not an omission to be filled in by guessing.
 * - **Geocode.** Every OSM element carries coordinates. The address is the gating
 *   field, so rows without a house number, street and city are skipped rather
 *   than sent to Nominatim — whose usage policy forbids exactly this bulk run.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";

/**
 * Coordinates to an IANA zone, from a bundled boundary table — no network, so it cannot become
 * the bulk geocoding Nominatim's policy forbids. Declared inline because the package ships no
 * types and is a dev dependency of this script alone: it never reaches the app's bundle.
 */
// eslint-disable-next-line @typescript-eslint/no-require-imports
const tzLookup = require("tz-lookup") as (lat: number, lon: number) => string;

import { isSupportedCountry } from "../../src/constants/countries";
import { MARKET_TAGS } from "../../src/constants/tags";
import { normalizeAddress } from "../../src/lib/address-format";
import { MarketCollection } from "../../src/lib/market-schema";

type OsmElement = {
  type: "node" | "way" | "relation";
  id: number;
  lat?: number;
  lon?: number;
  center?: { lat: number; lon: number };
  tags?: Record<string, string>;
};

const DAYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"] as const;
const OSM_DAYS = ["Mo", "Tu", "We", "Th", "Fr", "Sa", "Su"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const MONTH_END = ["31", "28", "31", "30", "31", "30", "31", "31", "30", "31", "30", "31"];

/**
 * Names that are marketplaces in OSM's sense but not fresh-food outlets in this
 * app's sense. `amenity=marketplace` covers flea markets and general bazaars, and
 * OSM carries no tag that separates them, so the split has to be made on the name.
 *
 * Kept deliberately small and listed here rather than hidden in a regex: every
 * exclusion is a judgement someone should be able to argue with in review.
 *
 * It covers only the unambiguous cases. A grocery or an ethnic food market is NOT
 * excluded — those are plausibly the most relevant fresh-food outlets a food-access
 * map can carry, and the vocabulary has `grocery-store` for exactly that. Whether a
 * given one belongs is a judgement for whoever reviews the pull request, which is
 * where every other judgement in this project already lives.
 */
const NOT_FRESH_FOOD = /\b(flea|antique|craft|artisan|book|car|auto|christmas|holiday|furniture|auction|beauty|hardware|thrift|consignment)\b/i;

/** A deterministic id, so re-running the importer updates a row instead of adding a twin. */
function idFor(ref: string): string {
  const h = createHash("sha1").update(`openstreetmap:${ref}`).digest("hex");
  return [h.slice(0, 8), h.slice(8, 12), "5" + h.slice(13, 16), "8" + h.slice(17, 20), h.slice(20, 32)].join("-");
}

/**
 * A conservative subset of OSM's `opening_hours` grammar.
 *
 * Returns the per-day pairs it is certain about and the month range if one is
 * present. Anything it cannot read confidently yields an empty schedule — see the
 * header note on why that is the right failure.
 */
function parseHours(raw: string): { schedule: { day: string; open: string; close: string }[]; season: [string, string] | null } {
  const schedule: { day: string; open: string; close: string }[] = [];
  let season: [string, string] | null = null;
  if (/PH|off|sunrise|sunset|week |easter|\[|\|\|/i.test(raw)) return { schedule: [], season: null };

  for (const rule of raw.split(";")) {
    const text = rule.trim();
    if (!text) continue;

    // An optional leading month range: "Jun-Oct Th 10:00-14:00" or "Apr-Dec: Su 07:00-12:00".
    const m = /^([A-Z][a-z]{2})\s*-\s*([A-Z][a-z]{2})\s*:?\s+/.exec(text);
    let rest = text;
    if (m && MONTHS.includes(m[1]) && MONTHS.includes(m[2])) {
      const a = MONTHS.indexOf(m[1]);
      const b = MONTHS.indexOf(m[2]);
      season = [`${String(a + 1).padStart(2, "0")}-01`, `${String(b + 1).padStart(2, "0")}-${MONTH_END[b]}`];
      rest = text.slice(m[0].length);
    }

    // "Mo-Fr 09:00-17:00" | "Sa 08:00-12:00" | "Mo,We,Fr 09:00-12:00"
    const r = /^((?:[A-Z][a-z](?:\s*-\s*[A-Z][a-z])?)(?:\s*,\s*[A-Z][a-z](?:\s*-\s*[A-Z][a-z])?)*)\s+(\d{1,2}:\d{2})\s*-\s*(\d{1,2}:\d{2})$/.exec(rest.trim());
    if (!r) continue;

    const open = r[2].padStart(5, "0");
    const close = r[3].padStart(5, "0");
    if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(open) || !/^([01]\d|2[0-3]):[0-5]\d$/.test(close)) continue;

    for (const part of r[1].split(",")) {
      const span = part.trim().split(/\s*-\s*/);
      const from = OSM_DAYS.indexOf(span[0]);
      const to = span.length > 1 ? OSM_DAYS.indexOf(span[1]) : from;
      if (from < 0 || to < 0) continue;
      for (let i = from; ; i = (i + 1) % 7) {
        schedule.push({ day: DAYS[i], open, close });
        if (i === to) break;
      }
    }
  }
  // The schema caps a schedule at 14 entries; a row claiming more is a parse gone wrong.
  return schedule.length > 14 ? { schedule: [], season } : { schedule, season };
}

/**
 * An address, in the shape the country writes it.
 *
 * `fallbackState` is the two-letter code from the ISO area being queried, used only where OSM
 * omits `addr:state`. Five Maryland rows imported without one and read as `Ellicott City,
 * 21042` — a city and a bare number, which is not an address anyone can check. The query
 * already knows the state; withholding it was conservatism applied in the wrong place.
 *
 * **The US gate does not survive contact with British data, and the numbers are not close.**
 * Measured against the live Overpass API for `GB-BAS`: of twelve named candidates, requiring
 * `housenumber && street && city` kept **one**. Britain numbers buildings by name at least as
 * often as by number — Farrington's Farm Shop is at *Home Farm*, Chewton Farm at *Chewton
 * Farm House* — and puts the locality under `addr:town`, `addr:village` or `addr:hamlet` as
 * readily as `addr:city`, where `addr:city` is frequently the post town rather than the place
 * you are standing in. Widening the gate to *a street, plus somewhere to put it* keeps six.
 *
 * The composed shape differs too, and not only in what it contains. A UK address has no state
 * and joins its postcode to the post town with a space and no comma — `Main Street, Bristol
 * BS39 6UB` — where the US convention this dataset already follows is `<street>, <city>, <ST>
 * <zip>`. Building the string correctly here matters because `normalizeAddress` cannot rescue
 * it: its comma-before-postcode rule keys on a five-digit ZIP, so a British postcode simply
 * never matches and whatever comma it was given survives into the committed file.
 */
function addressOf(t: Record<string, string>, iso: string, fallbackState: string): string | null {
  const street = t["addr:street"];
  const postcode = t["addr:postcode"];
  // A house *name* is an address component in its own right here, not a decoration: dropping
  // it leaves a farm shop indistinguishable from the lane it sits on.
  const number = t["addr:housenumber"];
  const houseName = t["addr:housename"];

  if (iso.startsWith("GB-")) {
    const town = t["addr:town"] ?? t["addr:village"] ?? t["addr:hamlet"] ?? t["addr:suburb"];
    const postTown = t["addr:city"];
    /**
     * **A postcode is sufficient on its own here, and a street is not required.** That is the
     * opposite of the US gate below, and the asymmetry is in the data rather than in the
     * standard being applied: a British postcode resolves to roughly fifteen doors, where a US
     * ZIP covers a town. `London SE1 9AL` puts you at the entrance.
     *
     * It matters because the alternative was demanding a street and losing the best-known
     * market in the country: Borough Market is tagged `addr:city` and `addr:postcode` with no
     * `addr:street` at all, as is Market Place Peckham. Requiring a street skipped both while
     * keeping an industrial-estate dairy, which is a gate sorting by tagging diligence rather
     * than by whether a shopper could find the place.
     *
     * So the gate is **any two of street, locality, postcode**. Two is what separates an
     * address from a fragment: `Bruton Avenue BA2 4QJ` and `London SE1 9AL` are both places
     * you can stand in, while `BA2 8PA` on its own is a postcode wearing an address's clothes
     * — findable by machine, unreadable by a shopper, and no use at all to the card overline,
     * which takes the town by comma position and would find none.
     *
     * What stays skipped is the genuinely unaddressed — six of Southwark's eleven carry no
     * `addr:*` tag whatsoever, including Maltby Street and Bermondsey Farmers' Market. That is
     * a gap in OpenStreetMap and not one this importer may fill: the fix would be bulk reverse
     * geocoding, and Nominatim's policy forbids exactly that.
     */
    const parts = [street, town ?? postTown, postcode].filter(Boolean).length;
    if (parts < 2) return null;
    // `town` and `postTown` are kept apart when they differ, because both are real: Chewton
    // Farm is in Keynsham, whose post town is Bristol, and a Briton writes down both.
    const places = [town, postTown].filter((x, i, a) => x && a.indexOf(x) === i);
    // A number runs into its street — `331 Bath Road` — and a name is a separate line of the
    // address — `Home Farm, Main Street`. Joining both with a comma produced `331, Bath Road`,
    // which is not how anyone writes it.
    const head = number ? `${number} ${street}` : houseName ? `${houseName}, ${street}` : street;
    const line = [head, ...places].filter(Boolean).join(", ");
    const out = normalizeAddress(postcode ? `${line} ${postcode}` : line);
    return out.length >= 5 && out.length <= 200 ? out : null;
  }

  if (iso.startsWith("JM-")) {
    /**
     * **Jamaica has no postal code at all**, so the British gate cannot simply be reused: two
     * of its three permitted parts are street and locality, and the third does not exist
     * there. What is left is "a street, plus somewhere to put it" — the same shape as the
     * British widening, one component shorter.
     *
     * **Measured against the live Overpass API for the whole country**, which is small enough
     * to ask about in one query: 45 elements, 33 of them named. Requiring
     * `housenumber && street && city` — the US gate below — keeps **one**. This gate keeps
     * **five**. Both numbers are bad, and the reason is not the gate: only 7 of the 45 carry
     * `addr:street` and only 6 carry `addr:city` at all.
     *
     * **What that means is worth writing down rather than discovering twice.** The markets
     * this skips are not obscure — Coronation Market, the largest in the English-speaking
     * Caribbean, along with Spanish Town, Linstead and Papine, carry no `addr:*` tag
     * whatsoever. They are mapped, named and correctly placed, and they have no address in
     * OpenStreetMap to import. That is a gap in the source, and it is emphatically not one
     * this importer may close: filling it means reverse-geocoding a list of coordinates, which
     * is bulk geocoding, which Nominatim's policy forbids outright — the same wall the British
     * run hit in Southwark. The routes that stay open are a person submitting the market
     * through the form, a person editing `data/markets.json`, or a person improving
     * OpenStreetMap so the next run finds it. All three are people, deliberately.
     */
    const town = t["addr:city"] ?? t["addr:town"] ?? t["addr:village"] ?? t["addr:hamlet"] ?? t["addr:suburb"];
    // Some Jamaican mappers put the parish in `addr:state`. It is taken when offered and never
    // inferred from position, which would be the same forbidden lookup by another name.
    const parish = t["addr:state"];
    const head = number && street ? `${number} ${street}` : houseName && street ? `${houseName}, ${street}` : (street ?? houseName);
    if (!head || !town) return null;
    // A market in the parish of Kingston is in the town of Kingston; writing both says nothing
    // twice, exactly as the composer refuses to for a reverse lookup.
    const places = [town, parish].filter((x, i, a) => x && a.indexOf(x) === i);
    const out = normalizeAddress([head, ...places].filter(Boolean).join(", "));
    return out.length >= 5 && out.length <= 200 ? out : null;
  }

  const city = t["addr:city"];
  if (!number || !street || !city) return null;
  const state = t["addr:state"] ?? fallbackState;
  const tail = [state, postcode].filter(Boolean).join(" ");
  // Through the same normaliser the submit form uses, so an import cannot introduce the
  // drift a hand-typed submission can.
  const out = normalizeAddress(`${number} ${street}, ${city}${tail ? `, ${tail}` : ""}`);
  return out.length >= 5 && out.length <= 200 ? out : null;
}

/** Only what OSM actually asserts. Nothing inferred from the name. */
function tagsOf(t: Record<string, string>): string[] {
  const out: string[] = [];
  const yes = (v?: string) => v === "yes" || v === "only";
  if (yes(t["payment:snap"]) || yes(t["payment:ebt"]) || yes(t["payment:food_stamps"])) out.push("accepts-snap");
  if (yes(t["organic"])) out.push("organic-focus");
  if (t["shop"] === "farm" && yes(t["produce"])) out.push("producer-owned");
  if (yes(t["indoor"])) out.push("indoor");
  return out.filter((x) => (MARKET_TAGS as readonly string[]).includes(x));
}

function haversineMeters(a: [number, number], b: [number, number]): number {
  const R = 6371000;
  const rad = (d: number) => (d * Math.PI) / 180;
  const dLat = rad(b[1] - a[1]);
  const dLon = rad(b[0] - a[0]);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a[1])) * Math.cos(rad(b[1])) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

/**
 * Mirrors, tried in order, because the main instance returns 429 and 504 under load
 * often enough that a single-endpoint importer is a coin flip rather than a tool.
 * Every request identifies the app, which is the courtesy the instance operators ask
 * for and the same rule `src/lib/geocode.ts` follows for Nominatim.
 */
const OVERPASS = [
  "https://overpass-api.de/api/interpreter",
  "https://overpass.kumi.systems/api/interpreter",
  "https://overpass.osm.jp/api/interpreter",
];
const UA = "FreshFoodMap/1 (+https://github.com/Black-Unicorn-Design-Studio/fresh-food-map)";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * `admin_level` is deliberately not constrained. It was pinned to 4, which is the level a US
 * state sits at — and is why the query returned nothing for anywhere else. ISO 3166-2 codes
 * are unique on their own, so the tag alone selects the area whatever level carries it:
 * `GB-BAS` is Bath and North East Somerset at level 6, `US-MD` is Maryland at level 4, and
 * both now resolve. Verified against the live API for both.
 */
async function fetchArea(iso: string): Promise<OsmElement[]> {
  const query = `[out:json][timeout:90];
area["ISO3166-2"="${iso}"]->.a;
(
  node["amenity"="marketplace"](area.a);
  way["amenity"="marketplace"](area.a);
  node["shop"="farm"](area.a);
  way["shop"="farm"](area.a);
);
out center tags;`;
  const failures: string[] = [];
  for (let attempt = 0; attempt < 2; attempt++) {
    for (const host of OVERPASS) {
      try {
        const res = await fetch(host, {
          method: "POST",
          headers: { "User-Agent": UA, "Content-Type": "application/x-www-form-urlencoded" },
          body: new URLSearchParams({ data: query }),
        });
        if (!res.ok) {
          failures.push(`${host} → ${res.status}`);
          continue;
        }
        const text = await res.text();
        // A busy instance answers 200 with an HTML error page rather than JSON.
        if (!text.trimStart().startsWith("{")) {
          failures.push(`${host} → non-JSON body (instance busy)`);
          continue;
        }
        return JSON.parse(text).elements ?? [];
      } catch (e) {
        failures.push(`${host} → ${(e as Error).message}`);
      }
      await sleep(2000);
    }
    if (attempt === 0) {
      console.error("all mirrors busy, waiting 20s before one more round…");
      await sleep(20000);
    }
  }
  throw new Error(`Overpass unavailable:\n  ${failures.join("\n  ")}`);
}

async function main() {
  const iso = process.argv[2];
  const dry = process.argv.includes("--dry");
  if (!iso) {
    console.error("usage: tsx scripts/ingest/osm.ts <ISO3166-2, e.g. US-MD> [--dry]");
    process.exit(2);
  }

  // `US-MD` -> `MD`, and only for the US: this fills `addr:state` where OSM omits it (see
  // `addressOf`). The pattern demanded exactly two letters after the dash, which is a US
  // state code and not much else — `GB-BAS` and `GB-ENG` are three, so it silently produced
  // an empty string for every British area. It is now scoped to the country that has states,
  // which is clearer than a regex that happened to exclude the rest.
  const stateFromIso = iso.startsWith("US-") ? (/^US-([A-Z]{2})$/.exec(iso)?.[1] ?? "") : "";

  // `GB-BAS` -> `GB`. Checked against the closed vocabulary rather than passed through, so a
  // run for an area the app cannot yet render addresses for fails here with a usable message
  // instead of writing rows that CI will reject after the fact.
  const country = iso.slice(0, 2).toUpperCase();
  if (!isSupportedCountry(country)) {
    console.error(`${country} is not a country this app supports yet — see src/constants/countries.ts`);
    process.exit(2);
  }

  const dataPath = new URL("../../data/markets.json", import.meta.url).pathname;
  const current = MarketCollection.parse(JSON.parse(readFileSync(dataPath, "utf8")));

  const elements = await fetchArea(iso);
  const kept: unknown[] = [];
  const skipped: Record<string, number> = {};
  const note = (why: string) => (skipped[why] = (skipped[why] ?? 0) + 1);

  for (const el of elements) {
    const t = el.tags ?? {};
    const name = t.name?.trim();
    if (!name || name.length < 3 || name.length > 120) { note("no usable name"); continue; }
    if (NOT_FRESH_FOOD.test(name)) { note("not a fresh-food outlet (by name)"); continue; }

    const address = addressOf(t, iso, stateFromIso);
    if (!address) { note("incomplete address"); continue; }

    const lat = el.lat ?? el.center?.lat;
    const lon = el.lon ?? el.center?.lon;
    if (lat === undefined || lon === undefined) { note("no coordinates"); continue; }

    const ref = `${el.type}/${el.id}`;
    const { schedule, season } = t.opening_hours ? parseHours(t.opening_hours) : { schedule: [], season: null };
    const website = t.website ?? t["contact:website"] ?? null;

    kept.push({
      type: "Feature",
      geometry: { type: "Point", coordinates: [Number(lon.toFixed(6)), Number(lat.toFixed(6))] },
      properties: {
        id: idFor(ref),
        name,
        address,
        schedule,
        season_start: season?.[0] ?? null,
        season_end: season?.[1] ?? null,
        website: website && /^https:\/\//.test(website) && website.length <= 2048 ? website : null,
        source: "osm",
        tags: tagsOf(t),
        source_ref: ref,
        // From the ISO area the run was asked for, which is the most reliable statement of
        // country available here: it is what selected the elements in the first place.
        country,
        // From the element's own coordinates. `tz-lookup` is a dev dependency of this script
        // and never ships in the app: the lookup is a bundled boundary table, so it needs no
        // network and cannot become the bulk geocoding the Nominatim policy forbids.
        timezone: tzLookup(lat, lon),
        active: true,
      },
    });
  }

  // Never displace a hand-checked row. A name already in the file within 100m is
  // the same market — the rule intake already applies to submissions.
  const existing = current.features;
  const fresh = kept.filter((f: any) => {
    const dupe = existing.find(
      (e) =>
        e.properties.name.toLowerCase() === f.properties.name.toLowerCase() &&
        haversineMeters(e.geometry.coordinates as [number, number], f.geometry.coordinates) < 100,
    );
    if (dupe) note("already in the dataset");
    return !dupe;
  });

  console.log(`${iso}: ${elements.length} elements from Overpass`);
  for (const [why, n] of Object.entries(skipped).sort((a, b) => b[1] - a[1])) {
    console.log(`  skipped ${String(n).padStart(3)}  ${why}`);
  }
  console.log(`  kept    ${String(fresh.length).padStart(3)}  new rows`);
  const withHours = fresh.filter((f: any) => f.properties.schedule.length > 0).length;
  const withTags = fresh.filter((f: any) => f.properties.tags.length > 0).length;
  console.log(`          ${String(withHours).padStart(3)}  of those carry hours`);
  console.log(`          ${String(withTags).padStart(3)}  of those carry a tag`);

  if (dry) {
    for (const f of fresh as any[]) {
      console.log(`    · ${f.properties.name} — ${f.properties.address} [${f.properties.source_ref}]`);
    }
    return;
  }

  const next = { ...current, features: [...current.features, ...fresh] };
  const check = MarketCollection.safeParse(next);
  if (!check.success) {
    console.error("refusing to write — the result does not satisfy the schema:");
    for (const i of check.error.issues.slice(0, 10)) console.error(`  ${i.path.join(".")}: ${i.message}`);
    process.exit(1);
  }
  writeFileSync(dataPath, JSON.stringify(next, null, 2) + "\n");
  console.log(`\nwrote ${fresh.length} rows to data/markets.json — review and open a data-only pull request.`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
