/**
 * The pure half of the discovery path: distance, ordering, filtering, formatting.
 *
 * Everything here runs on the phone with no network and no service behind it, so
 * a wrong answer is not an error anyone sees — it is a market quietly missing
 * from a list, or a filter that widens when the shopper meant to narrow.
 *
 * Covers the exported pure functions plus `parseCollection`, which is what narrows a
 * feature on the way in — dropping unknown tag values and inactive markets. Not the React
 * Query hooks: fetching and caching are the library's business, not this project's.
 */
import { strict as assert } from 'node:assert';
import { describe, test } from 'node:test';

import {
  boundsAround,
  boundsForRadius,
  formatDistance,
  haversineKm,
  nearbyInOtherCountry,
  nearestWithin,
  radiiFor,
} from '@/lib/geo';
import * as markets from '@/lib/markets';
import {
  availableTags,
  filterByTags,
  formatSchedule,
  formatSeason,
  searchMarkets,
  sortByDistance,
  type Market,
} from '@/lib/markets';

/** A published market with only the fields a given test cares about spelled out. */
function market(over: Partial<Market> & { name: string }): Market {
  return {
    id: `id-${over.name}`,
    address: '1 Test Street, Somewhere',
    lat: 0,
    lon: 0,
    schedule: [],
    seasonStart: null,
    seasonEnd: null,
    website: null,
    source: 'manual',
    tags: [],
    ...over,
  };
}

const names = (ms: Market[]) => ms.map((m) => m.name);

function closeTo(actual: number, expected: number, tolerance: number, what: string) {
  assert.ok(
    Math.abs(actual - expected) <= tolerance,
    `${what}: expected ${expected} ±${tolerance}, got ${actual}`
  );
}

describe('haversineKm', () => {
  // The module commits to a sphere of r=6371 km, so a degree of latitude is
  // 2πr/360 = 111.1949 km exactly — a reference value that does not depend on
  // anyone else's dataset, unlike a city pair.
  const DEGREE_KM = 111.1949;

  test('one degree of latitude measures the sphere this module declares', () => {
    closeTo(haversineKm({ lat: 0, lon: 0 }, { lat: 1, lon: 0 }), DEGREE_KM, 0.001, '1° lat');
  });

  test('one degree of longitude at the equator measures the same as latitude', () => {
    closeTo(haversineKm({ lat: 0, lon: 0 }, { lat: 0, lon: 1 }), DEGREE_KM, 0.001, '1° lon');
  });

  test('two points a degree apart are nearer at high latitude than at the equator', () => {
    // Longitude lines converge; a distance function that forgot the cos(lat)
    // term would return the same number for both and put far-north markets in
    // the wrong order.
    const atEquator = haversineKm({ lat: 0, lon: 0 }, { lat: 0, lon: 1 });
    const atAnchorage = haversineKm({ lat: 61.2, lon: 0 }, { lat: 61.2, lon: 1 });
    assert.ok(atAnchorage < atEquator / 2, `expected convergence, got ${atAnchorage}`);
  });

  test('a known city pair matches the published great-circle distance', () => {
    // Paris → London, ~343.5 km great circle.
    closeTo(
      haversineKm({ lat: 48.8566, lon: 2.3522 }, { lat: 51.5074, lon: -0.1278 }),
      343.5,
      1,
      'Paris–London'
    );
  });

  test('half the world apart returns half the circumference rather than NaN', () => {
    // h reaches exactly 1 here; asin(sqrt(1)) is the domain edge, and a formula
    // that overshot it would hand the sort a NaN and scramble the whole list.
    const half = haversineKm({ lat: 0, lon: 0 }, { lat: 0, lon: 180 });
    assert.ok(Number.isFinite(half), 'antipodal distance must be a number');
    closeTo(half, Math.PI * 6371, 0.001, 'half circumference');
  });

  test('distance is the same measured in either direction', () => {
    const ferryPlaza = { lat: 37.7955, lon: -122.3937 };
    const unionSquare = { lat: 40.7359, lon: -73.9903 };
    assert.equal(
      haversineKm(ferryPlaza, unionSquare),
      haversineKm(unionSquare, ferryPlaza)
    );
  });

  test('a point is zero kilometres from itself', () => {
    assert.equal(haversineKm({ lat: 37.7955, lon: -122.3937 }, { lat: 37.7955, lon: -122.3937 }), 0);
  });
});

/**
 * What NEAR ME frames. Getting this wrong is not a visible error: the camera simply
 * arrives somewhere unhelpful — too tight to show the market, or so wide the shopper
 * cannot tell which pin is theirs.
 */
/**
 * The network boundary. `parseCollection` trusts the bundle because CI validated the file it
 * was compiled from; this one is handed bytes from a URL, where none of that travels with the
 * data. Each case below is a way the app previously broke or would have.
 */
describe('parseFetchedCollection', () => {
  const feature = (over: Record<string, unknown> = {}, geom?: unknown) => ({
    type: 'Feature',
    geometry: geom ?? { type: 'Point', coordinates: [-83.4, 33.95] },
    properties: {
      id: '3f1a2b4c-5d6e-4f70-8a9b-0c1d2e3f4a5b',
      name: 'Test Market',
      address: '1 Test Street, Somewhere',
      schedule: [],
      season_start: null,
      season_end: null,
      website: null,
      source: 'manual',
      source_ref: null,
      tags: [],
      active: true,
      country: 'US',
      timezone: 'America/Los_Angeles',
      ...over,
    },
  });
  const collection = (features: unknown[]) => ({ type: 'FeatureCollection', name: 'test', features });

  test('distance is shown in the unit the reader was given, not converted in public', () => {
    // 5 km is 3.1 miles. A reader in Britain sees `5.0 km`; one in America sees `3.1 mi`.
    assert.equal(formatDistance(5), '3.1 mi');
    assert.equal(formatDistance(5, 'mi'), '3.1 mi');
    assert.equal(formatDistance(5, 'km'), '5.0 km');
    // Above ten it rounds in either unit, because a tenth of a mile at that range is noise.
    assert.equal(formatDistance(50, 'km'), '50 km');
    assert.equal(formatDistance(50, 'mi'), '31 mi');
  });

  test('`nearby` is the same distance in both units, not the same digit', () => {
    // 0.25 km is about 0.16 mi — under the mile threshold and over the kilometre one, which
    // is the case that catches a threshold copied across without being converted.
    assert.equal(formatDistance(0.25, 'mi'), 'nearby');
    assert.equal(formatDistance(0.25, 'km'), 'nearby');
    assert.equal(formatDistance(0.5, 'km'), '0.5 km');
  });

  test('the metric ladder is round numbers, not conversions of the imperial one', () => {
    // 25 miles is 40.2 km. A chip reading `WITHIN 40.2 KM` is a unit conversion performed in
    // public; the rungs keep their shape — a town, a county, a region — in whole numbers.
    assert.deepEqual([...radiiFor('km')], [40, 80, 160]);
    assert.deepEqual([...radiiFor('mi')], [25, 50, 100]);
  });

  test('a radius in kilometres searches kilometres', () => {
    // Directly north: 0.35 degrees of latitude is about 39 km, inside a 40 km radius and
    // outside a 25 mile (40.2 km) one only by the margin between them — so this pins that the
    // km ladder is not silently multiplied by 1.609.
    const origin = { lat: 51.5, lon: -0.12 };
    const near = { lat: 51.85, lon: -0.12 };
    const km = nearestWithin([near], origin, radiiFor('km'), 'km');
    assert.equal(km.markets.length, 1);
    assert.equal(km.radius, 40);
    assert.equal(km.unit, 'km');
    assert.equal(km.widened, false);
  });

  test('a well-formed collection comes through', () => {
    const out = markets.parseFetchedCollection(collection([feature()]));
    assert.equal(out.length, 1);
    assert.equal(out[0].name, 'Test Market');
  });

  /**
   * A latitude of 999 reached MapLibre's LngLat constructor, which throws — and no route
   * exports an ErrorBoundary, so React unmounted the root and the map went blank. One bad
   * number in the feed was a total denial of service, not one bad pin.
   */
  test('an out-of-range coordinate is rejected rather than handed to the map', () => {
    assert.throws(
      () => markets.parseFetchedCollection(collection([feature({}, { type: 'Point', coordinates: [-83.4, 999] })])),
      /failed validation/
    );
  });

  test('coordinates that are not numbers are rejected', () => {
    assert.throws(
      () => markets.parseFetchedCollection(collection([feature({}, { type: 'Point', coordinates: ['2', '1;DROP'] })])),
      /failed validation/
    );
  });

  /** `javascript:` in `website` reaches Linking.openURL unguarded on native. */
  test('a website that is not an https URL is rejected', () => {
    assert.throws(
      () => markets.parseFetchedCollection(collection([feature({ website: 'javascript:alert(1)' })])),
      /failed validation/
    );
  });

  test('a source outside the provenance vocabulary is rejected', () => {
    assert.throws(
      () => markets.parseFetchedCollection(collection([feature({ source: 'nonsense-source' })])),
      /failed validation/
    );
  });

  /**
   * The one valid response that must not be believed: it parses cleanly and would replace
   * every market with none — an empty app, no error, and no way for anyone to tell.
   */
  test('a well-formed but empty collection is refused, keeping the bundled copy', () => {
    assert.throws(() => markets.parseFetchedCollection(collection([])), /empty/);
  });

  test('junk that is not a collection at all is refused', () => {
    assert.throws(() => markets.parseFetchedCollection({ nope: true }), /failed validation/);
    assert.throws(() => markets.parseFetchedCollection('a string'), /failed validation/);
  });

  /** Still narrowed after validation: the strict schema allows only known tags, but the
   *  drop of inactive records is `parseCollection`'s job and must survive the new wrapper. */
  test('inactive records are still dropped', () => {
    const out = markets.parseFetchedCollection(
      collection([feature(), feature({ id: '9f8e7d6c-5b4a-4938-8271-6a5b4c3d2e1f', active: false })])
    );
    assert.equal(out.length, 1);
  });
});

describe('boundsAround', () => {
  const MIN_SPAN = 0.05;
  /** Bounds are [west, south, east, north]. */
  const span = (b: NonNullable<ReturnType<typeof boundsAround>>) => ({
    lon: b[2] - b[0],
    lat: b[3] - b[1],
  });

  test('no points frames nothing, rather than a box at null island', () => {
    assert.equal(boundsAround([]), null);
  });

  test('holds every point given, in west/south/east/north order', () => {
    const b = boundsAround([
      { lat: 40, lon: -100 },
      { lat: 44, lon: -90 },
    ]);
    assert.deepEqual(b, [-100, 40, -90, 44]);
  });

  test('order of the points does not change the box', () => {
    const shopper = { lat: 40, lon: -100 };
    const market = { lat: 44, lon: -90 };
    assert.deepEqual(boundsAround([shopper, market]), boundsAround([market, shopper]));
  });

  /**
   * The reason the floor exists: standing at the market, the raw box is a point, and a
   * camera fitted to a point goes to maximum zoom on an empty street.
   */
  test('two points on top of each other still get a box to look at', () => {
    const here = { lat: 40, lon: -100 };
    const b = boundsAround([here, here])!;
    assert.equal(span(b).lat.toFixed(10), MIN_SPAN.toFixed(10));
    assert.equal(span(b).lon.toFixed(10), MIN_SPAN.toFixed(10));
  });

  test('the widened box stays centred on the points it was given', () => {
    const b = boundsAround([{ lat: 40, lon: -100 }])!;
    assert.equal(((b[0] + b[2]) / 2).toFixed(10), (-100).toFixed(10));
    assert.equal(((b[1] + b[3]) / 2).toFixed(10), (40).toFixed(10));
  });

  test('a span already wider than the floor is left alone', () => {
    const b = boundsAround([
      { lat: 40, lon: -100 },
      { lat: 41, lon: -99 },
    ])!;
    assert.deepEqual(b, [-100, 40, -99, 41]);
  });

  /** One axis being tiny must not drag the other in with it. */
  test('a north-south pair is widened east-west only', () => {
    const b = boundsAround([
      { lat: 40, lon: -100 },
      { lat: 41, lon: -100 },
    ])!;
    assert.equal(span(b).lat, 1);
    assert.equal(span(b).lon.toFixed(10), MIN_SPAN.toFixed(10));
  });

  test('latitude is held inside the limit a Mercator camera can reach', () => {
    const b = boundsAround([{ lat: 89.99, lon: 0 }])!;
    assert.ok(b[3] <= 85, `north ${b[3]} is past the Mercator limit`);
  });
});

describe('formatDistance', () => {
  const MILE_KM = 1 / 0.621371;

  test('anything under a fifth of a mile reads as nearby, not as false precision', () => {
    assert.equal(formatDistance(0), 'nearby');
    assert.equal(formatDistance(0.1), 'nearby');
    assert.equal(formatDistance(0.2 * MILE_KM - 0.001), 'nearby');
  });

  test('a fifth of a mile is the first distance printed as a number', () => {
    assert.equal(formatDistance(0.2 * MILE_KM + 0.001), '0.2 mi');
  });

  test('walking and driving distances keep one decimal', () => {
    assert.equal(formatDistance(5), '3.1 mi');
    assert.equal(formatDistance(9 * MILE_KM), '9.0 mi');
  });

  test('ten miles and beyond round to whole miles', () => {
    assert.equal(formatDistance(10 * MILE_KM + 0.01), '10 mi');
    assert.equal(formatDistance(100), '62 mi');
    assert.equal(formatDistance(3983), '2475 mi');
  });

  test('the decimal form is kept right up to the ten-mile switch', () => {
    // Documents a rounding seam rather than blessing it: between 9.95 and 10
    // miles toFixed(1) renders "10.0 mi", so the label reads 10.0 just below the
    // boundary and 10 just above it. Cosmetic, but pinned so a change is noticed.
    assert.equal(formatDistance(16), '9.9 mi');
    assert.equal(formatDistance(16.09), '10.0 mi');
  });
});

describe('filterByTags', () => {
  const snapAndIndoor = market({ name: 'Both', tags: ['accepts-snap', 'indoor'] });
  const snapOnly = market({ name: 'Snap only', tags: ['accepts-snap'] });
  const indoorOnly = market({ name: 'Indoor only', tags: ['indoor'] });
  const untagged = market({ name: 'Untagged', tags: [] });
  const all = [snapAndIndoor, snapOnly, indoorOnly, untagged];

  test('no selection means no filtering', () => {
    assert.deepEqual(names(filterByTags(all, [])), names(all));
  });

  test('one tag keeps exactly the markets carrying it', () => {
    assert.deepEqual(names(filterByTags(all, ['accepts-snap'])), ['Both', 'Snap only']);
  });

  test('a second tag narrows the list — it never widens it', () => {
    // The documented decision, and the one that has an obvious wrong answer:
    // OR would grow the result as constraints were added, which is the opposite
    // of what picking a second chip means. The list screen also labels each chip
    // with the count of *adding* that tag, so a widening filter would show a
    // count that climbs as the shopper narrows.
    const one = filterByTags(all, ['accepts-snap']);
    const two = filterByTags(all, ['accepts-snap', 'indoor']);
    assert.deepEqual(names(two), ['Both']);
    assert.ok(two.length <= one.length, 'adding a tag must not grow the result');
  });

  test('a market carrying extra tags beyond the selection still qualifies', () => {
    // Superset, not exact match: selecting one tag must not hide the market that
    // happens to carry three.
    const rich = market({
      name: 'Rich',
      tags: ['accepts-snap', 'indoor', 'organic-focus', 'producer-owned'],
    });
    assert.deepEqual(names(filterByTags([rich], ['accepts-snap', 'organic-focus'])), ['Rich']);
  });

  test('an untagged market drops out as soon as any tag is selected', () => {
    assert.deepEqual(names(filterByTags(all, ['indoor'])), ['Both', 'Indoor only']);
  });

  test('a selection nothing satisfies returns an empty list, not everything', () => {
    // Failing open here would silently ignore the shopper's filter.
    assert.deepEqual(filterByTags([snapOnly, untagged], ['organic-focus']), []);
  });

  test('filtering preserves the order it was given and leaves the input alone', () => {
    const input = [...all];
    filterByTags(input, ['accepts-snap']);
    assert.deepEqual(names(input), names(all));
  });
});

describe('sortByDistance', () => {
  const here = { lat: 37.7955, lon: -122.3937 }; // Ferry Building, SF
  const oakland = market({ name: 'Oakland', lat: 37.8044, lon: -122.2712 });
  const sanJose = market({ name: 'San Jose', lat: 37.3382, lon: -121.8863 });
  const nearby = market({ name: 'Embarcadero', lat: 37.7955, lon: -122.3937 });

  test('the nearest market comes first when a location is known', () => {
    const sorted = sortByDistance([sanJose, oakland, nearby], here);
    assert.deepEqual(names(sorted), ['Embarcadero', 'Oakland', 'San Jose']);
  });

  test('without a location the list is alphabetical rather than arbitrary', () => {
    // The normal state before the location prompt is answered — and on web, where
    // it may never be. Falling through to dataset order would look like a bug.
    const sorted = sortByDistance([sanJose, oakland, nearby], null);
    assert.deepEqual(names(sorted), ['Embarcadero', 'Oakland', 'San Jose']);
  });

  test('the alphabetical fallback is human alphabetical, not code-point order', () => {
    // localeCompare, not `<`: 'apple' before 'Banana'. Raw string comparison puts
    // every capital ahead of every lowercase letter, which reads as unsorted.
    const sorted = sortByDistance(
      [market({ name: 'Berkeley Farmers Market' }), market({ name: 'alameda market' })],
      null
    );
    assert.deepEqual(names(sorted), ['alameda market', 'Berkeley Farmers Market']);
  });

  test('sorting never reorders the array it was handed', () => {
    // The list screen re-sorts the same dataset array on every render; mutating
    // it in place would make the order depend on how many times it had rendered.
    const input = [sanJose, oakland, nearby];
    sortByDistance(input, here);
    assert.deepEqual(names(input), ['San Jose', 'Oakland', 'Embarcadero']);
    sortByDistance(input, null);
    assert.deepEqual(names(input), ['San Jose', 'Oakland', 'Embarcadero']);
  });

  test('an empty list sorts to an empty list either way', () => {
    assert.deepEqual(sortByDistance([], here), []);
    assert.deepEqual(sortByDistance([], null), []);
  });

  test('descending flips the distance order, farthest first', () => {
    const sorted = sortByDistance([sanJose, oakland, nearby], here, true);
    assert.deepEqual(names(sorted), ['San Jose', 'Oakland', 'Embarcadero']);
  });

  test('descending flips the alphabetical order too, not only the distance one', () => {
    // The arrows reverse whichever key is in use. Reversing only the distance sort would
    // leave the control looking broken in the state the list actually starts in.
    const sorted = sortByDistance([sanJose, oakland, nearby], null, true);
    assert.deepEqual(names(sorted), ['San Jose', 'Oakland', 'Embarcadero']);
  });

  test('descending stays human alphabetical rather than falling back to code points', () => {
    const sorted = sortByDistance(
      [market({ name: 'alameda market' }), market({ name: 'Berkeley Farmers Market' })],
      null,
      true
    );
    assert.deepEqual(names(sorted), ['Berkeley Farmers Market', 'alameda market']);
  });

  test('reversing direction does not reshuffle markets the sort cannot tell apart', () => {
    // Direction is applied inside the comparator, never by reversing the result. Reversing
    // an array reverses ties too, so two markets at an identical distance would swap places
    // for no reason a reader could see — and a list that reorders rows it did not have to
    // looks broken in exactly the way a sort control must not.
    const twinA = market({ name: 'Pier A', lat: 37.7955, lon: -122.3937 });
    const twinB = market({ name: 'Pier B', lat: 37.7955, lon: -122.3937 });
    assert.deepEqual(names(sortByDistance([twinA, twinB], here)), ['Pier A', 'Pier B']);
    assert.deepEqual(
      names(sortByDistance([twinA, twinB], here, true)),
      ['Pier A', 'Pier B'],
      'equal distances must keep their order in both directions'
    );
  });

  test('ascending is the default, so an omitted direction is the order it always was', () => {
    assert.deepEqual(
      names(sortByDistance([sanJose, oakland, nearby], here)),
      names(sortByDistance([sanJose, oakland, nearby], here, false))
    );
  });
});

describe('formatSeason', () => {
  test('a bounded season names both months in full', () => {
    assert.equal(
      formatSeason(market({ name: 'Seasonal', seasonStart: '05-01', seasonEnd: '10-31' })),
      'In season May 1 – October 31'
    );
  });

  test('zero-padded dataset dates print without their padding', () => {
    // The dataset stores MM-DD ("01-09"); "January 09" is not how anyone writes it.
    assert.equal(
      formatSeason(market({ name: 'Padded', seasonStart: '01-09', seasonEnd: '12-25' })),
      'In season January 9 – December 25'
    );
  });

  test('no season dates means year-round', () => {
    // null season is the encoding of year-round — there is deliberately no
    // `year-round` tag, so this string is the only place it is stated.
    assert.equal(
      formatSeason(market({ name: 'Always', seasonStart: null, seasonEnd: null })),
      'Open year-round'
    );
  });

  test('a half-specified season never claims a partial range', () => {
    // `seasonIsCoherent` in market-schema.ts means CI rejects one-sided seasons,
    // so this can only arrive from a hand-edited or stale CDN copy. It falls back
    // to year-round instead of rendering "In season May 1 – undefined".
    assert.equal(
      formatSeason(market({ name: 'Half', seasonStart: '05-01', seasonEnd: null })),
      'Open year-round'
    );
    assert.equal(
      formatSeason(market({ name: 'Half', seasonStart: null, seasonEnd: '10-31' })),
      'Open year-round'
    );
  });
});

describe('formatSchedule', () => {
  test('a market with no listed hours says so instead of showing nothing', () => {
    assert.equal(formatSchedule([]), 'Hours not listed');
  });

  test('every listed day is shown, in the order the dataset gives them', () => {
    assert.equal(
      formatSchedule([
        { day: 'sat', open: '08:00', close: '14:00' },
        { day: 'tue', open: '10:00', close: '14:00' },
      ]),
      'Sat 08:00–14:00 · Tue 10:00–14:00'
    );
  });
});

describe('parseCollection: what reaches the app is narrowed, not trusted', () => {
  const feature = (props: Record<string, unknown>) => ({
    type: 'Feature',
    geometry: { type: 'Point', coordinates: [-122.393, 37.795] },
    properties: {
      id: '00000000-0000-4000-8000-000000000000',
      name: 'Probe Market',
      address: '1 Test Street, Testville, CA',
      schedule: [],
      season_start: null,
      season_end: null,
      website: null,
      source: 'manual',
      source_ref: null,
      tags: [],
      active: true,
      country: 'US',
      timezone: 'America/Los_Angeles',
      ...props,
    },
  });

  /**
   * A record written before a tag was retired, or by a fork running its own vocabulary,
   * must not put a value into a filter the UI has no label for. Narrowing DROPS what it
   * does not recognise rather than passing it through.
   */
  test('a tag outside the vocabulary is dropped, and known tags survive beside it', () => {
    const [m] = markets.parseCollection({
      features: [feature({ tags: ['producer-owned', 'not-a-real-tag', 'accepts-snap'] })],
    });
    assert.deepEqual(m.tags, ['producer-owned', 'accepts-snap']);
  });

  test('a feature carrying only unknown tags becomes a market with no tags, not a crash', () => {
    const [m] = markets.parseCollection({ features: [feature({ tags: ['retired-tag'] })] });
    assert.deepEqual(m.tags, []);
  });

  test('a missing tags key is treated as none rather than throwing', () => {
    const props = feature({});
    delete (props.properties as Record<string, unknown>).tags;
    const [m] = markets.parseCollection({ features: [props] });
    assert.deepEqual(m.tags, []);
  });

  /** `active: false` is how a closed market leaves the app without leaving the dataset. */
  test('an inactive market is excluded', () => {
    const parsed = markets.parseCollection({
      features: [feature({ active: false }), feature({ id: '00000000-0000-4000-8000-000000000001' })],
    });
    assert.equal(parsed.length, 1);
    assert.equal(parsed[0].id, '00000000-0000-4000-8000-000000000001');
  });

  /** Absent is not inactive: only an explicit false removes a market. */
  test('a feature with no active key is kept', () => {
    const props = feature({});
    delete (props.properties as Record<string, unknown>).active;
    assert.equal(markets.parseCollection({ features: [props] }).length, 1);
  });

  test('an empty or absent feature list parses to no markets', () => {
    assert.deepEqual(markets.parseCollection({ features: [] }), []);
    assert.deepEqual(markets.parseCollection({}), []);
  });
});

/**
 * Deliberately not covered:
 * - `useMarkets` / `useDatasetMarkets` — React Query hooks; caching, refetching
 *   and the CDN fallback are not this file's target and need a renderer.
 * - The shape of `data/markets.json` — `npm run validate-data` owns that, and a
 *   second copy of those rules here is exactly the drift the schema module warns
 *   about.
 */

describe('isOpenNow: absent hours are unknown hours, never open', () => {
  const market = (over: Partial<Record<string, unknown>> = {}) =>
    ({
      id: '00000000-0000-4000-8000-000000000000',
      name: 'Probe Market',
      address: '1 Test Street, Testville, CA',
      lat: 37.795,
      lon: -122.393,
      schedule: [{ day: 'sat', open: '09:00', close: '14:00' }],
      seasonStart: null,
      seasonEnd: null,
      website: null,
      source: 'manual',
      tags: [],
      ...over,
    }) as never;

  // 2026-09-05 is a Saturday; 2026-09-06 a Sunday. Times are the device's local clock,
  // which is what isOpenNow reads, so these construct local Dates deliberately.
  const sat = (h: number, min = 0) => new Date(2026, 8, 5, h, min);
  const sun = (h: number) => new Date(2026, 8, 6, h);

  test('open between the listed hours on a listed day', () => {
    assert.equal(markets.isOpenNow(market(), sat(10)), true);
  });

  test('shut before opening', () => {
    assert.equal(markets.isOpenNow(market(), sat(8, 59)), false);
  });

  test('open exactly at opening time', () => {
    assert.equal(markets.isOpenNow(market(), sat(9)), true);
  });

  /** Half-open on purpose: a market closing at 14:00 is not still trading at 14:00. */
  test('shut exactly at closing time', () => {
    assert.equal(markets.isOpenNow(market(), sat(14)), false);
  });

  test('shut on a day it does not trade, however good the hour', () => {
    assert.equal(markets.isOpenNow(market(), sun(10)), false);
  });

  /**
   * Date#getDay() counts from Sunday and WEEKDAYS counts from Monday. Getting that mapping
   * wrong shifts every market by a day and still looks plausible, so Sunday is pinned.
   */
  test('Sunday maps to sun, not to the first weekday', () => {
    assert.equal(markets.isOpenNow(market({ schedule: [{ day: 'sun', open: '09:00', close: '14:00' }] }), sun(10)), true);
    assert.equal(markets.isOpenNow(market({ schedule: [{ day: 'mon', open: '09:00', close: '14:00' }] }), sun(10)), false);
  });

  test('a market with no hours listed is never open', () => {
    assert.equal(markets.isOpenNow(market({ schedule: [] }), sat(10)), false);
  });

  test('a malformed time never reads as open', () => {
    assert.equal(markets.isOpenNow(market({ schedule: [{ day: 'sat', open: '9am', close: '2pm' }] }), sat(10)), false);
  });

  describe('season', () => {
    test('no season dates means year-round', () => {
      assert.equal(markets.isOpenNow(market({ seasonStart: null, seasonEnd: null }), sat(10)), true);
    });

    test('inside the season it trades', () => {
      assert.equal(markets.isOpenNow(market({ seasonStart: '05-01', seasonEnd: '10-31' }), sat(10)), true);
    });

    test('outside the season it does not, even in listed hours', () => {
      assert.equal(markets.isOpenNow(market({ seasonStart: '05-01', seasonEnd: '08-31' }), sat(10)), false);
    });

    /**
     * A November-to-March season has an end EARLIER than its start. Treating that as an empty
     * range rather than a wrap around the new year hides every winter market for its whole
     * season, which is the sort of bug nobody notices until January.
     */
    test('a season wrapping the new year is a range, not an empty one', () => {
      const winter = market({ seasonStart: '11-01', seasonEnd: '03-31' });
      assert.equal(markets.isOpenNow(winter, new Date(2026, 11, 5, 10)), true, 'December is inside');
      assert.equal(markets.isOpenNow(winter, new Date(2026, 1, 7, 10)), true, 'February is inside');
      assert.equal(markets.isOpenNow(winter, sat(10)), false, 'September is outside');
    });

    test('the season boundaries themselves are inclusive', () => {
      const m = market({ seasonStart: '09-05', seasonEnd: '09-05' });
      assert.equal(markets.isOpenNow(m, sat(10)), true);
    });
  });
});

describe('searchMarkets', () => {
  const ferry = market({ name: 'Ferry Plaza Farmers Market', address: '1 Ferry Building, San Francisco, CA' });
  const athens = market({ name: 'Athens Farmers Market', address: '3500 Cherokee Rd, Athens, GA' });
  const cafe = market({ name: 'Café du Marché', address: '12 Rue Neuve, Montréal, QC' });
  const all = [ferry, athens, cafe];

  test('an empty query is not a filter', () => {
    // The same promise no selected chips makes: nothing typed means nothing narrowed.
    assert.equal(searchMarkets(all, '').length, 3);
    assert.equal(searchMarkets(all, '   ').length, 3);
  });

  test('matches the name', () => {
    assert.deepEqual(names(searchMarkets(all, 'ferry')), ['Ferry Plaza Farmers Market']);
  });

  test('matches the address, because the town on the card comes from it', () => {
    // A reader searching "Athens" is looking at the overline, which is a slice of the
    // address. Searching only names would miss the field they are reading.
    assert.deepEqual(names(searchMarkets(all, 'cherokee')), ['Athens Farmers Market']);
  });

  test('is case-insensitive', () => {
    assert.equal(searchMarkets(all, 'FERRY').length, 1);
    assert.equal(searchMarkets(all, 'fErRy').length, 1);
  });

  test('sees past accents in both directions', () => {
    // "cafe" should find "Café", and "Café" should find it too — somebody typing on a
    // keyboard without the accent is the common case, and with it is the careful one.
    assert.deepEqual(names(searchMarkets(all, 'cafe')), ['Café du Marché']);
    assert.deepEqual(names(searchMarkets(all, 'Café')), ['Café du Marché']);
    assert.deepEqual(names(searchMarkets(all, 'montreal')), ['Café du Marché']);
  });

  test('every term must match, so more words mean fewer markets', () => {
    assert.equal(searchMarkets(all, 'farmers').length, 2);
    assert.equal(searchMarkets(all, 'farmers athens').length, 1);
    assert.equal(searchMarkets(all, 'farmers nowhere').length, 0);
  });

  test('term order does not matter', () => {
    // Somebody typing two words they remember is not composing a phrase.
    assert.deepEqual(
      names(searchMarkets(all, 'athens farmers')),
      names(searchMarkets(all, 'farmers athens'))
    );
  });

  test('matches across the name/address boundary as separate terms, not as one string', () => {
    // "ferry san" spans both fields. It should match, because the terms are independent —
    // but nothing should match a phrase that only exists because the two were concatenated.
    assert.equal(searchMarkets(all, 'ferry san').length, 1);
    assert.equal(searchMarkets(all, 'market1').length, 0);
  });

  test('never reorders or mutates the list it was given', () => {
    const input = [ferry, athens, cafe];
    const out = searchMarkets(input, 'market');
    assert.deepEqual(names(input), ['Ferry Plaza Farmers Market', 'Athens Farmers Market', 'Café du Marché']);
    assert.deepEqual(names(out), names(out.slice().sort(() => 0)));
  });

  test('an empty list stays empty', () => {
    assert.deepEqual(searchMarkets([], 'anything'), []);
  });
});

describe('availableTags', () => {
  // The distinction this function exists to hold: which tags the *data* has, never which
  // tags survive the filters somebody has set. Getting that backwards makes chips appear
  // and vanish under a finger mid-selection, which is what `TagFilter` disables them to
  // avoid.
  const snap = market({ name: 'Snap', tags: ['accepts-snap'] });
  const indoor = market({ name: 'Indoor', tags: ['indoor'] });
  const untagged = market({ name: 'Untagged', tags: [] });

  test('offers only the tags at least one market carries', () => {
    assert.deepEqual(availableTags([snap, indoor, untagged]), ['accepts-snap', 'indoor']);
  });

  test('a dataset with no tags at all offers nothing', () => {
    // Not "everything": the whole vocabulary drawn over data that uses none of it is four
    // chips that can only ever return an empty list.
    assert.deepEqual(availableTags([untagged]), []);
  });

  test('an empty dataset offers nothing rather than throwing', () => {
    assert.deepEqual(availableTags([]), []);
  });

  test('answers in vocabulary order however the markets are ordered', () => {
    // The caller sorts for display (`ORDERED_TAGS`, by label). This must still be stable, or
    // a dataset refresh could reorder chips under a reader for no reason anybody could see.
    const reversed = [indoor, snap];
    assert.deepEqual(availableTags(reversed), availableTags([snap, indoor]));
  });

  test('counts a tag once however many markets carry it', () => {
    const alsoSnap = market({ name: 'Snap two', tags: ['accepts-snap'] });
    assert.deepEqual(availableTags([snap, alsoSnap]), ['accepts-snap']);
  });

  test('is a subset of the closed vocabulary, whatever the markets claim', () => {
    // `featureToMarket` already drops unknown tag values on the way in, so this is the
    // second line rather than the first — but a chip the UI cannot label is worse than a
    // missing one, and this is the function that decides what gets drawn.
    const rogue = { ...market({ name: 'Rogue' }), tags: ['not-a-tag'] } as unknown as Market;
    assert.deepEqual(availableTags([rogue]), []);
  });
});

describe('nearestWithin', () => {
  const origin = { lat: 39.0, lon: -76.9 };
  const near = { lat: 39.05, lon: -76.92 };      // ~6 km
  const mid = { lat: 39.5, lon: -76.9 };          // ~56 km, inside 50 mi
  const far = { lat: 41.0, lon: -76.9 };          // ~222 km, outside 100 mi

  test('uses 25 miles when 25 miles finds something', () => {
    const out = nearestWithin([near, far], origin);
    assert.equal(out.radius, 25);
    assert.equal(out.widened, false);
    assert.deepEqual(out.markets, [near]);
  });

  test('widens only when the narrower radius is empty, and says that it did', () => {
    // The whole reason `widened` exists: a chip that said 25 while using 50 would make the
    // market count a promise the filter does not keep.
    const out = nearestWithin([mid], origin);
    assert.equal(out.radius, 50);
    assert.equal(out.widened, true, 'the caller must be able to say the radius grew');
  });

  test('reports the widest radius tried when nothing is found anywhere', () => {
    const out = nearestWithin([far], origin);
    assert.deepEqual(out.markets, []);
    assert.equal(out.radius, 100, 'so the message can say how far it looked');
  });

  test('is empty rather than throwing on an empty dataset', () => {
    assert.deepEqual(nearestWithin([], origin).markets, []);
  });
});

describe('boundsForRadius', () => {
  test('frames the radius searched, not just the markets found', () => {
    const [w, s, e, n] = boundsForRadius({ lat: 39, lon: -76.9 }, 25);
    assert.ok(w < -76.9 && e > -76.9 && s < 39 && n > 39, 'the origin is inside the box');
    // 25 miles is ~40 km; a degree of latitude is ~111 km.
    assert.ok(Math.abs(n - s) > 0.6 && Math.abs(n - s) < 0.8, `lat span was ${n - s}`);
  });

  test('widens the longitude span with latitude, and never past the world', () => {
    const mid = boundsForRadius({ lat: 39, lon: 0 }, 25);
    const high = boundsForRadius({ lat: 78, lon: 0 }, 25);
    assert.ok(high[2] - high[0] > mid[2] - mid[0], 'a degree of longitude is shorter up north');
    const polar = boundsForRadius({ lat: 89.9, lon: 0 }, 5000);
    assert.ok(polar[0] >= -180 && polar[2] <= 180, 'a box wider than the world is not one');
  });
});

describe('tags that only apply in some countries', () => {
  const tagged = (tags: string[]) =>
    ({ id: 'x', name: 'Market', address: 'A', schedule: [], season_start: null, season_end: null,
       website: null, source: 'manual', source_ref: null, active: true, country: 'US',
       tags, lat: 0, lon: 0 }) as unknown as Market;

  test('SNAP is offered in the United States and not in Britain', () => {
    // It is a US federal programme. Offering it in Manchester is offering a filter that
    // excludes every British market for a reason that is not about British markets.
    const markets = [tagged(['accepts-snap']), tagged(['indoor'])];
    assert.deepEqual(availableTags(markets, 'US'), ['accepts-snap', 'indoor']);
    assert.deepEqual(availableTags(markets, 'GB'), ['indoor']);
  });

  test('SNAP is hidden in Jamaica too, and the rest of the vocabulary is not', () => {
    // The gate is a list of countries a tag applies in, not a US/not-US switch — so a third
    // country inherits the right answer without a third branch being written.
    const markets = [tagged(['accepts-snap']), tagged(['indoor']), tagged(['organic-focus'])];
    assert.deepEqual(availableTags(markets, 'JM'), ['indoor', 'organic-focus']);
  });

  test('with no country given, everything the data carries is offered', () => {
    // The parameter is optional so that callers with no reader in hand — tests, scripts — get
    // the whole vocabulary rather than a silent US default.
    assert.deepEqual(availableTags([tagged(['accepts-snap'])]), ['accepts-snap']);
  });

  test('hiding the filter does not edit the record', () => {
    // A British reader looking at an American market still sees its SNAP tag on the detail
    // screen, because that is a true thing about that market.
    const market = tagged(['accepts-snap']);
    assert.deepEqual(market.tags, ['accepts-snap']);
  });
});

/**
 * The cross-country offer. It exists because `📍 NEAR ME` from a position in one country with
 * the setting on another zooms to an empty map and explains nothing — field-tested on a real
 * phone, US position, country set to Jamaica.
 */
describe('nearbyInOtherCountry', () => {
  const at = (country: string, lat: number, lon: number) =>
    ({ country, lat, lon }) as { country: 'US' | 'GB' | 'JM'; lat: number; lon: number };

  // Kingston, Jamaica and a US point far from everything.
  const KINGSTON = { lat: 17.9686, lon: -76.7936 };

  test('finds the country whose markets the setting is hiding', () => {
    const all = [at('JM', 17.97, -76.79), at('JM', 18.01, -76.81), at('US', 39.09, -76.94)];
    const found = nearbyInOtherCountry(all, KINGSTON, 'US');
    assert.equal(found?.country, 'JM');
    assert.equal(found?.count, 2);
  });

  test('says nothing when the reader is nowhere near another country', () => {
    // Somebody genuinely out of range of everything gets no offer, which is the correct
    // silence — an offer they cannot act on is worse than none.
    const all = [at('JM', 17.97, -76.79), at('GB', 53.48, -2.24)];
    assert.equal(nearbyInOtherCountry(all, { lat: 39.09, lon: -76.94 }, 'US'), null);
  });

  test("never offers the country already set", () => {
    const all = [at('US', 17.97, -76.79)];
    assert.equal(nearbyInOtherCountry(all, KINGSTON, 'US'), null);
  });

  test('a record with no country is not evidence about any country', () => {
    // Only a dataset older than the field can produce one, and it must not be counted toward
    // a country it never claimed.
    const all = [{ lat: 17.97, lon: -76.79 } as never];
    assert.equal(nearbyInOtherCountry(all, KINGSTON, 'US'), null);
  });

  test('ranks by count, and breaks a tie on the nearest market', () => {
    // Deterministic either way: two countries tying on count must not swap places when the
    // dataset is reordered.
    const all = [at('JM', 17.99, -76.80), at('GB', 17.98, -76.79)];
    const found = nearbyInOtherCountry(all, KINGSTON, 'US');
    assert.equal(found?.count, 1);
    assert.equal(found?.country, 'GB', 'the closer one wins the tie');
    const reversed = nearbyInOtherCountry([...all].reverse(), KINGSTON, 'US');
    assert.equal(reversed?.country, 'GB', 'and order does not change the answer');
  });

  test("respects the offered country's own ladder, so an offer is somewhere you could go", () => {
    // "Jamaica has markets" is true from London and useless. The bound is the ladder that
    // country will actually search after the switch, not a second radius to keep in step.
    const all = [at('JM', 17.97, -76.79)];
    assert.equal(nearbyInOtherCountry(all, { lat: 51.5, lon: -0.09 }, 'GB'), null);
  });
});
