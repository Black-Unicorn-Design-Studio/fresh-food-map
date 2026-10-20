import {
  COUNTRY_UNITS,
  DEFAULT_COUNTRY,
  type CountryCode,
  type DistanceUnit,
} from '@/constants/countries';

export interface LatLon {
  lat: number;
  lon: number;
}

const EARTH_RADIUS_KM = 6371;

export function haversineKm(a: LatLon, b: LatLon): number {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLon = toRad(b.lon - a.lon);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.sqrt(h));
}

export function formatDistance(km: number, unit: DistanceUnit = 'mi'): string {
  const value = unit === 'km' ? km : km / KM_PER_MILE;
  // `nearby` rather than `0.1 km`: below a few hundred metres the number is noise against the
  // accuracy of the fix it was computed from, and a shopper reads it as "you are basically
  // there" either way. The thresholds are the same distance in both units, not the same digit.
  if (value < (unit === 'km' ? 0.3 : 0.2)) return 'nearby';
  if (value < 10) return `${value.toFixed(1)} ${unit}`;
  return `${Math.round(value)} ${unit}`;
}

/** Fallback map center when location is unavailable: continental US. */
/**
 * Where the map opens before it knows anything: no location granted, no place typed, nothing
 * filtered yet.
 *
 * Per country, because a single continental-US centroid meant a reader in Manchester who
 * declined location opened the app on **Kansas** — a thousand miles of empty prairie and not
 * one market, which reads as a broken app rather than as a map waiting for permission.
 *
 * These are viewing centres rather than geographic ones. `GB` sits slightly north of the
 * population weight so that a single default zoom shows Scotland as well as London.
 */
export const DEFAULT_CENTERS: Record<CountryCode, LatLon> = {
  US: { lat: 39.8, lon: -98.5 },
  GB: { lat: 53.8, lon: -2.5 },
  JM: { lat: 18.1, lon: -77.3 },
};

/**
 * The fallback's fallback. Kept as a named export because it is what everything that has no
 * country to hand still reaches for, and because removing it would turn a wrong centre into a
 * crash — which is a worse failure for a value this cheap to be approximately right about.
 */
export const DEFAULT_CENTER: LatLon = DEFAULT_CENTERS[DEFAULT_COUNTRY];

/**
 * The whole country, as a camera box.
 *
 * The map opens fitted to this rather than parked on a centroid at a fixed zoom. A centre plus
 * a guessed zoom is two numbers that have to agree about a country's *shape*, and they did not:
 * 39.8, -98.5 at zoom 3.5 put a reader with no location in the middle of **Kansas**, looking at
 * a thousand miles of prairie with no markets in it. A box has no such problem — `bounds`
 * outranks `center`/`zoom` on both map files, and fitting one shows the country whatever shape
 * it is and whatever size the screen is.
 *
 * Generous rather than tight. These clip the far-flung parts deliberately: the continental
 * United States without Alaska or Hawaii, and Great Britain without Shetland, because
 * including them zooms out far enough to make everywhere else unreadable in order to show sea.
 *
 * Jamaica is the one that needs no clipping and no judgement: the whole island is 235 km by
 * 82 km, so the country box and a useful working frame are the same rectangle. That is worth
 * naming because it makes the opening view meaningfully different there — a Jamaican reader
 * who declines location opens on a map where every market is already on screen, where an
 * American one opens on a country they must still navigate.
 */
export const COUNTRY_BOUNDS: Record<CountryCode, Bounds> = {
  US: [-125, 24.5, -66.9, 49.4],
  GB: [-8.2, 49.9, 1.8, 58.7],
  JM: [-78.45, 17.65, -76.15, 18.6],
};

/** The opening frame for a reader in a given country. */
export function boundsForCountry(country: CountryCode): Bounds {
  return COUNTRY_BOUNDS[country] ?? COUNTRY_BOUNDS[DEFAULT_COUNTRY];
}

/** The opening centre for a reader in a given country. */
export function defaultCenterFor(country: CountryCode): LatLon {
  return DEFAULT_CENTERS[country] ?? DEFAULT_CENTER;
}

/** A camera box, in the flat order MapLibre takes on both platforms. */
export type Bounds = [west: number, south: number, east: number, north: number];

/**
 * Floor on a fitted box, in degrees — roughly 5.5km north to south.
 *
 * Without it, standing next to a market fits the camera to a box metres wide and the map
 * arrives at maximum zoom showing one pin and no context. This is a floor and not a
 * clamp on zoom: capping the camera's `maxZoom` would also stop the shopper zooming in
 * by hand, which is a different thing entirely.
 */
const MIN_SPAN_DEG = 0.05;

/**
 * The smallest box containing every point, never narrower than {@link MIN_SPAN_DEG}.
 *
 * Latitude is clamped to the Web Mercator limit, past which a camera cannot go. Longitude
 * is not wrapped: a box spanning the antimeridian would need to be split, and every caller
 * here fits points already near each other.
 */
export function boundsAround(points: LatLon[]): Bounds | null {
  if (points.length === 0) return null;

  const lats = points.map((p) => p.lat);
  const lons = points.map((p) => p.lon);
  const [south, north] = widen(Math.min(...lats), Math.max(...lats));
  const [west, east] = widen(Math.min(...lons), Math.max(...lons));

  return [west, Math.max(south, -85), east, Math.min(north, 85)];
}

/** Grows a span symmetrically about its midpoint until it reaches the floor. */
function widen(low: number, high: number): [number, number] {
  const shortfall = MIN_SPAN_DEG - (high - low);
  if (shortfall <= 0) return [low, high];
  return [low - shortfall / 2, high + shortfall / 2];
}

/**
 * Miles to kilometres, because the radius is spoken in miles and measured in kilometres.
 * `haversineKm` is the only distance function here and changing its unit would touch the
 * sort, the cards and the map; converting at the one boundary that needs it is cheaper.
 */
const KM_PER_MILE = 1.609344;

/**
 * The radii `📍 NEAR ME` tries, in order, stopping at the first that finds anything.
 *
 * 25 is the number the filter is named for and the one it uses whenever it can. The wider
 * two exist so the control is never a dead end: with 61 records, most of them in one state,
 * a reader outside Maryland would otherwise press it and get an empty list with no
 * explanation — which reads as a broken control rather than as a thin dataset.
 *
 * **Widening is only acceptable because it is announced.** A chip that says 25 miles while
 * quietly using 100 would make the market count untrustworthy, and §4 is emphatic that a
 * count must promise what the filter will actually give. So `nearestWithin` returns the
 * radius it settled on, and the screen says so whenever it is not the first one.
 */
export const NEAR_ME_RADII_MILES = [25, 50, 100] as const;

/**
 * The same ladder in kilometres, and deliberately **round numbers rather than conversions**.
 *
 * 25 miles is 40.2 km. A chip reading `WITHIN 40 KM` is a radius a reader can hold in their
 * head; one reading `WITHIN 40.2 KM` is a unit conversion performed in public, which tells
 * them the app is really thinking in miles and translating for them. The three rungs keep the
 * same shape — a town, a county, a region — which is what the ladder is actually for.
 */
/**
 * One ladder for every metric country, and it is a better fit for some than others. On an
 * island 235 km long the third rung is most of Jamaica, so a Jamaican reader who widens twice
 * is told `WITHIN 160 KM` about a search that could only ever have covered the country — true,
 * and coarser than the "town, county, region" shape the rungs are meant to carry.
 *
 * Left shared deliberately. A per-country ladder is a fourth `Record<CountryCode, …>` and a
 * fourth promise to keep, and the failure it would fix is a chip that reads wider than it
 * needed to rather than a wrong result: the widening still finds what it finds, and still
 * says it had to look further. Revisit it if field testing says the number misleads.
 */
export const NEAR_ME_RADII_KM = [40, 80, 160] as const;

/** The ladder for a unit. */
export function radiiFor(unit: DistanceUnit): readonly number[] {
  return unit === 'km' ? NEAR_ME_RADII_KM : NEAR_ME_RADII_MILES;
}

/**
 * The markets within a radius of a point, and the radius that found them.
 *
 * Tries each radius in turn and returns the first non-empty result, so the answer is "the
 * nearest within 25 miles" where that exists and "…within 50" where it does not. `miles` is
 * what the caller must display — see the note on `NEAR_ME_RADII_MILES`. With nothing found
 * at any radius it reports the widest tried, so the message can say how far it looked.
 */
/**
 * Markets near a point that the reader's country setting is hiding from them.
 *
 * **It asks about the data, not about the reader.** The obvious way to notice that somebody is
 * in the wrong country is to work out which country they are standing in, and both routes to
 * that are bad here. Reverse-geocoding is the accurate one and is forbidden: the geocoder is
 * on the submit path only, behind an explicit press, and `📍 NEAR ME` is neither — running it
 * on a discovery press would breach Nominatim's policy and put a reader's position on the wire
 * for a feature that has never needed the network. The offline one is `COUNTRY_BOUNDS`, and a
 * rectangle is not a country: the British box contains Dublin and the American one contains
 * Toronto, so it would tell an Irish reader, confidently and in their own language, that they
 * are in the United Kingdom.
 *
 * So the question is turned round. Rather than "which country is this person in", which the
 * app cannot honestly answer, it asks **"does the dataset hold markets near this point that
 * the current setting is filtering out"** — which the app can answer exactly, from data
 * already in memory, with no network and no geography. The answer is also the more useful
 * one: it names a number of markets a reader could actually go to rather than an opinion
 * about where they are standing, and it stays silent when there is nothing to offer, which is
 * the correct behaviour for somebody genuinely out of range of everything.
 *
 * **The count it reports is the count the reader will actually see**, which is not the same as
 * "markets within the radius searched" and was that until a browser run caught it: the offer
 * promised 5 in Jamaica and the list showed 3 after switching, because the 5 were inside the
 * American ladder's widest rung and the 3 were inside Jamaica's narrowest. Both numbers were
 * true and the reader would have been counting the two that went missing. So each candidate
 * country is asked the question it will be asked after the switch — `nearestWithin` against
 * its own ladder, in its own units — and the answer is what the offer prints.
 *
 * That also removes the need for a radius argument. A country whose own ladder finds nothing
 * is not offered, so a reader in London is never invited to Jamaica: the bound falls out of
 * the ladder rather than being a second number to keep in step with it.
 *
 * Ranked by how many, then by which country's nearest market is closest — deterministic
 * either way, so two countries tying on count do not swap places when the dataset is reordered.
 */
export function nearbyInOtherCountry<T extends LatLon & { country?: CountryCode }>(
  markets: readonly T[],
  origin: LatLon,
  exclude: CountryCode,
): { country: CountryCode; count: number; nearestKm: number } | null {
  // A record with no country is not evidence about any country, so it cannot be offered.
  const byCountry = new Map<CountryCode, T[]>();
  for (const m of markets) {
    if (!m.country || m.country === exclude) continue;
    const bucket = byCountry.get(m.country);
    if (bucket) bucket.push(m);
    else byCountry.set(m.country, [m]);
  }

  let best: { country: CountryCode; count: number; nearestKm: number } | null = null;
  for (const [country, theirs] of byCountry) {
    const unit = COUNTRY_UNITS[country];
    const found = nearestWithin(theirs, origin, radiiFor(unit), unit);
    if (found.markets.length === 0) continue;
    const nearestKm = Math.min(...found.markets.map((m) => haversineKm(origin, m)));
    const count = found.markets.length;
    if (!best || count > best.count || (count === best.count && nearestKm < best.nearestKm)) {
      best = { country, count, nearestKm };
    }
  }
  return best;
}

export function nearestWithin<T extends LatLon>(
  markets: readonly T[],
  origin: LatLon,
  radii: readonly number[] = NEAR_ME_RADII_MILES,
  unit: DistanceUnit = 'mi',
): { markets: T[]; radius: number; unit: DistanceUnit; widened: boolean } {
  for (const [index, radius] of radii.entries()) {
    const limit = unit === 'km' ? radius : radius * KM_PER_MILE;
    const found = markets.filter((m) => haversineKm(origin, m) <= limit);
    if (found.length > 0) return { markets: found, radius, unit, widened: index > 0 };
  }
  const widest = radii[radii.length - 1] ?? 0;
  return { markets: [], radius: widest, unit, widened: radii.length > 1 };
}

/**
 * A box around a point that is `miles` across in every direction, for framing the radius
 * `📍 NEAR ME` searched rather than just the markets it found.
 *
 * Framing the results alone would zoom to whatever happens to be nearby — two markets a
 * street apart would fill the screen and hide that the filter looked twenty-five miles out.
 * The box is the honest camera for a radius filter: it shows the area the question covered.
 *
 * Longitude degrees shrink with latitude, so the east-west span is divided by cos(lat). At
 * the poles that tends to infinity, hence the clamp — a box wider than the world is not one.
 */
export function boundsForRadius(origin: LatLon, radius: number, unit: DistanceUnit = 'mi'): Bounds {
  const km = unit === 'km' ? radius : radius * KM_PER_MILE;
  const latSpan = km / 111.32;
  const cos = Math.max(Math.cos((origin.lat * Math.PI) / 180), 0.01);
  const lonSpan = Math.min(latSpan / cos, 180);
  return [
    Math.max(origin.lon - lonSpan, -180),
    Math.max(origin.lat - latSpan, -90),
    Math.min(origin.lon + lonSpan, 180),
    Math.min(origin.lat + latSpan, 90),
  ];
}
