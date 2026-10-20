import { z } from 'zod';

/**
 * Turning a typed address into a coordinate pair, and nothing else.
 *
 * This exists because the submit form asked for latitude and longitude and nobody knows
 * theirs. The coordinate pair is still required — the schema needs a Point geometry, and a
 * record without one cannot merge — so the fix is not to drop the field but to stop making
 * a person produce it. They type the address they already know and press a button.
 *
 * Nominatim is the service for the same reason OpenFreeMap serves the tiles: free, keyless,
 * and OSM, so a fork still runs at zero cost with no accounts and no billing profile
 * ([PRD §6](../../docs/prd.md#6-constraints--assumptions) rules Google out explicitly). Its
 * usage policy is narrow and this module is shaped by it rather than around it:
 *
 * - **One request per second, and never as-you-type.** The policy forbids client-side
 *   autocomplete outright, so this is a button and can only ever be a button. `MIN_INTERVAL_MS`
 *   is the floor; the caller also disables the control while a lookup is in flight.
 * - **Results must be cached.** Identical repeat queries are how a client gets classified as
 *   faulty and blocked, so an answered address never reaches the network twice, and a cache
 *   hit skips the interval check because it is not a request.
 * - **Requests must identify the application.** A browser sends `Referer` for us. Native
 *   sends none, so `User-Agent` is set explicitly — on the web that header is forbidden and
 *   silently dropped, which is why it is set unconditionally rather than behind a platform
 *   check this module would otherwise need `react-native` for.
 *
 * Nothing here is on the discovery path. The app still runs with no env set at all: unset
 * `EXPO_PUBLIC_GEOCODE_URL` means the public instance, and a fork pointing at its own
 * Nominatim changes one variable.
 */

/** Public instance, as an origin: both endpoints hang off it. Overridable for a fork. */
const DEFAULT_ORIGIN = 'https://nominatim.openstreetmap.org';

export const GEOCODE_URL = process.env.EXPO_PUBLIC_GEOCODE_URL ?? DEFAULT_ORIGIN;

/**
 * Which countries a forward lookup may answer from, as ISO 3166-1 alpha-2 codes.
 *
 * **The fallback, not the first answer.** Where the reader actually is beats a compiled-in
 * country every time, so `near` takes precedence and this applies only when there is no
 * location to go on — a first run, a refusal, the web without permission.
 *
 * It exists because a bare postcode is otherwise a coin toss: `20904` is Silver Spring,
 * Maryland and also a real postcode in Aguascalientes, and Nominatim answered with México.
 * Five digits carry no country, and neither did the query. City names are worse — "Portland"
 * alone matches a dozen of them.
 *
 * US because every market in the dataset is. A fork elsewhere sets
 * `EXPO_PUBLIC_GEOCODE_COUNTRIES` to its own codes — `gb`, or `ca,us` — and setting it empty
 * removes the restriction, which is right for a fork whose markets span borders.
 */
export const GEOCODE_COUNTRIES = process.env.EXPO_PUBLIC_GEOCODE_COUNTRIES ?? 'us';

const endpoint = (path: string) => `${GEOCODE_URL.replace(/\/$/, '')}/${path}`;

/**
 * Identifies the application, as the usage policy requires. A stock or generic agent is
 * explicitly not enough, so this names the app and where it lives.
 */
export const GEOCODE_USER_AGENT = 'fresh-food-map/0.1.0 (+https://freshfoodmap.app)';

/** The policy's ceiling is one request per second. This is that, not a tuned number. */
export const MIN_INTERVAL_MS = 1000;

/** Same floor the submit form puts on the address field — below it there is nothing to look up. */
const MIN_ADDRESS_LENGTH = 5;

/** Bounded so a long session cannot grow it without limit. Oldest entry goes first. */
const MAX_CACHE_ENTRIES = 50;

/**
 * What Nominatim returns, narrowed to the three fields this uses. Deliberately not a
 * `strictObject`: the response carries a dozen keys that are none of our business, and a
 * service adding a fourth must not break a lookup.
 *
 * `lat` and `lon` arrive as strings, which is why they are parsed rather than trusted.
 */
const NominatimPlace = z.object({
  lat: z.string(),
  lon: z.string(),
  display_name: z.string(),
  /**
   * Optional because the field only arrives when `addressdetails=1` is asked for, which the
   * forward lookup now does: the components are what compose an address in the shape the
   * dataset wants, where `display_name` is a tour of the administrative hierarchy.
   */
  address: z.record(z.string(), z.string()).optional(),
});

const NominatimResponse = z.array(NominatimPlace);

/**
 * Reverse returns one object rather than a list, and an error object rather than an empty
 * one when it finds nothing. `address` is the component breakdown `addressdetails=1` asks
 * for — needed because `display_name` runs to a country and a postcode and the schema caps
 * `address` at 200 characters, so the field is composed rather than pasted.
 */
const NominatimReverse = z.object({
  display_name: z.string(),
  address: z.record(z.string(), z.string()).optional(),
});

/** Longest an address may be (`MarketProperties.address` in `src/lib/market-schema.ts`). */
const MAX_ADDRESS = 200;

/**
 * `8 Southwark Street, London SE1 1TL` — no state, and the postcode joined to the post town by
 * a space rather than a comma.
 *
 * There is no subdivision slot at all, and that absence is the whole fix. `ISO3166-2-lvl4` is
 * a *postal* abbreviation in the United States and a constituent country in the United
 * Kingdom, so reading it the American way turned Borough Market into
 * `8 Southwark Street, London, England SE1 1TL`. `ENG` is three letters and fell the guard,
 * which then reached past it for `state` and found `England` — an answer no British person
 * would write and no map app needs. Scotland and Wales failed the same way via `SCT` and `WLS`.
 */
function composeBritish(street: string | undefined, town: string | undefined, postcode?: string) {
  const line = [street, town].filter(Boolean).join(', ');
  if (!postcode) return line;
  return line ? `${line} ${postcode}` : postcode;
}

/**
 * `Ocho Rios Bypass, Ocho Rios, Saint Ann` — a street, a town and a parish, and no postal code
 * anywhere, because Jamaica does not have one.
 *
 * Jamaica discontinued its postal-code trial outright, so unlike Britain — which has no state
 * but does have a postcode — there is no trailing token at all. That makes the parish the only
 * thing disambiguating two towns of the same name, which is why it is written rather than
 * dropped.
 *
 * **Measured, not assumed, and the assumption was wrong.** The danger looked like the British
 * one: a parish landing in the American state slot. It is not. Nominatim files Jamaica's
 * parish code under `ISO3166-2-lvl6` (`JM-01`) where the American composer reads `lvl4`, and
 * answers Jamaican points with no `state` key whatsoever — so `composeAmerican` found nothing
 * in either place and silently produced `Peters Lane, Kingston`, an address with the parish
 * *missing* rather than misplaced. A quieter failure than the British one and a harder one to
 * spot in review, since what it writes is not wrong, only incomplete.
 *
 * The parish arrives as `county`. `state_district` also looks plausible and is not: it carries
 * the historic counties — Surrey, Middlesex, Cornwall — which are a cartographic relic no
 * Jamaican address uses.
 */
function composeJamaican(street: string | undefined, town: string | undefined, parish?: string) {
  /**
   * Kingston is a town and a parish under one name, and Nominatim answers with both — `city:
   * "Kingston"`, `county: "Kingston"` — which composed unguarded reads `Peters Lane, Kingston,
   * Kingston`. The parish is the part that goes, being the one carrying no information once
   * the town has said it.
   */
  const distinctParish = parish && parish !== town ? parish : undefined;
  return [street, town, distinctParish].filter(Boolean).join(', ');
}

/** `1573 W Broad St, Athens, GA 30606` — the convention the dataset already follows. */
function composeAmerican(
  street: string | undefined,
  town: string | undefined,
  a: Record<string, string>,
  postcode?: string,
) {
  /**
   * The abbreviation comes from Nominatim's own `ISO3166-2-lvl4` (`US-GA`) rather than from a
   * table of fifty states compiled into the bundle — the service already knows, and a table
   * would be one more thing to be wrong about Puerto Rico or the District of Columbia.
   * Without that key the full name stays, which is a longer address and never a wrong one.
   */
  const subdivision = a['ISO3166-2-lvl4']?.split('-')[1];
  const state = subdivision && /^[A-Z]{2}$/.test(subdivision) ? subdivision : a.state;
  const region = [state, postcode].filter(Boolean).join(' ');
  return [street, town, region].filter(Boolean).join(', ');
}

/**
 * A street address a person would recognise, out of Nominatim's components.
 *
 * `display_name` is not usable as-is: "San Francisco Ferry Building, 1, Ferry Plaza,
 * Financial District, San Francisco, California, 94111, United States" is what one lookup
 * actually returns, and a longer one would breach the schema's 200-character cap — which
 * would be a submission rejected for a value the app itself wrote.
 *
 * The town key varies by country and by how densely mapped the place is, so all five are
 * tried. Falls back to `display_name` (truncated) rather than to nothing: a rough address a
 * reviewer can tidy beats an empty required field.
 */
function composeAddress(place: {
  display_name: string;
  address?: Record<string, string>;
}): { address: string; precision: AddressPrecision } {
  const a = place.address ?? {};
  /**
   * A house number is only ever written **with** its road. Nominatim will answer a point with
   * `house_number` and no `road` — a building mapped without the way it sits on — and joining
   * the pair unconditionally turned that into `125, Athens, GA 30606`: a street number with no
   * street, which reads as a typo and is worse than the town alone. The number is the part
   * that means nothing by itself, so it is the part that goes.
   */
  const street = a.road ? [a.house_number, a.road].filter(Boolean).join(' ') : '';
  /**
   * `county` and `municipality` at the end, because the first five keys are all *incorporated*
   * places. A rural address answers with none of them: measured, a point on Alcovy Circle in
   * Georgia returns only `county: "Newton County"`, and composing from the first five dropped
   * the locality entirely to leave `382 Alcovy Circle, GA 30014` — an address with no town in
   * it at all. A county is not a town and is listed last for that reason, but it is the name
   * the place actually has.
   */
  const town =
    a.city ?? a.town ?? a.village ?? a.hamlet ?? a.suburb ?? a.municipality ?? a.county;
  /**
   * `Athens, GA 30606`, not `Athens, Georgia, 30606` — the state abbreviated, and joined to
   * the postcode by a space rather than a comma.
   *
   * That is the convention every address already in `data/markets.json` follows, and matching
   * it is worth a few lines: a dataset where half the records read one way and half the other
   * is one nobody can search, sort or diff cleanly, and the app writing the odd ones out
   * would be the app making the mess.
   *
   * The abbreviation comes from Nominatim's own `ISO3166-2-lvl4` (`US-GA`) rather than from a
   * table of fifty states compiled into the bundle — the service already knows, and a table
   * would be one more thing to be wrong about Puerto Rico or the District of Columbia.
   * Without that key the full name stays, which is a longer address and never a wrong one.
   */
  /**
   * **The grammar follows the place, not the reader.** Nominatim names the country in its own
   * answer (`country_code`), and that is the right authority: somebody in Manchester looking up
   * a market in Maryland should still be shown an American address, because that is what is
   * written on the building and what a map app will accept back.
   */
  const country = a.country_code?.toUpperCase();
  const composed =
    country === 'GB'
      ? composeBritish(street || a.neighbourhood, town, a.postcode)
      : country === 'JM'
        ? composeJamaican(street || a.neighbourhood, town, a.county)
        : composeAmerican(street || a.neighbourhood, town, a, a.postcode);
  const precision: AddressPrecision = a.house_number && a.road ? 'building' : a.road ? 'street' : 'area';
  return {
    address: (composed.length >= 5 ? composed : place.display_name).slice(0, MAX_ADDRESS),
    // A fallback to `display_name` is not a street address however long it is, so it cannot
    // claim to be one.
    precision: composed.length >= 5 ? precision : 'area',
  };
}

/**
 * The most precisely placed of several candidates, preferring a house number over a road and
 * a road over an area.
 *
 * Ties keep the service's own order, so where nothing separates two results on precision the
 * answer is still Nominatim's ranking rather than something invented here. This never
 * *fabricates* precision — it only declines to take a road when a building was also offered.
 * A forward lookup with no house number anywhere in its results still reports `street`, and
 * the form still says so: filling a number the service did not return is the one thing this
 * must not do, because a forward match can be kilometres from the device (measured: 2.3 km on
 * the case that prompted this) and a wrong number that reads as exact rides into a committed
 * file looking like a checked one.
 */
function bestPlaced<T extends { address?: Record<string, string> }>(places: T[]): T {
  const rank = (p: T) => {
    const a = p.address ?? {};
    return a.house_number && a.road ? 2 : a.road ? 1 : 0;
  };
  return places.reduce((best, p) => (rank(p) > rank(best) ? p : best), places[0]);
}

/**
 * How exactly a lookup managed to place something.
 *
 * `building` is a house number on a named street — the shape the dataset wants. `street` is a
 * named street without a number, which is what a point in the middle of a car park or a long
 * kerb honestly resolves to. `area` is everything vaguer: a neighbourhood, a park, a town.
 *
 * It exists so the form can *say* which it got rather than presenting all three as equally
 * good. A street-level answer offered as though it were an address is how a market ends up in
 * the dataset at "W Broad St, Athens" with the number quietly missing.
 */
export type AddressPrecision = 'building' | 'street' | 'area';

/**
 * How complete an address *looks*, from 0 to 5.
 *
 * Deliberately a measure of the string rather than of where it came from, so the same
 * function scores what the geocoder returned and what a person typed, and the two are
 * comparable. That comparison is the whole point: `🔎 Find it from the address` replaces what
 * you typed only when what it found is richer, so "1573 w broad" becomes
 * "1573 W Broad St, Athens, GA 30606" while "west car park, behind the church" is left alone
 * unless the lookup genuinely returns more.
 *
 * The five signals are the parts of the format the dataset asks for — a house number, a
 * street, a town, a state and a postcode — read off the shape of the text: a leading number,
 * a postcode anywhere, and up to three comma-separated parts. It is a heuristic and says so;
 * what keeps it honest is that a tie leaves the reader's own words in place.
 *
 * **The postcode signal reads every grammar the app supports, not just the American one**, and
 * getting that wrong cost real data rather than points. The test was `\d{5}`, so a British
 * postcode scored nothing: measured, `8 southwark st, london, se1` scored **4** against
 * `8 Southwark Street, London SE1 1TL` at **3** — three commas beating a real postcode — so
 * the lookup kept the fragment and discarded the full address. `main st, keynsham, bristol`
 * tied with `Main Street, Keynsham, Bristol BS31 1EQ` and threw the postcode away the same
 * way. The comparison only has to be fair between the two strings, and it was not: one side
 * could earn a point the other could not spell.
 *
 * It stays a measure of the **string** and takes no country, which is the property that lets
 * one function score both what was typed and what came back. So the grammars are recognised
 * by shape, side by side. Jamaica contributes none, and that is not an omission — it has no
 * postal code to detect, so both sides of a Jamaican comparison simply score on the other four
 * signals, which is fair because neither can reach it.
 *
 * **A five-digit house number is not a postcode**, which the old test also got wrong:
 * `12610 Old Gunpowder Rd` scored the postcode point off its own door number. The leading
 * number is already counted by `startsWithNumber`, so it is removed before the postal token is
 * looked for and cannot be paid for twice.
 */
const POSTCODE_GRAMMARS = [
  /\b\d{5}(-\d{4})?\b/, // United States: 30606, 30606-1234
  /\b[A-Z]{1,2}\d[A-Z\d]?\s*\d[A-Z]{2}\b/i, // United Kingdom: SE1 1TL, BS31 1EQ, M1 1AE
];

export function addressDetail(text: string): number {
  const trimmed = text.trim();
  if (trimmed === '') return 0;
  const startsWithNumber = /^\d+[a-z]?\s+\S/i.test(trimmed) ? 1 : 0;
  const withoutHouseNumber = trimmed.replace(/^\d+[a-z]?\s+/i, '');
  const hasPostcode = POSTCODE_GRAMMARS.some((re) => re.test(withoutHouseNumber)) ? 1 : 0;
  const parts = Math.min(trimmed.split(',').filter((p) => p.trim() !== '').length, 3);
  return startsWithNumber + hasPostcode + parts;
}

export interface GeocodeHit {
  lat: number;
  lon: number;
  /** The service's own name for the place, shown so somebody can see what was found. */
  label: string;
  /**
   * The same place written as `<number> <street>, <town>, <state>, <postcode>` — the format
   * the dataset asks for, and short enough for the schema's 200-character cap, which
   * `display_name` frequently is not.
   *
   * Absent when the service returned no components to compose from.
   */
  address?: string;
  /** How exactly the service managed to place it. Absent for the same reason `address` is. */
  precision?: AddressPrecision;
}

export type GeocodeFailure =
  | 'too-short'
  | 'no-match'
  | 'unreachable'
  | 'malformed'
  | 'throttled';

export type GeocodeOutcome = ({ ok: true } & GeocodeHit) | { ok: false; reason: GeocodeFailure };

/**
 * Every failure says what happened and what to do instead, because the thing to do instead
 * always exists: the coordinate fields are still there and still editable. A lookup that
 * fails must never read as a dead end (style guide §5).
 */
export const GEOCODE_MESSAGES: Record<GeocodeFailure, string> = {
  'too-short': 'Type the street address first, then press this.',
  'no-match': "Couldn't find that address. Check it, or type the coordinates yourself.",
  unreachable: "Couldn't reach the lookup service. Type the coordinates instead.",
  malformed: 'The lookup service sent something unexpected. Type the coordinates instead.',
  throttled: 'One lookup a second, please — try again in a moment.',
};

/**
 * The same failures, told to a reader who has no coordinate fields to fall back on.
 *
 * `GEOCODE_MESSAGES` sends people to the latitude and longitude inputs, which is right on the
 * submit form and nonsense on the list — there is nothing there to type a coordinate into.
 * Two audiences, two sets of words, one rule: every failure names something the reader can
 * actually do next.
 */
export const PLACE_MESSAGES: Record<GeocodeFailure, string> = {
  'too-short': 'Type a town, address or postcode first.',
  'no-match': "Couldn't find that place. Check the spelling, or try a nearby town.",
  unreachable: "Couldn't reach the place lookup. Search by market name instead.",
  malformed: 'The place lookup sent something unexpected. Search by market name instead.',
  throttled: 'One lookup a second, please — try again in a moment.',
};

const cache = new Map<string, GeocodeHit>();

/** Collapses whitespace and case so "1 Ferry Bldg " and "1 ferry bldg" are one query. */
function cacheKey(address: string): string {
  return address.trim().replace(/\s+/g, ' ').toLowerCase();
}

let lastRequestAt = 0;

/** Test seam. Nothing in the app calls this; a fresh module per screen is not a thing here. */
export function resetGeocodeState(): void {
  cache.clear();
  lastRequestAt = 0;
}

/** Half-width of the bias box, in degrees — roughly 220 km of latitude either side. */
const BIAS_SPAN_DEG = 2;

export interface GeocodeOptions {
  /** Injected so tests can exercise the interval without sleeping or reading the wall clock. */
  now?: () => number;
  /**
   * How to pause between two requests made for one press — injected for the same reason `now`
   * is, so the suite exercises the second lookup without spending a real second on it.
   *
   * Only the reverse direction's street fallback uses it, and it is not optional there: that
   * path deliberately asks twice, and the usage policy is one request a second whatever the
   * app thinks it is doing.
   */
  wait?: (ms: number) => Promise<void>;
  /**
   * Where the reader is, used to break ties — the best answer to "which 20904 did you mean"
   * is "the one near you".
   *
   * Sent as a `viewbox`, which **biases** ranking rather than filtering: a box is a hint, so
   * somebody in Maryland searching for a market in Oregon still finds it, just below the
   * local matches. That is why this outranks `countrycodes` instead of joining it — the
   * country code is a hard filter, and applying both would let a compiled-in default veto
   * the reader's own position.
   */
  near?: { lat: number; lon: number };
  /**
   * Which country the reader has told the app they are in, used only where `near` is absent.
   *
   * It outranks `GEOCODE_COUNTRIES` because that is a *build-time* answer — baked in when the
   * bundle was made, and `us` for every build this project ships. A reader in Manchester who
   * declines location and types `Piccadilly` would otherwise be filtered to American results
   * and told nothing was found, which is a dead end produced entirely by a compiled-in
   * assumption about where they live.
   *
   * Still behind `near`, for the reason below: a stated position beats a stated country, and
   * sending a hard filter alongside a bias would let the country veto the position.
   */
  country?: string;
}

/** One request, identified and error-mapped. Both directions go through here. */
async function ask(
  path: 'search' | 'reverse',
  params: Record<string, string>,
): Promise<{ json: unknown } | { ok: false; reason: GeocodeFailure }> {
  let res: Response;
  try {
    res = await fetch(`${endpoint(path)}?${new URLSearchParams(params)}`, {
      headers: {
        accept: 'application/json',
        // Forbidden on the web and dropped there; the browser's own Referer identifies us
        // instead. Native has no Referer, so this is the only identification it sends.
        'user-agent': GEOCODE_USER_AGENT,
      },
    });
  } catch {
    return { ok: false, reason: 'unreachable' };
  }
  if (!res.ok) return { ok: false, reason: 'unreachable' };
  return { json: await res.json().catch(() => null) };
}

/**
 * Coordinates arrive as strings and are typed as nothing more, so they are checked here
 * against the same bounds the feature schema enforces. A coordinate CI would reject must
 * never reach the form looking as though it had succeeded.
 */
function toPoint(lat: string, lon: string): { lat: number; lon: number } | null {
  const y = Number(lat);
  const x = Number(lon);
  if (!Number.isFinite(y) || !Number.isFinite(x)) return null;
  if (y < -90 || y > 90 || x < -180 || x > 180) return null;
  return { lat: y, lon: x };
}

/** Caches a hit, evicting the oldest first, and returns it. */
function remember(key: string, found: GeocodeHit): GeocodeOutcome {
  if (cache.size >= MAX_CACHE_ENTRIES) {
    const oldest = cache.keys().next();
    if (!oldest.done) cache.delete(oldest.value);
  }
  cache.set(key, found);
  return { ok: true, ...found };
}

/**
 * Looks up one address. Cache first, so a repeat press of an answered address is free and
 * never touches the network — which is both the polite thing and the fast one.
 */
export async function geocode(
  address: string,
  { now = Date.now, near, country }: GeocodeOptions = {},
): Promise<GeocodeOutcome> {
  // The bias is part of the question, so it is part of the key — otherwise a lookup made in
  // one place would be served from cache to somebody standing somewhere else.
  // The country is part of the question exactly as the bias is: `Piccadilly` filtered to `gb`
  // and `Piccadilly` filtered to `us` are different queries, and one reader must never be
  // served the other's answer out of cache.
  const key =
    cacheKey(address) +
    (near ? `@${near.lat.toFixed(1)},${near.lon.toFixed(1)}` : `#${country ?? ''}`);
  if (key.length < MIN_ADDRESS_LENGTH) return { ok: false, reason: 'too-short' };

  const hit = cache.get(key);
  if (hit) return { ok: true, ...hit };

  // Checked after the cache on purpose: a cache hit is not a request, so it cannot breach a
  // limit on requests, and refusing one would punish the press most likely to be a correction.
  const at = now();
  if (at - lastRequestAt < MIN_INTERVAL_MS) return { ok: false, reason: 'throttled' };
  lastRequestAt = at;

  // Where you are beats where the app thinks you live, which beats where the build thinks you
  // live. With a location we bias by viewbox and send no country at all; without one we filter
  // by the reader's own setting, and only failing that by the compiled-in default.
  // Never both: `countrycodes` is a hard filter, so a country would veto the position.
  const bias: Record<string, string> = near
    ? {
        viewbox: [
          near.lon - BIAS_SPAN_DEG,
          near.lat - BIAS_SPAN_DEG,
          near.lon + BIAS_SPAN_DEG,
          near.lat + BIAS_SPAN_DEG,
        ].join(','),
      }
    : // The reader's own country first, then the build's. Omitted when blank: Nominatim reads
      // an empty `countrycodes` as a filter matching nothing rather than as no filter at all.
      (country?.toLowerCase() ?? GEOCODE_COUNTRIES)
      ? { countrycodes: country?.toLowerCase() ?? GEOCODE_COUNTRIES }
      : {};

  const body = await ask('search', {
    q: key,
    format: 'jsonv2',
    // The component breakdown, for the same reason reverse asks for it: `display_name` is a
    // tour of the administrative hierarchy and the dataset wants a street address.
    addressdetails: '1',
    ...bias,
    /**
     * Three results, and the most precisely placed of them wins.
     *
     * It asked for one, on the argument that the form shows what came back and lets somebody
     * correct it, which beats a picker — a list of five near-identical addresses is a
     * question most people cannot answer. **That argument stands and is not what changed.**
     * Nothing here asks the reader anything: the choice is made on precision, not handed
     * over.
     *
     * What changed is a measured failure. `12610 Old Gunpowder Road, Beltsville, MD` returned
     * a single street-level hit 2.3 km from the device, with no house number, and the app took
     * it because it was the only thing offered. Nominatim ranks by its own relevance, not by
     * how exactly a result is placed, so the first hit can be a road when a building is second.
     * Asking for three costs the same one request and lets `bestPlaced` prefer a
     * house-numbered answer over a road.
     *
     * Three rather than five or ten: the pick only ever compares precision, so the gain falls
     * away quickly, and a longer list is more of somebody's data in a cache for no benefit.
     */
    limit: '3',
  });
  if ('reason' in body) return body;

  const parsed = NominatimResponse.safeParse(body.json);
  if (!parsed.success) return { ok: false, reason: 'malformed' };
  if (parsed.data.length === 0) return { ok: false, reason: 'no-match' };

  const place = bestPlaced(parsed.data);
  const point = toPoint(place.lat, place.lon);
  if (!point) return { ok: false, reason: 'malformed' };

  const composed = composeAddress(place);
  return remember(key, {
    ...point,
    label: place.display_name,
    address: composed.address,
    precision: composed.precision,
  });
}

/**
 * The other direction: coordinates to a street address, for `📍 Use my current location`.
 *
 * It exists because that button filled two of the three required fields and left the third
 * — a person standing in the market still had to type where they were standing, which is
 * the same "you already told us, now tell us again" the forward lookup removed. The address
 * stays required either way: `MarketProperties.address` is what a shopper actually reads to
 * find the stand, and no coordinate pair substitutes for it.
 */
export async function reverseGeocode(
  lat: number,
  lon: number,
  {
    now = Date.now,
    wait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)),
  }: GeocodeOptions = {},
): Promise<GeocodeOutcome> {
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return { ok: false, reason: 'malformed' };

  // Six decimals, the same precision the form writes, so pressing the button twice from one
  // spot is a cache hit rather than a second request. Prefixed so a coordinate key can never
  // collide with an address someone typed.
  const key = `\u0000reverse:${lat.toFixed(6)},${lon.toFixed(6)}`;
  const hit = cache.get(key);
  if (hit) return { ok: true, ...hit };

  const at = now();
  if (at - lastRequestAt < MIN_INTERVAL_MS) return { ok: false, reason: 'throttled' };
  lastRequestAt = at;

  // No `countrycodes` here: reverse is handed a point, and a point is already in whatever
  // country it is in. Restricting it could only turn a correct answer into no answer.
  const body = await ask('reverse', {
    lat: String(lat),
    lon: String(lon),
    format: 'jsonv2',
    // The component breakdown, because `display_name` is too long for the address field.
    addressdetails: '1',
    // Building level, which is as fine as Nominatim goes. Left unset it answers at whatever
    // zoom it considers natural for the point, which for a kerbside fix is often the street
    // or the suburb — and the difference between "1573 W Broad St" and "West Broad Street" is
    // the difference between an address somebody can walk to and one a reviewer has to chase.
    // Asking for 18 does not invent a house number where none is mapped; it stops the service
    // rounding one away where one exists.
    zoom: '18',
  });
  if ('reason' in body) return body;

  const parsed = NominatimReverse.safeParse(body.json);
  // Nothing there to name is an ordinary answer over open water or a new estate, not a
  // fault: reverse replies `{ error: "Unable to geocode" }`, which fails this parse.
  if (!parsed.success) return { ok: false, reason: 'no-match' };

  let composed = composeAddress(parsed.data);

  /**
   * **When the building-level answer has no street, ask again one zoom out.**
   *
   * `zoom=18` answers with the closest building-level object, and some of those carry no road
   * at all — a building with no address tags, a parcel, a point inside a landuse polygon. The
   * lookup then reported an area and stopped, leaving `Fairland, MD 20904` on a form whose
   * whole purpose is a street address, while the street itself was a few metres away and
   * perfectly well mapped. Measured: a point inside Fairland Regional Park answers
   * `amenity/school` at 18 and `highway/residential` at 17.
   *
   * `zoom=17` is the streets level, so this is asking the question the reader actually has —
   * *what street am I on* — rather than settling for the enclosing district.
   *
   * **A house number in that answer is kept**, and the rule it looks like it breaks is a
   * different rule. "Neither direction ever invents a house number" forbids *fabricating* one
   * — filling a number nothing returned — and the forward direction is where that bites,
   * because a road match 2.3 km away would be wrong and far. This is reverse: it is anchored
   * to a real point, so the worst it produces is the neighbour rather than the fabrication.
   * That is the trade already made one zoom in, where `12614` comes back for a doorway 21 m
   * from `12610` and is kept, on the grounds that a near miss somebody can correct beats an
   * address with a hole in it. One zoom out does not change what kind of answer it is.
   *
   * It costs a second request on a path that is already rare, and it takes the interval the
   * usage policy asks for before making it, rather than firing two in the same tick.
   */
  if (composed.precision === 'area') {
    await wait(MIN_INTERVAL_MS);
    lastRequestAt = now();
    const wider = await ask('reverse', {
      lat: String(lat),
      lon: String(lon),
      format: 'jsonv2',
      addressdetails: '1',
      zoom: '17',
    });
    if (!('reason' in wider)) {
      const widerParsed = NominatimReverse.safeParse(wider.json);
      if (widerParsed.success && widerParsed.data.address?.road) {
        const named = composeAddress(widerParsed.data);
        // Only if it actually gained a street. A second area is not an improvement, and
        // replacing one with another would churn the field for nothing. `building` counts:
        // the coarser answer is allowed its house number (see above), so it can come back
        // with a complete address rather than only a street.
        if (named.precision !== 'area') composed = named;
      }
    }
  }

  // `label` is the composed address here rather than `display_name`: on this path the label
  // *is* what goes in the field, and the two being the same string is what keeps the message
  // under the field honest about what was filled in.
  return remember(key, {
    lat,
    lon,
    label: composed.address,
    address: composed.address,
    precision: composed.precision,
  });
}
