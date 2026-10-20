/**
 * `src/lib/market-schema.ts` is the contract three separate consumers import:
 * CI (`scripts/validate-data.ts`), the intake service, and the batching agent.
 * The expensive failure it exists to prevent is a submission that passes intake
 * and then fails CI — so these tests pin the shape of the contract itself, not
 * zod's behaviour.
 *
 * Where current behaviour is weaker than the docstrings promise, the test says
 * so in its name and documents what actually happens. Those are marked
 * "known gap" and are reported, not fixed, here.
 */
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { strict as assert } from 'node:assert';
import { describe, test } from 'node:test';

import { MARKET_TAGS } from '../src/constants/tags';
import {
  MarketCollection,
  MarketFeature,
  MarketProperties,
  Submission,
  seasonIsCoherent,
} from '../src/lib/market-schema';

type Issue = { code: string; path: PropertyKey[]; message: string };

/** Assert the schema rejected an input, and hand back the issues to inspect. */
function rejected(result: { success: boolean; error?: { issues: Issue[] } }): Issue[] {
  assert.equal(result.success, false, 'expected the schema to reject this input, but it parsed');
  return result.error?.issues ?? [];
}

const paths = (issues: Issue[]) => issues.map((i) => i.path.join('.'));

/** A published feature's properties, valid in every field. */
const props = (over: Record<string, unknown> = {}) => ({
  id: '1f0a6a2e-8c1d-4b5e-9d2a-000000000001',
  name: 'Ferry Plaza Farmers Market',
  address: '1 Ferry Building, San Francisco, CA 94111',
  schedule: [{ day: 'sat', open: '08:00', close: '14:00' }],
  season_start: null,
  season_end: null,
  website: 'https://foodwise.org/markets/ferry-plaza-farmers-market/',
  source: 'manual',
  tags: [],
  source_ref: null,
  active: true,
  country: 'US',
  timezone: 'America/Los_Angeles',
  ...over,
});

const feature = (over: Record<string, unknown> = {}) => ({
  type: 'Feature',
  geometry: { type: 'Point', coordinates: [-122.3937, 37.7955] },
  properties: props(),
  ...over,
});

/** The minimum a member of the public may send. */
const submission = (over: Record<string, unknown> = {}) => ({
  name: 'Ferry Plaza Farmers Market',
  address: '1 Ferry Building, San Francisco, CA 94111',
  lat: 37.7955,
  lon: -122.3937,
  country: 'US',
  timezone: 'America/Los_Angeles',
  ...over,
});

describe('the retired `verified` field cannot come back', () => {
  // The only thing standing between a removed field and it silently merging
  // back in forever is `strictObject`. Nothing else in the repo checks for it.
  test('a re-added `verified` key is a loud error, not a silent strip', () => {
    const issues = rejected(MarketProperties.safeParse(props({ verified: false })));
    assert.equal(issues.length, 1);
    assert.equal(issues[0].code, 'unrecognized_keys');
    assert.match(issues[0].message, /verified/);
  });

  test('any unrecognised property key fails rather than being dropped', () => {
    const issues = rejected(MarketProperties.safeParse(props({ phone: '+1-555-0100' })));
    assert.equal(issues[0].code, 'unrecognized_keys');
    assert.match(issues[0].message, /phone/);
  });

  test('a feature carrying a stray key inside properties fails the whole collection', () => {
    // The path CI actually takes: validate-data.ts parses the file as a
    // collection, so the strictness has to survive two levels of nesting.
    const collection = {
      type: 'FeatureCollection',
      name: 'fresh-food-map-markets',
      features: [feature({ properties: props({ verified: true }) })],
    };
    const issues = rejected(MarketCollection.safeParse(collection));
    assert.deepEqual(paths(issues), ['features.0.properties']);
  });

  test('known gap: an unknown key on the feature or geometry itself is dropped in silence', () => {
    // MarketFeature and its geometry are plain z.object, so strictness stops at
    // `properties`. `{"type":"Feature","verified":false,...}` passes CI, and the
    // key stays in data/markets.json unnoticed — the exact failure mode the
    // strictObject comment is written to prevent, one level up. Documented, not
    // fixed: this test will need inverting if the schema is tightened.
    const parsed = MarketFeature.parse(feature({ verified: false }));
    assert.equal('verified' in parsed, false);

    const withBbox = MarketFeature.parse(
      feature({ geometry: { type: 'Point', coordinates: [-122.3937, 37.7955], bbox: [0, 0, 1, 1] } })
    );
    assert.equal('bbox' in withBbox.geometry, false);
  });

  test('known gap: a schedule entry is not strict either', () => {
    // ScheduleEntry is z.object, so per-entry junk (a leftover `verified`, a
    // stray `notes`) is stripped without complaint while the same key one level
    // up would fail loudly.
    const parsed = MarketProperties.parse(
      props({ schedule: [{ day: 'sat', open: '08:00', close: '14:00', verified: true }] })
    );
    assert.deepEqual(parsed.schedule, [{ day: 'sat', open: '08:00', close: '14:00' }]);
  });
});

describe('required keys stay required even when their value is empty', () => {
  // These are required-with-nullable-values on purpose: an absent key means
  // "nobody has looked at this", which is not the same claim as `null`. If any
  // of them ever gained a default, a writer could omit it and the dataset would
  // start asserting things nobody checked.
  for (const key of ['website', 'source_ref', 'season_start', 'season_end', 'tags'] as const) {
    test(`omitting \`${key}\` is an error, not a default`, () => {
      const without = props();
      delete (without as Record<string, unknown>)[key];
      const issues = rejected(MarketProperties.safeParse(without));
      assert.deepEqual(paths(issues), [key]);
      assert.equal(issues[0].code, 'invalid_type');
    });
  }

  test('explicit nulls and an empty tag list are accepted', () => {
    const parsed = MarketProperties.parse(
      props({ website: null, source_ref: null, season_start: null, season_end: null, tags: [], schedule: [] })
    );
    assert.deepEqual(parsed.tags, []);
    assert.deepEqual(parsed.schedule, []);
    assert.equal(parsed.website, null);
  });

  test('`undefined` is not a stand-in for null', () => {
    const issues = rejected(MarketProperties.safeParse(props({ website: undefined })));
    assert.deepEqual(paths(issues), ['website']);
  });
});

describe('a submitter supplies facts, never provenance', () => {
  test('a submission cannot label itself as coming from a state portal', () => {
    // False attribution in an ODbL dataset: `source` says where a record came
    // from, and the answer for a public form is always the form.
    const parsed = Submission.parse(
      submission({
        id: '00000000-0000-4000-8000-000000000000',
        source: 'state_portal',
        source_ref: 'CA-DOA-0042',
        active: true,
      })
    );
    for (const key of ['id', 'source', 'source_ref', 'active']) {
      assert.equal(key in parsed, false, `${key} must be stripped from a submission`);
    }
  });

  test('a submission cannot smuggle `verified` through either', () => {
    // Submission is a plain z.object, so this one is silently stripped rather
    // than rejected. Silent is acceptable *here* — the payload is untrusted and
    // the value never reaches the dataset — but assert it is gone, loudly.
    const parsed = Submission.parse(submission({ verified: true }));
    assert.equal('verified' in parsed, false);
  });

  test('a submission carries exactly the fact fields and nothing else', () => {
    const parsed = Submission.parse(submission({ note: 'Moved across the street in 2025.' }));
    assert.deepEqual(Object.keys(parsed).sort(), [
      'address',
      // Facts about the market, not provenance: which country's conventions its address is
      // written in, and which timezone its opening hours mean. The service cannot infer
      // either without a lookup on a path that is deliberately offline, and the submitter is
      // standing in both.
      'country',
      'lat',
      'lon',
      'name',
      'note',
      'schedule',
      'season_start',
      'season_end',
      'tags',
      'timezone',
      'website',
    ].sort());
  });

  test('a bare submission fills its own blanks so intake never invents them later', () => {
    const parsed = Submission.parse(submission());
    assert.deepEqual(parsed.schedule, []);
    assert.deepEqual(parsed.tags, []);
    assert.equal(parsed.season_start, null);
    assert.equal(parsed.season_end, null);
    assert.equal(parsed.website, null);
    assert.equal(parsed.note, null);
  });

  test('an accepted submission is still not publishable until the service assigns provenance', () => {
    const parsed = Submission.parse(submission());
    const { lat: _lat, lon: _lon, note: _note, ...facts } = parsed;
    assert.deepEqual(paths(rejected(MarketProperties.safeParse(facts))).sort(), [
      'active',
      'id',
      'source',
      'source_ref',
    ]);
  });

  test('everything intake accepts at its limits still passes the published schema', () => {
    // The invariant the whole "one schema" rule exists for: a submission that
    // passes intake and then fails CI is the worst place to find a mismatch, so
    // walk a maximal-but-valid payload the whole way to a feature.
    const accepted = Submission.parse({
      name: 'M'.repeat(120),
      address: 'A'.repeat(200),
      lat: 90,
      lon: -180,
      schedule: Array.from({ length: 14 }, () => ({ day: 'sun', open: '00:00', close: '23:59' })),
      season_start: '01-01',
      season_end: '12-31',
      website: 'https://example.com/' + 'p'.repeat(180),
      tags: [...MARKET_TAGS],
      // Deliberately not the default: this walks a payload the whole way from intake to a
      // published feature, so it should carry the country that is *not* the one a missing
      // field would have silently produced.
      country: 'GB',
      timezone: 'Europe/London',
      note: 'n'.repeat(500),
    });

    const { lat, lon, note, ...facts } = accepted;
    assert.equal(note, 'n'.repeat(500), 'the note is review context, never published');

    const published = MarketFeature.parse({
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [lon, lat] },
      properties: { ...facts, id: randomUUID(), source: 'community', source_ref: null, active: true },
    });
    assert.equal(published.properties.tags.length, MARKET_TAGS.length);
    assert.equal(published.properties.schedule.length, 14);
    assert.equal(seasonIsCoherent(published.properties), true);
  });
});

describe('a season is stated in full or not at all', () => {
  test('both dates set is coherent', () => {
    assert.equal(seasonIsCoherent({ season_start: '04-01', season_end: '11-15' }), true);
  });

  test('both dates null is coherent — that is how a year-round market is written', () => {
    assert.equal(seasonIsCoherent({ season_start: null, season_end: null }), true);
  });

  test('a start with no end is incoherent', () => {
    assert.equal(seasonIsCoherent({ season_start: '04-01', season_end: null }), false);
  });

  test('an end with no start is incoherent', () => {
    assert.equal(seasonIsCoherent({ season_start: null, season_end: '11-15' }), false);
  });

  test('coherence is a separate check the schema does not enforce', () => {
    // Both CI and intake call seasonIsCoherent by hand for exactly this reason;
    // dropping either call would let a half-stated season through.
    const parsed = MarketProperties.parse(props({ season_start: '04-01', season_end: null }));
    assert.equal(seasonIsCoherent(parsed), false);
  });
});

describe('the value constraints that protect the data', () => {
  test('coordinates are bounded at the poles and the antimeridian', () => {
    MarketFeature.parse(feature({ geometry: { type: 'Point', coordinates: [180, 90] } }));
    MarketFeature.parse(feature({ geometry: { type: 'Point', coordinates: [-180, -90] } }));
    assert.deepEqual(
      paths(rejected(MarketFeature.safeParse(feature({ geometry: { type: 'Point', coordinates: [180.1, 0] } })))),
      ['geometry.coordinates.0']
    );
    assert.deepEqual(
      paths(rejected(MarketFeature.safeParse(feature({ geometry: { type: 'Point', coordinates: [0, -90.1] } })))),
      ['geometry.coordinates.1']
    );
  });

  test('coordinates are [lon, lat], so a swapped pair is caught by the tighter bound', () => {
    // GeoJSON order, and the only defence against a swap is that latitude stops
    // at ±90. Ferry Plaza written backwards must not parse.
    assert.deepEqual(
      paths(rejected(MarketFeature.safeParse(feature({ geometry: { type: 'Point', coordinates: [37.7955, -122.3937] } })))),
      ['geometry.coordinates.1']
    );
  });

  test('a third elevation element is rejected even though GeoJSON allows one', () => {
    assert.deepEqual(
      paths(rejected(MarketFeature.safeParse(feature({ geometry: { type: 'Point', coordinates: [-122.3937, 37.7955, 12] } })))),
      ['geometry.coordinates']
    );
  });

  test('season dates are MM-DD and nothing else', () => {
    MarketProperties.parse(props({ season_start: '01-01', season_end: '12-31' }));
    for (const bad of ['4-1', '13-01', '00-15', '04-00', '04-32', '2026-04-01', '04/01', '']) {
      assert.deepEqual(
        paths(rejected(MarketProperties.safeParse(props({ season_start: bad, season_end: '11-15' })))),
        ['season_start'],
        `${JSON.stringify(bad)} must not pass as a season date`
      );
    }
  });

  test('known gap: MM-DD is a shape check, not a calendar check', () => {
    // 02-30 and 04-31 are not days. The regex accepts them; nothing downstream
    // re-checks. Harmless for a "roughly when the season runs" field, but it is
    // a claim this schema does not actually verify.
    MarketProperties.parse(props({ season_start: '02-30', season_end: '04-31' }));
  });

  test('times are 24-hour HH:MM, zero-padded', () => {
    MarketProperties.parse(props({ schedule: [{ day: 'mon', open: '00:00', close: '23:59' }] }));
    for (const bad of ['8:30', '24:00', '12:60', '08:5', '0830', '8am', '08:30:00']) {
      assert.deepEqual(
        paths(rejected(MarketProperties.safeParse(props({ schedule: [{ day: 'mon', open: bad, close: '14:00' }] })))),
        ['schedule.0.open'],
        `${JSON.stringify(bad)} must not pass as a time`
      );
    }
  });

  test('a day is one of seven lowercase abbreviations', () => {
    for (const day of ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun']) {
      MarketProperties.parse(props({ schedule: [{ day, open: '08:00', close: '14:00' }] }));
    }
    for (const bad of ['Mon', 'monday', 'sun ', 'tues']) {
      assert.deepEqual(
        paths(rejected(MarketProperties.safeParse(props({ schedule: [{ day: bad, open: '08:00', close: '14:00' }] })))),
        ['schedule.0.day']
      );
    }
  });

  test('a schedule holds at most fourteen entries', () => {
    const entry = { day: 'sat', open: '08:00', close: '14:00' };
    MarketProperties.parse(props({ schedule: Array.from({ length: 14 }, () => entry) }));
    assert.deepEqual(
      paths(rejected(MarketProperties.safeParse(props({ schedule: Array.from({ length: 15 }, () => entry) })))),
      ['schedule']
    );
  });

  test('known gap: nothing checks that a market closes after it opens', () => {
    // A 14:00–08:00 entry parses. The detail screen renders it verbatim, so the
    // only backstop is a human reading the pull request.
    MarketProperties.parse(props({ schedule: [{ day: 'sat', open: '14:00', close: '08:00' }] }));
  });

  test('websites are https or absent — never http', () => {
    MarketProperties.parse(props({ website: 'https://example.org' }));
    MarketProperties.parse(props({ website: null }));
    for (const bad of ['http://example.org', 'ftp://example.org', 'example.org', 'javascript:alert(1)', '']) {
      // A bad URL can trip both the url() and the startsWith() check, so dedupe
      // the paths: what matters is that every complaint is about `website`.
      const issues = rejected(MarketProperties.safeParse(props({ website: bad })));
      assert.deepEqual([...new Set(paths(issues))], ['website'], `${JSON.stringify(bad)} must not pass as a website`);
    }
  });

  test('tags come from the closed vocabulary and unknown ones are refused, not kept', () => {
    MarketProperties.parse(props({ tags: [...MARKET_TAGS] }));
    const issues = rejected(MarketProperties.safeParse(props({ tags: ['indoor', 'year-round'] })));
    assert.deepEqual(paths(issues), ['tags.1']);
    assert.equal(issues[0].code, 'invalid_value');
  });

  test('a submission with an unknown tag is refused at intake rather than half-accepted', () => {
    // The client filters unknown tags before sending (src/lib/submit.ts), so a
    // payload that still contains one is hand-made. It comes back as a 422 the
    // submitter can see — a visible error, not a silent drop.
    assert.deepEqual(paths(rejected(Submission.safeParse(submission({ tags: ['organic-focus', 'free-parking'] })))), [
      'tags.1',
    ]);
  });

  test('a tag list cannot be longer than the vocabulary', () => {
    assert.deepEqual(
      paths(rejected(MarketProperties.safeParse(props({ tags: Array(MARKET_TAGS.length + 1).fill('indoor') })))),
      ['tags']
    );
  });

  test('known gap: the tag list is not checked for duplicates', () => {
    // ['indoor','indoor','indoor','indoor'] parses. It is only the length cap
    // that keeps it bounded, and the detail screen would render the chip four
    // times.
    const parsed = MarketProperties.parse(props({ tags: Array(MARKET_TAGS.length).fill('indoor') }));
    assert.equal(parsed.tags.length, MARKET_TAGS.length);
  });

  test('a name is 3 to 120 characters and an address 5 to 200', () => {
    MarketProperties.parse(props({ name: 'Abc', address: 'Abcde' }));
    MarketProperties.parse(props({ name: 'N'.repeat(120), address: 'A'.repeat(200) }));
    assert.deepEqual(paths(rejected(MarketProperties.safeParse(props({ name: 'Ab' })))), ['name']);
    assert.deepEqual(paths(rejected(MarketProperties.safeParse(props({ name: 'N'.repeat(121) })))), ['name']);
    assert.deepEqual(paths(rejected(MarketProperties.safeParse(props({ address: 'Abcd' })))), ['address']);
    assert.deepEqual(paths(rejected(MarketProperties.safeParse(props({ address: 'A'.repeat(201) })))), ['address']);
  });

  test('the same name and address limits apply to a submission', () => {
    // Any asymmetry here is a submission that passes intake and then fails CI.
    assert.deepEqual(paths(rejected(Submission.safeParse(submission({ name: 'Ab' })))), ['name']);
    assert.deepEqual(paths(rejected(Submission.safeParse(submission({ name: 'N'.repeat(121) })))), ['name']);
    assert.deepEqual(paths(rejected(Submission.safeParse(submission({ address: 'Abcd' })))), ['address']);
    assert.deepEqual(paths(rejected(Submission.safeParse(submission({ address: 'A'.repeat(201) })))), ['address']);
  });

  test('intake caps website length where the published schema does not — stricter, so safe', () => {
    // Deliberately asserted in this direction: intake being tighter costs a
    // submitter an error message, whereas intake being looser would mint a
    // record CI then rejects.
    const long = 'https://example.com/' + 'p'.repeat(181);
    assert.deepEqual(paths(rejected(Submission.safeParse(submission({ website: long })))), ['website']);
    MarketProperties.parse(props({ website: long }));
  });

  test('provenance fields are themselves constrained', () => {
    assert.deepEqual(paths(rejected(MarketProperties.safeParse(props({ id: 'market-1' })))), ['id']);
    assert.deepEqual(paths(rejected(MarketProperties.safeParse(props({ source: 'wikipedia' })))), ['source']);
    // No coercion anywhere: "true" is a string and stays wrong.
    assert.deepEqual(paths(rejected(MarketProperties.safeParse(props({ active: 'true' })))), ['active']);
  });

  test('a collection must be a FeatureCollection of Point features', () => {
    assert.deepEqual(
      paths(rejected(MarketCollection.safeParse({ type: 'Feature', name: 'x', features: [] }))),
      ['type']
    );
    assert.deepEqual(
      paths(
        rejected(
          MarketFeature.safeParse(
            feature({ geometry: { type: 'MultiPoint', coordinates: [-122.3937, 37.7955] } })
          )
        )
      ),
      ['geometry.type']
    );
  });
});

describe('the schema and the shipped dataset agree', () => {
  const raw = JSON.parse(
    readFileSync(new URL('../data/markets.json', import.meta.url), 'utf8')
  ) as unknown;

  test('every feature in data/markets.json parses', () => {
    const parsed = MarketCollection.safeParse(raw);
    if (!parsed.success) {
      assert.fail(
        `data/markets.json no longer matches the schema:\n` +
          parsed.error.issues.map((i) => `  ${i.path.join('.')}: ${i.message}`).join('\n')
      );
    }
    assert.ok(parsed.data.features.length > 0, 'the dataset must not be empty');
  });

  test('a real shipped feature round-trips through MarketFeature unchanged', () => {
    // Not just "it parses": strictObject plus the nested plain objects mean a
    // parse can quietly return less than it was given. Deep-equal catches that.
    const first = (raw as { features: unknown[] }).features[0];
    assert.deepEqual(MarketFeature.parse(first), first);
  });

  test('every shipped feature states its season in full or not at all', () => {
    const { features } = MarketCollection.parse(raw);
    for (const f of features) {
      assert.equal(
        seasonIsCoherent(f.properties),
        true,
        `${f.properties.name} has a half-stated season`
      );
    }
  });
});
