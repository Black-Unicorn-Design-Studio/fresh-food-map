import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, test } from 'node:test';

import { Submission, type SubmissionInput } from '@/lib/market-schema';
import { judge, type Verdict } from '../server/checks';
import { loadConfig, type IntakeConfig } from '../server/config';

/**
 * `judge()` is where the project's most expensive promise is kept: never
 * auto-reject. A wrong soft flag costs a reviewer ten seconds; a wrong hard
 * fail is a silent deletion the submitter is never told about and nobody can
 * find afterwards. So every case below asks one of two questions — did this
 * still reach the pull request, and if it did not, is this genuinely one of the
 * three boring hard fails — honeypot, too fast, already listed?
 */

// Policy numbers are read, never restated. `intake.config.json` is committed so
// that changing a threshold is a pull request; a test that hard-codes 100 would
// keep passing after someone changed the committed policy to 250.
const config: IntakeConfig = loadConfig();

/**
 * `judge()` reads `data/markets.json` itself — from `process.cwd()`, cached for
 * the life of the process — so there is no seam to hand it a fixture dataset.
 * These tests therefore reason about the committed dataset, and read it the
 * same way rather than hard-coding a market name that a future pull request
 * could rename out from under them.
 */
type Listed = { name: string; coords: [number, number] };
const listedMarkets: Listed[] = (
  JSON.parse(readFileSync(resolve(process.cwd(), 'data/markets.json'), 'utf8')).features ?? []
).map((f: any) => ({ name: f.properties.name as string, coords: f.geometry.coordinates }));

/** The market every dedupe case is anchored to: whichever one is listed first. */
const anchor = listedMarkets[0];

/** Mid-Atlantic. Nowhere near a listed market, which the first test proves. */
const NOWHERE: [number, number] = [-30, 25];

/**
 * Only used to place fixtures and to assert the preconditions those fixtures
 * rely on — never to re-derive what the module under test computes.
 */
function metersApart(a: [number, number], b: [number, number]): number {
  const R = 6371000;
  const rad = (d: number) => (d * Math.PI) / 180;
  const dLat = rad(b[1] - a[1]);
  const dLon = rad(b[0] - a[0]);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(rad(a[1])) * Math.cos(rad(b[1])) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

/**
 * Due north by `m` metres. A pure-latitude offset is exact under the
 * great-circle formula either module uses — the longitude term drops out and
 * the distance is just R·Δφ — so the boundary cases below sit where they say
 * they do without depending on anyone's floating point.
 */
function northOf(c: [number, number], m: number): [number, number] {
  const R = 6371000;
  return [c[0], c[1] + ((m / R) * 180) / Math.PI];
}

/**
 * Fixtures go through `Submission` rather than being typed out as object
 * literals: one schema, imported everywhere. If the contract gains a field,
 * these fixtures gain it too instead of drifting into a shape intake would
 * never actually be handed.
 */
function submission(over: Record<string, unknown> = {}): SubmissionInput {
  return Submission.parse({
    name: 'Little Creek Farmers Market',
    address: '14 Harbour Road, Little Creek, CA 90000',
    lon: NOWHERE[0],
    lat: NOWHERE[1],
    website: 'https://example.com/little-creek-market',
    schedule: [{ day: 'sat', open: '08:00', close: '13:00' }],
    country: 'US',
    timezone: 'America/Los_Angeles',
    ...over,
  });
}

/** A person who read the form and typed for half a minute. */
const human = { honeypot: null, elapsedSeconds: 30 };

function accepted(v: Verdict): string[] {
  assert.equal(
    v.kind,
    'accept',
    `expected this to reach the pull request, but it was dropped: ${JSON.stringify(v)}`
  );
  return v.kind === 'accept' ? v.flags : [];
}

function droppedFor(v: Verdict): string {
  assert.equal(v.kind, 'hard', `expected a hard fail, got ${JSON.stringify(v)}`);
  return v.kind === 'hard' ? v.reason : '';
}

test('the fixtures are anchored to the dataset judge actually reads', () => {
  assert.ok(anchor, 'data/markets.json has no features — every dedupe case below is vacuous');

  // The "just outside the radius" cases assert that *nothing* is near enough to
  // flag, so the anchor must not have a neighbour of its own inside the radius.
  const neighbours = listedMarkets
    .slice(1)
    .map((m) => metersApart(anchor.coords, m.coords))
    .sort((a, b) => a - b);
  assert.ok(
    neighbours.length === 0 || neighbours[0] > config.dedupe.radius_m * 2,
    `the first listed market has a neighbour ${neighbours[0]}m away, inside the dedupe radius`
  );

  for (const m of listedMarkets) {
    assert.ok(
      metersApart(NOWHERE, m.coords) > config.dedupe.radius_m,
      `"${m.name}" is now listed at the coordinates these tests use as empty ocean`
    );
  }
});

describe('never auto-reject', () => {
  test('a complete submission from a plausible human reaches the pull request unflagged', () => {
    assert.deepEqual(accepted(judge(submission(), human, config)), []);
  });

  test('a market with no website is flagged for a reviewer, not dropped', () => {
    const flags = accepted(judge(submission({ website: null }), human, config));
    assert.deepEqual(flags, ['no_website']);
  });

  test('a market with no opening times is flagged for a reviewer, not dropped', () => {
    const flags = accepted(judge(submission({ schedule: [] }), human, config));
    assert.deepEqual(flags, ['no_schedule']);
  });

  test('soft signals never add up to a rejection', () => {
    // The worst-looking submission the soft checks can describe — no website,
    // no times, and sitting on top of a market that is already listed. Three
    // reasons to look, zero reasons to delete it.
    const v = judge(
      submission({ website: null, schedule: [], lon: anchor.coords[0], lat: anchor.coords[1] }),
      human,
      config
    );
    const flags = accepted(v);
    assert.deepEqual(flags.sort(), ['near_duplicate', 'no_schedule', 'no_website']);
  });

  test('judging leaves the submission untouched, so the reviewer sees what was sent', () => {
    // The queue stores the parsed payload, not a copy judge handed back: if
    // judge ever normalised a field in place, the pull request would quietly
    // carry something the submitter never typed.
    const input = submission({ website: null });
    const before = structuredClone(input);
    judge(input, human, config);
    assert.deepEqual(input, before);
  });

  test('narrowing the flag policy silences the flag, never the submission', () => {
    // flag_for_review is a filter over flags judge already raised. Emptying it
    // must cost the reviewer a hint, not cost the submitter their market.
    const quiet: IntakeConfig = { ...config, flag_for_review: [] };
    const flags = accepted(judge(submission({ website: null, schedule: [] }), human, quiet));
    assert.deepEqual(flags, []);
  });

  test('every flag judge can raise is in the committed flag policy', () => {
    // judge filters its own flags through flag_for_review, so a flag that is
    // missing from the committed list is not a loud error — it is a signal the
    // reviewer silently never sees. This is the guard against that drift.
    for (const flag of ['no_website', 'no_schedule', 'near_duplicate']) {
      assert.ok(
        config.flag_for_review.includes(flag),
        `judge raises "${flag}" but intake.config.json drops it before the pull request`
      );
    }
  });
});

describe('the hard list stays short and boring', () => {
  test('a filled honeypot is dropped', () => {
    assert.equal(
      droppedFor(judge(submission(), { honeypot: 'https://buy-pills.example', elapsedSeconds: 30 }, config)),
      'honeypot'
    );
  });

  test('an untouched honeypot field is not a bot signal', () => {
    // Every real browser posts the hidden field as an empty string. Treating
    // "present but empty" as tripped would drop every genuine submission.
    assert.deepEqual(accepted(judge(submission(), { honeypot: '', elapsedSeconds: 30 }, config)), []);
  });

  test('a submission faster than a human could type is dropped', () => {
    const meta = { honeypot: null, elapsedSeconds: config.min_seconds_to_submit - 0.5 };
    assert.equal(droppedFor(judge(submission(), meta, config)), 'too_fast');
  });

  test('a submission at exactly the minimum time is kept', () => {
    // The comparison is strict `<`, so the configured minimum is allowed rather
    // than being the first value rejected — the boundary belongs to the human.
    const meta = { honeypot: null, elapsedSeconds: config.min_seconds_to_submit };
    assert.deepEqual(accepted(judge(submission(), meta, config)), []);
  });

  test('a submission with no timing at all is kept', () => {
    // elapsed_seconds arrives from client JavaScript. Absent means "we do not
    // know", and not knowing must never be grounds for a silent deletion.
    const meta = { honeypot: null, elapsedSeconds: null };
    assert.deepEqual(accepted(judge(submission(), meta, config)), []);
  });
});

describe('duplicates: the one rejection CI would make anyway', () => {
  test('the same market at the same spot is dropped instead of sent to fail CI', () => {
    const v = judge(
      submission({ name: anchor.name, lon: anchor.coords[0], lat: anchor.coords[1] }),
      human,
      config
    );
    assert.equal(droppedFor(v), 'already_listed');
  });

  test('the same market is recognised whatever case it is typed in', () => {
    const v = judge(
      submission({ name: anchor.name.toUpperCase(), lon: anchor.coords[0], lat: anchor.coords[1] }),
      human,
      config
    );
    assert.equal(droppedFor(v), 'already_listed');
  });

  test('the same name a metre inside the dedupe radius is the same market', () => {
    const at = northOf(anchor.coords, config.dedupe.radius_m - 1);
    const v = judge(submission({ name: anchor.name, lon: at[0], lat: at[1] }), human, config);
    assert.equal(droppedFor(v), 'already_listed');
  });

  test('the same name a metre outside the dedupe radius still reaches the pull request', () => {
    // Strict `<`: at or beyond the radius it is a different market, which is
    // exactly what scripts/validate-data.ts concludes at merge time.
    //
    // Note what does NOT happen here: the near_duplicate flag skips same-name
    // matches (they were meant to have hard-failed above), so this — the most
    // suspicious survivor there is, an identically named market 101m from a
    // listed one — arrives with no flag at all, while a differently named
    // market at the same distance would arrive flagged. Documenting current
    // behaviour, not endorsing it.
    const at = northOf(anchor.coords, config.dedupe.radius_m + 1);
    const flags = accepted(judge(submission({ name: anchor.name, lon: at[0], lat: at[1] }), human, config));
    assert.deepEqual(flags, []);
  });

  test('the same name far from anything listed is a different market', () => {
    // Farmers markets share names constantly across the country; matching on
    // name alone would delete real markets.
    const flags = accepted(judge(submission({ name: anchor.name }), human, config));
    assert.deepEqual(flags, []);
  });

  test('a different market at the same spot is flagged, never dropped', () => {
    // Two markets can genuinely share a plaza on different days. A reviewer
    // decides that; the server does not.
    const v = judge(
      submission({ name: 'Saturday Growers Collective', lon: anchor.coords[0], lat: anchor.coords[1] }),
      human,
      config
    );
    assert.deepEqual(accepted(v), ['near_duplicate']);
  });

  test('a different market a metre outside the radius is not even flagged', () => {
    const at = northOf(anchor.coords, config.dedupe.radius_m + 1);
    const v = judge(
      submission({ name: 'Saturday Growers Collective', lon: at[0], lat: at[1] }),
      human,
      config
    );
    assert.deepEqual(accepted(v), []);
  });

  test('a different market a metre inside the radius is flagged', () => {
    const at = northOf(anchor.coords, config.dedupe.radius_m - 1);
    const v = judge(
      submission({ name: 'Saturday Growers Collective', lon: at[0], lat: at[1] }),
      human,
      config
    );
    assert.deepEqual(accepted(v), ['near_duplicate']);
  });

  test('the dedupe radius is committed policy, not a constant in the server', () => {
    // Same market, same coordinates, radius set to zero: nothing is a
    // duplicate. Proves the number comes from the config file a reviewer can
    // argue with, rather than from code only a deploy can change.
    const noDedupe: IntakeConfig = { ...config, dedupe: { radius_m: 0 } };
    const v = judge(
      submission({ name: anchor.name, lon: anchor.coords[0], lat: anchor.coords[1] }),
      human,
      noDedupe
    );
    assert.deepEqual(accepted(v), []);
  });

  test('the radius intake drops for is the radius CI rejects for', () => {
    // scripts/validate-data.ts hard-codes `< 100` while intake reads this
    // number from config, so the one policy has two encodings. Raise the
    // committed value and intake starts deleting submissions CI would have
    // accepted; lower it and submissions pass intake only to fail CI on a pull
    // request the submitter cannot fix. Change one, change the other.
    assert.equal(config.dedupe.radius_m, 100);
  });
});
