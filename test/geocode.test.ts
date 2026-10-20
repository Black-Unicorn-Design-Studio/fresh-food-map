import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';

import {
  GEOCODE_MESSAGES,
  PLACE_MESSAGES,
  GEOCODE_COUNTRIES,
  GEOCODE_USER_AGENT,
  MIN_INTERVAL_MS,
  addressDetail,
  geocode,
  resetGeocodeState,
  reverseGeocode,
} from '../src/lib/geocode';

/**
 * Address lookup for the submit form.
 *
 * Nothing here talks to Nominatim: every test stubs `fetch`, and the clock is injected, so
 * this suite needs no network and never sleeps. What it guards is the part of the module
 * that exists because of the usage policy — one request a second, cache before network,
 * identify the application — plus the rule that a lookup never becomes a dead end.
 */

const realFetch = globalThis.fetch;

/** Records what the module asked for, and answers with whatever the test hands it. */
function stubFetch(reply: () => unknown) {
  const calls: { url: string; headers: Record<string, string> }[] = [];
  globalThis.fetch = (async (input: unknown, init: { headers?: Record<string, string> } = {}) => {
    calls.push({ url: String(input), headers: init.headers ?? {} });
    return reply();
  }) as unknown as typeof globalThis.fetch;
  return calls;
}

function ok(body: unknown) {
  return { ok: true, status: 200, json: async () => body };
}

const FERRY = [
  { lat: '37.795391', lon: '-122.393237', display_name: 'Ferry Building, San Francisco, CA' },
];

/** A clock the test drives, so the interval is exercised without waiting for it. */
function clockAt(ms: number) {
  return { now: () => ms };
}

beforeEach(() => resetGeocodeState());
afterEach(() => {
  globalThis.fetch = realFetch;
});

describe('geocode', () => {
  it('turns an address into a coordinate pair the feature schema would accept', async () => {
    stubFetch(() => ok(FERRY));
    const result = await geocode('1 Ferry Building, San Francisco', clockAt(10_000));
    assert.equal(result.ok, true);
    assert.ok(result.ok);
    assert.equal(result.lat, 37.795391);
    assert.equal(result.lon, -122.393237);
    assert.equal(result.label, 'Ferry Building, San Francisco, CA');
  });

  it('identifies the application on every request, as the usage policy requires', async () => {
    const calls = stubFetch(() => ok(FERRY));
    await geocode('1 Ferry Building, San Francisco', clockAt(10_000));
    assert.equal(calls[0].headers['user-agent'], GEOCODE_USER_AGENT);
  });

  it('asks for three results, so a road cannot win over a building', async () => {
    // It asked for one and took whatever Nominatim ranked first. Measured failure: a query
    // for `12610 Old Gunpowder Road` returned a single street-level hit 2.3 km from the
    // device, with no house number, and the app took it because nothing else was offered.
    const calls = stubFetch(() => ok(FERRY));
    await geocode('1 Ferry Building, San Francisco', clockAt(10_000));
    assert.match(calls[0].url, /limit=3/);
  });

  it('prefers a house-numbered candidate over a road, whatever order they arrive in', async () => {
    // Nominatim ranks by its own relevance, not by how exactly a result is placed, so the
    // road can come first. Nothing asks the reader to choose — the pick is on precision.
    const road = {
      lat: '37.7955', lon: '-122.3937', display_name: 'Market Street, San Francisco',
      address: { road: 'Market Street', city: 'San Francisco', 'ISO3166-2-lvl4': 'US-CA' },
    };
    const building = {
      lat: '37.7955', lon: '-122.3937', display_name: '1 Market Street, San Francisco',
      address: { house_number: '1', road: 'Market Street', city: 'San Francisco', postcode: '94105', 'ISO3166-2-lvl4': 'US-CA' },
    };
    stubFetch(() => ok([road, building]));
    const out = await geocode('1 Market Street, San Francisco', clockAt(10_000));
    assert.ok(out.ok);
    assert.equal(out.precision, 'building', 'the building wins even though the road came first');
    assert.match(out.address ?? '', /^1 Market Street/);
  });

  it('still reports street precision when no candidate has a number — it never invents one', async () => {
    // The rule this protects: a forward match can be kilometres from the device, so filling a
    // number the service did not return would be wrong AND far.
    const road = {
      lat: '39.0536', lon: '-76.9223', display_name: 'Old Gunpowder Road, Calverton',
      address: { road: 'Old Gunpowder Road', city: 'Calverton', postcode: '20705', 'ISO3166-2-lvl4': 'US-MD' },
    };
    stubFetch(() => ok([road, road]));
    const out = await geocode('12610 Old Gunpowder Road, Beltsville, MD', clockAt(10_000));
    assert.ok(out.ok);
    assert.equal(out.precision, 'street');
    assert.ok(!/\d+\s+Old Gunpowder/.test(out.address ?? ''), 'no house number was conjured');
  });

  it('biases by where the reader is, and drops the country when it can', async () => {
    // Position beats a compiled-in default: same query, different answer depending on where
    // you are asking from. `viewbox` biases ranking; `countrycodes` would filter, and sending
    // both would let a stale default veto the reader's own location.
    const calls = stubFetch(() => ok(FERRY));
    await geocode('portland', { now: () => 10_000, near: { lat: 45.5, lon: -122.6 } });
    assert.match(calls[0].url, /viewbox=/);
    assert.doesNotMatch(calls[0].url, /countrycodes/);
  });

  it('keys the cache on the bias, so one reader is not served another reader s answer', async () => {
    // "20904" near Maryland and "20904" near Aguascalientes are different questions.
    const calls = stubFetch(() => ok(FERRY));
    await geocode('20904', { now: () => 10_000, near: { lat: 39.0, lon: -77.0 } });
    await geocode('20904', { now: () => 20_000, near: { lat: 21.9, lon: -102.3 } });
    assert.equal(calls.length, 2);
  });

  it('restricts a forward lookup to a country, so a bare postcode is not a coin toss', async () => {
    // 20904 is Silver Spring, Maryland — and also a real postcode in Aguascalientes, which
    // is what Nominatim answered with before this. Five digits carry no country, so the
    // query has to.
    // Only with no location to go on — a first run, a refusal, the web without permission.
    const calls = stubFetch(() => ok(FERRY));
    await geocode('20904', clockAt(10_000));
    assert.match(calls[0].url, /countrycodes=us/);
    assert.doesNotMatch(calls[0].url, /viewbox/);
  });

  it('defaults that country to the one every market in the dataset is in', () => {
    assert.equal(GEOCODE_COUNTRIES, 'us');
  });

  it('does not restrict a reverse lookup, which is already handed a point', async () => {
    // A coordinate is in whatever country it is in; filtering could only turn a correct
    // answer into no answer.
    const calls = stubFetch(() =>
      ok({ display_name: 'Somewhere', address: { road: 'Rue Neuve', city: 'Montréal' } })
    );
    await reverseGeocode(45.5, -73.6, clockAt(10_000));
    assert.doesNotMatch(calls[0].url, /countrycodes/);
  });

  it('answers a repeat address from cache without reaching the network', async () => {
    const calls = stubFetch(() => ok(FERRY));
    await geocode('1 Ferry Building, San Francisco', clockAt(10_000));
    const again = await geocode('1 Ferry Building, San Francisco', clockAt(10_050));
    assert.equal(calls.length, 1, 'an answered address must never be asked twice');
    assert.ok(again.ok);
    assert.equal(again.lat, 37.795391);
  });

  it('treats whitespace and case as the same query, so a retyped address is still a cache hit', async () => {
    const calls = stubFetch(() => ok(FERRY));
    await geocode('1 Ferry Building, San Francisco', clockAt(10_000));
    await geocode('  1  FERRY building,   San Francisco ', clockAt(10_050));
    assert.equal(calls.length, 1);
  });

  it('serves a cache hit even inside the one-second interval, because it is not a request', async () => {
    stubFetch(() => ok(FERRY));
    await geocode('1 Ferry Building, San Francisco', clockAt(10_000));
    const immediate = await geocode('1 Ferry Building, San Francisco', clockAt(10_001));
    assert.ok(immediate.ok, 'the interval limits requests, and a cached answer is not one');
  });

  it('refuses a second distinct lookup inside one second', async () => {
    stubFetch(() => ok(FERRY));
    await geocode('1 Ferry Building, San Francisco', clockAt(10_000));
    const tooSoon = await geocode('somewhere else entirely', clockAt(10_000 + MIN_INTERVAL_MS - 1));
    assert.equal(tooSoon.ok, false);
    assert.ok(!tooSoon.ok && tooSoon.reason === 'throttled');
  });

  it('allows the next lookup once the interval has passed', async () => {
    stubFetch(() => ok(FERRY));
    await geocode('1 Ferry Building, San Francisco', clockAt(10_000));
    const later = await geocode('somewhere else entirely', clockAt(10_000 + MIN_INTERVAL_MS));
    assert.equal(later.ok, true);
  });

  it('does not spend the interval on an address too short to look up', async () => {
    const calls = stubFetch(() => ok(FERRY));
    const short = await geocode('abc', clockAt(10_000));
    assert.ok(!short.ok && short.reason === 'too-short');
    const real = await geocode('1 Ferry Building, San Francisco', clockAt(10_001));
    assert.equal(calls.length, 1, 'a refusal that never hit the network must not throttle the next press');
    assert.equal(real.ok, true);
  });

  it('says no match rather than failing when the service finds nothing', async () => {
    stubFetch(() => ok([]));
    const result = await geocode('nowhere at all, nowhere', clockAt(10_000));
    assert.ok(!result.ok && result.reason === 'no-match');
  });

  it('reports an unreachable service rather than throwing at the form', async () => {
    stubFetch(() => {
      throw new TypeError('Failed to fetch');
    });
    const result = await geocode('1 Ferry Building, San Francisco', clockAt(10_000));
    assert.ok(!result.ok && result.reason === 'unreachable');
  });

  it('treats an HTTP error as unreachable rather than reading the body', async () => {
    stubFetch(() => ({ ok: false, status: 429, json: async () => ({}) }));
    const result = await geocode('1 Ferry Building, San Francisco', clockAt(10_000));
    assert.ok(!result.ok && result.reason === 'unreachable');
  });

  it('rejects a response that is not shaped like a place list', async () => {
    stubFetch(() => ok({ error: 'Unable to geocode' }));
    const result = await geocode('1 Ferry Building, San Francisco', clockAt(10_000));
    assert.ok(!result.ok && result.reason === 'malformed');
  });

  it('rejects coordinates the feature schema would reject, rather than writing them into the form', async () => {
    stubFetch(() => ok([{ lat: '91.5', lon: '-122.4', display_name: 'Off the top of the world' }]));
    const result = await geocode('1 Ferry Building, San Francisco', clockAt(10_000));
    assert.ok(
      !result.ok && result.reason === 'malformed',
      'a latitude CI would refuse must never reach the coordinate field looking valid',
    );
  });

  it('rejects a coordinate that is not a number at all', async () => {
    stubFetch(() => ok([{ lat: 'north-ish', lon: '-122.4', display_name: 'Somewhere' }]));
    const result = await geocode('1 Ferry Building, San Francisco', clockAt(10_000));
    assert.ok(!result.ok && result.reason === 'malformed');
  });

  it('does not cache a failure, so a retry after an outage still asks', async () => {
    let fail = true;
    const calls = stubFetch(() => {
      if (fail) throw new TypeError('Failed to fetch');
      return ok(FERRY);
    });
    await geocode('1 Ferry Building, San Francisco', clockAt(10_000));
    fail = false;
    const retry = await geocode('1 Ferry Building, San Francisco', clockAt(20_000));
    assert.equal(calls.length, 2);
    assert.equal(retry.ok, true);
  });

  it('the place-search messages never send a reader to a field that is not there', () => {
    // GEOCODE_MESSAGES points at the submit form's coordinate inputs. The list has none, so
    // it gets its own words — the shared set would be an instruction nobody can follow.
    const reasons = ['too-short', 'no-match', 'unreachable', 'malformed', 'throttled'] as const;
    for (const reason of reasons) {
      assert.ok(PLACE_MESSAGES[reason]?.length, `${reason} needs a message`);
      assert.doesNotMatch(
        PLACE_MESSAGES[reason],
        /coordinate/i,
        `${reason} must not tell a list reader to type coordinates`
      );
    }
  });

  it('has a message for every failure, and none of them is a dead end', () => {
    const reasons = ['too-short', 'no-match', 'unreachable', 'malformed', 'throttled'] as const;
    for (const reason of reasons) {
      const message = GEOCODE_MESSAGES[reason];
      assert.ok(message && message.length > 0, `${reason} needs a message`);
    }
    // Every route out of a failed lookup ends at the same place: the fields are still there.
    for (const reason of ['no-match', 'unreachable', 'malformed'] as const) {
      assert.match(
        GEOCODE_MESSAGES[reason],
        /coordinates/,
        `${reason} must name the manual route rather than leaving someone stuck`,
      );
    }
  });
});

describe('reverseGeocode', () => {
  const FERRY_REVERSE = {
    display_name:
      'San Francisco Ferry Building, 1, Ferry Plaza, Financial District, San Francisco, California, 94111, United States',
    address: {
      house_number: '1',
      road: 'Ferry Plaza',
      city: 'San Francisco',
      state: 'California',
      postcode: '94111',
    },
  };

  it('composes an address short enough for the schema, not the raw display name', async () => {
    stubFetch(() => ok(FERRY_REVERSE));
    const result = await reverseGeocode(37.795391, -122.393237, clockAt(10_000));
    assert.ok(result.ok);
    assert.equal(result.label, '1 Ferry Plaza, San Francisco, California 94111');
    assert.ok(
      result.label.length <= 200,
      'the app must never write an address its own schema would reject',
    );
  });

  it('never writes a house number without the road it belongs to', async () => {
    // Nominatim answers some points with a building but no way beneath it. Joining the pair
    // unconditionally produced `125, Athens, GA 30606` — a street number with no street,
    // which reads as a typo in a file that gets committed.
    stubFetch(() =>
      ok({
        display_name: 'somewhere in Athens',
        address: { house_number: '125', city: 'Athens', postcode: '30606', 'ISO3166-2-lvl4': 'US-GA' },
      }),
    );
    const result = await reverseGeocode(33.95, -83.4, clockAt(10_000));
    assert.ok(result.ok);
    assert.equal(result.label, 'Athens, GA 30606');
    assert.equal(result.precision, 'area', 'a number with no street is not a street address');
  });

  it('falls back to the county when no incorporated place is named', async () => {
    // Rural addresses answer with none of city/town/village/hamlet/suburb. Measured on
    // Alcovy Circle, Georgia: only `county` came back, and composing without it dropped the
    // locality to leave `382 Alcovy Circle, GA 30014` — an address with no town in it.
    stubFetch(() =>
      ok({
        display_name: 'somewhere in Newton County',
        address: {
          house_number: '382',
          road: 'Alcovy Circle',
          county: 'Newton County',
          postcode: '30014',
          'ISO3166-2-lvl4': 'US-GA',
        },
      }),
    );
    const result = await reverseGeocode(33.5, -83.8, clockAt(10_000));
    assert.ok(result.ok);
    assert.equal(result.label, '382 Alcovy Circle, Newton County, GA 30014');
  });

  // `zoom=18` answers with the closest building-level object, and some of those carry no road:
  // a building with no address tags, a parcel, a point inside a landuse polygon. Reporting an
  // area and stopping left `Fairland, MD 20904` on a form that exists to collect a street,
  // while the street sat a few metres away and well mapped.
  const NO_STREET = {
    display_name: 'Fairland, Montgomery County, Maryland, 20904, United States',
    address: { town: 'Fairland', postcode: '20904', 'ISO3166-2-lvl4': 'US-MD' },
  };
  const noSleep = { ...clockAt(10_000), wait: async () => {} };

  it('asks one zoom out when the building-level answer has no street', async () => {
    const calls = stubFetch(() =>
      ok(
        // first request is the zoom=18 one, second the fallback
        calls.length === 1
          ? NO_STREET
          : {
              display_name: 'Hollyhock Way, Fairland, Maryland, 20904, United States',
              address: {
                road: 'Hollyhock Way',
                town: 'Fairland',
                postcode: '20904',
                'ISO3166-2-lvl4': 'US-MD',
              },
            },
      ),
    );
    const result = await reverseGeocode(39.09, -76.945, noSleep);
    assert.ok(result.ok);
    assert.equal(result.label, 'Hollyhock Way, Fairland, MD 20904');
    assert.equal(result.precision, 'street');
    assert.equal(calls.length, 2, 'the fallback is a second request, not a re-parse');
    assert.match(calls[0].url, /zoom=18/);
    assert.match(calls[1].url, /zoom=17/);
  });

  it('keeps a house number the coarser answer returns', async () => {
    // The rule this looks like it breaks is a different rule: "neither direction invents a
    // house number" forbids *fabricating* one, and bites on the forward path where a road
    // match can be kilometres away. Reverse is anchored to a real point, so the worst it
    // produces is the neighbour — the same trade already made one zoom in, where `12614`
    // comes back for a doorway 21 m from `12610` and is kept.
    const calls = stubFetch(() =>
      ok(
        calls.length === 1
          ? NO_STREET
          : {
              display_name: 'somewhere on Hollyhock Way',
              address: {
                house_number: '4200',
                road: 'Hollyhock Way',
                town: 'Fairland',
                postcode: '20904',
                'ISO3166-2-lvl4': 'US-MD',
              },
            },
      ),
    );
    const result = await reverseGeocode(39.09, -76.945, noSleep);
    assert.ok(result.ok);
    assert.equal(result.label, '4200 Hollyhock Way, Fairland, MD 20904');
    assert.equal(result.precision, 'building');
  });

  it('keeps the area answer when one zoom out has no street either', async () => {
    const calls = stubFetch(() => ok(NO_STREET));
    const result = await reverseGeocode(39.09, -76.945, noSleep);
    assert.ok(result.ok);
    assert.equal(result.label, 'Fairland, MD 20904');
    assert.equal(result.precision, 'area');
    assert.equal(calls.length, 2, 'it still asked, it just gained nothing');
  });

  it('writes a British address the British way, with no state in it', async () => {
    // The fault this fixes: `ISO3166-2-lvl4` is a postal abbreviation in the US and a
    // constituent country in the UK, so reading it the American way produced
    // `8 Southwark Street, London, England SE1 1TL`. `ENG` is three letters, failed the
    // two-letter guard, and the fallback then reached for `state` and found `England`.
    stubFetch(() =>
      ok({
        display_name: 'Borough Market, 8, Southwark Street, London, SE1 1TL, United Kingdom',
        address: {
          house_number: '8',
          road: 'Southwark Street',
          suburb: 'Bankside',
          city: 'London',
          state: 'England',
          'ISO3166-2-lvl4': 'GB-ENG',
          postcode: 'SE1 1TL',
          country_code: 'gb',
        },
      }),
    );
    const result = await reverseGeocode(51.5055, -0.0911, clockAt(10_000));
    assert.ok(result.ok);
    assert.equal(result.label, '8 Southwark Street, London SE1 1TL');
    assert.ok(!result.label.includes('England'), 'a constituent country is not a postal state');
    assert.equal(result.precision, 'building');
  });

  it('writes a Jamaican address with its parish and no postal code', async () => {
    // Fixture taken verbatim from a live reverse lookup at 18.4076, -77.1030 (Ocho Rios).
    // Two things in it are the whole reason this branch exists, and neither was guessed:
    // the parish code is filed under `ISO3166-2-lvl6`, not the `lvl4` the American composer
    // reads, and there is no `state` key at all. So `composeAmerican` found a subdivision in
    // neither place and quietly dropped the parish rather than misplacing it.
    stubFetch(() =>
      ok({
        display_name:
          'Ocho Rios Bypass, Brook Green, Ocho Rios, Saint Ann, Middlesex County, Jamaica',
        address: {
          road: 'Ocho Rios Bypass',
          neighbourhood: 'Brook Green',
          city: 'Ocho Rios',
          county: 'Saint Ann',
          state_district: 'Middlesex County',
          'ISO3166-2-lvl6': 'JM-06',
          country_code: 'jm',
        },
      }),
    );
    const result = await reverseGeocode(18.4076, -77.103, clockAt(20_000));
    assert.ok(result.ok);
    assert.equal(result.label, 'Ocho Rios Bypass, Ocho Rios, Saint Ann');
    assert.ok(!result.label.includes('Middlesex'), 'a historic county is not a parish');
    assert.ok(!/\d{5}/.test(result.label), 'Jamaica has no postal code to write');
    assert.equal(result.precision, 'street');
  });

  it('does not write Kingston twice when the town and the parish share a name', async () => {
    // Fixture from a live lookup at 17.9686, -76.7936 (Coronation Market). Kingston is both
    // a town and a parish and Nominatim answers with both, so composing unguarded reads
    // `Peters Lane, Kingston, Kingston`.
    stubFetch(() =>
      ok({
        display_name: 'Peters Lane, Kingston, Surrey County, Jamaica',
        address: {
          road: 'Peters Lane',
          city: 'Kingston',
          county: 'Kingston',
          state_district: 'Surrey County',
          'ISO3166-2-lvl6': 'JM-01',
          country_code: 'jm',
        },
      }),
    );
    const result = await reverseGeocode(17.9686, -76.7936, clockAt(30_000));
    assert.ok(result.ok);
    assert.equal(result.label, 'Peters Lane, Kingston');
  });

  it('the grammar follows the place, not the reader', async () => {
    // Somebody in Manchester looking up a market in Georgia is shown an American address,
    // because that is what is written on the building and what a map app will take back.
    stubFetch(() =>
      ok({
        display_name: 'somewhere in Athens',
        address: {
          house_number: '1573',
          road: 'W Broad St',
          city: 'Athens',
          'ISO3166-2-lvl4': 'US-GA',
          postcode: '30606',
          country_code: 'us',
        },
      }),
    );
    const result = await reverseGeocode(33.95, -83.4, clockAt(10_000));
    assert.ok(result.ok);
    assert.equal(result.label, '1573 W Broad St, Athens, GA 30606');
  });

  it('hands back the coordinates it was given, untouched', async () => {
    stubFetch(() => ok(FERRY_REVERSE));
    const result = await reverseGeocode(37.795391, -122.393237, clockAt(10_000));
    assert.ok(result.ok);
    assert.equal(result.lat, 37.795391);
    assert.equal(result.lon, -122.393237);
  });

  it('asks for the component breakdown, which is what makes a short address possible', async () => {
    const calls = stubFetch(() => ok(FERRY_REVERSE));
    await reverseGeocode(37.795391, -122.393237, clockAt(10_000));
    assert.match(calls[0].url, /addressdetails=1/);
    assert.match(calls[0].url, /\/reverse\?/);
  });

  it('falls back to a truncated display name when there are no components to compose from', async () => {
    const long = 'x'.repeat(400);
    stubFetch(() => ok({ display_name: long }));
    const result = await reverseGeocode(37.795391, -122.393237, clockAt(10_000));
    assert.ok(result.ok);
    assert.equal(result.label.length, 200, 'truncated rather than dropped');
  });

  it('reads "unable to geocode" as no match, because open water is an answer', async () => {
    stubFetch(() => ok({ error: 'Unable to geocode' }));
    const result = await reverseGeocode(0, 0, clockAt(10_000));
    assert.ok(!result.ok && result.reason === 'no-match');
  });

  it('answers a repeat of the same point from cache', async () => {
    const calls = stubFetch(() => ok(FERRY_REVERSE));
    await reverseGeocode(37.795391, -122.393237, clockAt(10_000));
    await reverseGeocode(37.795391, -122.393237, clockAt(10_010));
    assert.equal(calls.length, 1);
  });

  it('shares the one-per-second limit with the forward lookup', async () => {
    stubFetch(() => ok(FERRY));
    await geocode('1 Ferry Building, San Francisco', clockAt(10_000));
    const tooSoon = await reverseGeocode(51.5, -0.12, clockAt(10_500));
    assert.ok(
      !tooSoon.ok && tooSoon.reason === 'throttled',
      'one limiter, or two buttons together breach a limit neither breaks alone',
    );
  });

  it('cannot collide with an address someone typed', async () => {
    const calls = stubFetch(() => ok(FERRY_REVERSE));
    await reverseGeocode(37.795391, -122.393237, clockAt(10_000));
    const typed = await geocode('37.795391,-122.393237', clockAt(20_000));
    assert.equal(calls.length, 2, 'a coordinate key must not answer an address query');
    assert.ok(!typed.ok || typed.label !== FERRY_REVERSE.display_name);
  });

  it('refuses a coordinate that is not finite rather than asking about it', async () => {
    const calls = stubFetch(() => ok(FERRY_REVERSE));
    const result = await reverseGeocode(Number.NaN, -122.4, clockAt(10_000));
    assert.ok(!result.ok && result.reason === 'malformed');
    assert.equal(calls.length, 0);
  });
});

/**
 * How complete an address looks, which is what decides whether `🔎 Find it from the address`
 * replaces what somebody typed.
 *
 * The rule it serves — replace only when the lookup found more — is a reversal of an older
 * one, "a typed address is never overwritten", and the reversal has a sharp edge: score this
 * wrong in one direction and the app throws away "west car park, behind the church", in the
 * other and a market lands in a committed file at "1573 w broad".
 */
describe('addressDetail', () => {
  it('scores a full street address above a partial one', () => {
    assert.ok(
      addressDetail('1573 W Broad St, Athens, GA 30606') > addressDetail('1573 w broad'),
      'the fuller address has to win, or the lookup never improves anything',
    );
  });

  it('scores a local description below a full street address', () => {
    // The case the old rule protected. It is still protected in the way that matters — the
    // reader sees the replacement and can edit it — but the score is honest that a postal
    // address carries more of what the dataset asks for.
    assert.ok(addressDetail('1573 W Broad St, Athens, GA 30606') > addressDetail('west car park, behind the church'));
  });

  it('does not rank a vague answer above a precise one the reader already typed', () => {
    // The direction that loses data. A lookup that resolves only to a town must never
    // displace a house number somebody typed.
    assert.ok(
      addressDetail('Athens, Georgia') < addressDetail('1573 W Broad St, Athens, GA 30606'),
      'a town-level answer must not outrank a street address',
    );
  });

  it('ties rather than wins when the same address comes back in another spelling', () => {
    // Nominatim frequently returns what was typed with different capitalisation. A tie leaves
    // the reader's own words in place, which is what makes "only when richer" safe.
    assert.equal(
      addressDetail('1573 W Broad St, Athens, GA 30606'),
      addressDetail('1573 w broad st, athens, ga 30606'),
    );
  });

  it('scores a British postcode, which it long did not', () => {
    // The defect: the test was `\d{5}`, so a British postcode scored nothing and the comma
    // count decided everything. Measured before the fix, `main st, keynsham, bristol` tied
    // with the full address and the tie-keeps-typed rule threw the postcode away.
    assert.ok(
      addressDetail('Main Street, Keynsham, Bristol BS31 1EQ') >
        addressDetail('main st, keynsham, bristol'),
      'a real postcode has to beat the same address without one',
    );
    assert.ok(
      addressDetail('8 Southwark Street, London SE1 1TL') >
        addressDetail('8 Southwark Street, London'),
    );
  });

  it('reads all the postcode grammars the app supports, off the string alone', () => {
    // It takes no country on purpose — one function has to score both what somebody typed and
    // what came back, and those are only comparable if the same rules apply to both. Written
    // as explicit pairs rather than by stripping the tail with a regex: the first draft did
    // that and its own pattern could not strip `30606-1234`, so the test failed on a string
    // the code scored perfectly well.
    const pairs: [string, string][] = [
      ['Athens, GA 30606', 'Athens, GA'],
      ['Athens, GA 30606-1234', 'Athens, GA'],
      ['London SE1 1TL', 'London'],
      ['Bristol BS31 1EQ', 'Bristol'],
      ['Manchester M1 1AE', 'Manchester'],
    ];
    for (const [withCode, without] of pairs) {
      assert.ok(
        addressDetail(withCode) > addressDetail(without),
        `${withCode} should score above ${without}`,
      );
    }
  });

  it('does not read an American state and ZIP as a British postcode', () => {
    // `GA 30606` is letters-then-digits and must not satisfy the UK grammar as well, or one
    // address would be paid twice for one postal token.
    assert.equal(addressDetail('Athens, GA 30606'), 3);
  });

  it('does not count a five-digit house number as a postcode', () => {
    // It was paid for twice: once by `startsWithNumber` and again as a ZIP it is not.
    // Measured before the fix, this scored 3.
    assert.equal(addressDetail('12610 Old Gunpowder Rd'), 2);
    // And a genuine ZIP still scores beside a long house number.
    assert.ok(addressDetail('12610 Old Gunpowder Rd, Beltsville, MD 20705') >
              addressDetail('12610 Old Gunpowder Rd'));
  });

  it('an incomplete outward code is not a postcode', () => {
    // `SE1` on its own is half a postcode — findable by machine, not a place you can stand in.
    assert.equal(addressDetail('london, se1'), addressDetail('london, xx1'));
  });

  it('scores a Jamaican address on the signals it can have', () => {
    // Jamaica abolished postal codes, so neither side of a Jamaican comparison can earn that
    // point — which is fair, because neither can. The composed form still wins on parts.
    assert.ok(
      addressDetail('Ocho Rios Bypass, Ocho Rios, Saint Ann') >
        addressDetail('ocho rios bypass, ocho rios'),
    );
  });

  it('counts an empty field as nothing, so any answer improves on it', () => {
    assert.equal(addressDetail(''), 0);
    assert.equal(addressDetail('   '), 0);
    assert.ok(addressDetail('Athens, GA') > 0);
  });

  it('reads a postcode anywhere in the string, not only at the end', () => {
    assert.ok(addressDetail('30606 Athens') > addressDetail('Athens'));
  });
});

describe('reverse lookup precision', () => {
  const at = (address: Record<string, string>) => ({ display_name: 'somewhere', address });

  it('calls a house number on a named street a building', async () => {
    resetGeocodeState();
    stubFetch(() => ok(at({ house_number: '1573', road: 'West Broad Street', city: 'Athens', state: 'Georgia', 'ISO3166-2-lvl4': 'US-GA', postcode: '30606' })));
    const result = await reverseGeocode(33.95, -83.4, clockAt(10_000));
    assert.ok(result.ok);
    assert.equal(result.precision, 'building');
    assert.equal(result.address, '1573 West Broad Street, Athens, GA 30606');
  });

  it('calls a street with no number a street, so the form can say so', async () => {
    // The car-park case: the point is on a road the map knows and at no address it knows.
    // Presenting this as an address is how a market gets committed without a number.
    resetGeocodeState();
    stubFetch(() => ok(at({ road: 'West Broad Street', city: 'Athens', state: 'Georgia', postcode: '30606' })));
    const result = await reverseGeocode(33.95, -83.4, clockAt(10_000));
    assert.ok(result.ok);
    assert.equal(result.precision, 'street');
  });

  it('calls anything vaguer an area', async () => {
    resetGeocodeState();
    stubFetch(() => ok(at({ neighbourhood: 'Boulevard', city: 'Athens', state: 'Georgia' })));
    const result = await reverseGeocode(33.95, -83.4, clockAt(10_000));
    assert.ok(result.ok);
    assert.equal(result.precision, 'area');
  });

  it('asks Nominatim for building-level zoom', async () => {
    // Left unset the service answers at whatever zoom it thinks natural for the point, which
    // for a kerbside fix is often the street or the suburb.
    resetGeocodeState();
    const calls = stubFetch(() => ok(at({ house_number: '1', road: 'Ferry Plaza' })));
    await reverseGeocode(37.79, -122.39, clockAt(10_000));
    assert.match(calls[0].url, /zoom=18/);
  });
});

describe('the composed address matches what is already in the dataset', () => {
  // Every address in `data/markets.json` reads `<street>, <city>, <ST> <zip>`. An app that
  // writes `<street>, <city>, <State>, <zip>` makes a file nobody can search or diff cleanly,
  // and it would be the app making the mess rather than a submitter.
  it('abbreviates the state from the service’s own ISO code and joins the postcode with a space', async () => {
    resetGeocodeState();
    stubFetch(() =>
      ok({
        display_name: 'long form',
        address: {
          house_number: '705',
          road: 'Sunset Drive',
          city: 'Athens',
          state: 'Georgia',
          'ISO3166-2-lvl4': 'US-GA',
          postcode: '30606',
        },
      }),
    );
    const result = await reverseGeocode(33.96, -83.39, clockAt(10_000));
    assert.ok(result.ok);
    assert.equal(result.address, '705 Sunset Drive, Athens, GA 30606');
  });

  it('keeps the full state name when the service sends no ISO code', async () => {
    // Longer, never wrong. Compiling a table of fifty states to avoid it would be one more
    // thing to be wrong about DC and Puerto Rico.
    resetGeocodeState();
    stubFetch(() =>
      ok({
        display_name: 'long form',
        address: { house_number: '1', road: 'Ferry Plaza', city: 'San Francisco', state: 'California', postcode: '94111' },
      }),
    );
    const result = await reverseGeocode(37.79, -122.39, clockAt(10_000));
    assert.ok(result.ok);
    assert.equal(result.address, '1 Ferry Plaza, San Francisco, California 94111');
  });
});
