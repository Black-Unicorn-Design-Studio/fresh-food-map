import { strict as assert } from 'node:assert';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { after, test } from 'node:test';

import { MarketFeature, MarketProperties, Submission } from '@/lib/market-schema';
import type { IntakeConfig } from '../server/config';

/**
 * The batching agent — the step that turns the queue into a proposal.
 *
 * `toFeature` and `prBody` are not exported from `server/batch.ts`; `runBatch` is the
 * module's whole public surface. So every test here drives `runBatch` with `fetch`
 * stubbed and reads the two functions' output back out of the requests it makes: the
 * feature from the `PUT /contents/data/markets.json` body, the reviewer-facing prose
 * from `POST /pulls`. That is closer to what a reviewer actually receives than calling
 * the helpers directly would be, and an unstubbed URL throws, so nothing can reach the
 * network by accident.
 */

const WORK_DIR = mkdtempSync(join(tmpdir(), 'fff-batch-'));

// Set before server/config.ts is ever loaded: `env.dbPath`, `env.github.repo` and
// `env.github.baseBranch` are plain properties read once, when that module's body runs.
// Every import of server code below is therefore dynamic and happens after this block.
process.env.INTAKE_DB_PATH = join(WORK_DIR, 'intake.db');
process.env.INTAKE_STORE = 'sqlite';
process.env.GITHUB_TOKEN = 'test-token-never-leaves-this-process';
process.env.GITHUB_REPO = 'test-owner/test-repo';
process.env.GITHUB_BASE_BRANCH = 'main';

after(() => rmSync(WORK_DIR, { recursive: true, force: true }));

const config = JSON.parse(
  readFileSync(join(process.cwd(), 'intake.config.json'), 'utf8')
) as IntakeConfig;

// ---------------------------------------------------------------------------
// queue fixtures
// ---------------------------------------------------------------------------

/** A submission exactly as intake would have queued it: `Submission.parse`d, nothing else. */
function submission(over: Record<string, unknown> = {}) {
  return Submission.parse({
    name: 'Ferry Plaza Farmers Market',
    address: 'One Ferry Building, San Francisco, CA',
    lat: 37.7955,
    lon: -122.3937,
    country: 'US',
    timezone: 'America/Los_Angeles',
    ...over,
  });
}

async function openStore() {
  const { SqliteStore } = await import('../server/store/sqlite');
  const store = new SqliteStore();
  await store.init();
  return store;
}

/** Empties the queue and enqueues the given rows. Returns the queue ids, in order. */
async function queue(rows: { payload: unknown; flags?: string[] }[]): Promise<string[]> {
  const store = await openStore();
  await store.close();

  const db = new DatabaseSync(process.env.INTAKE_DB_PATH!);
  db.exec('delete from submissions');
  db.close();

  const ids: string[] = [];
  const seeder = await openStore();
  for (const row of rows) {
    const id = randomUUID();
    ids.push(id);
    await seeder.enqueue({ id, payload: row.payload, ipHash: 'test-hash', flags: row.flags ?? [] });
  }
  await seeder.close();
  return ids;
}

/** node:sqlite hands back null-prototype rows; copied into a plain object so assertions read normally. */
function queueRow(id: string): { status: string; pr_url: string | null } {
  const db = new DatabaseSync(process.env.INTAKE_DB_PATH!);
  const row = db.prepare('select status, pr_url from submissions where id = ?').get(id) as
    | { status: string; pr_url: string | null }
    | undefined;
  db.close();
  assert.ok(row, `queue row ${id} disappeared`);
  return { status: row.status, pr_url: row.pr_url };
}

// ---------------------------------------------------------------------------
// GitHub stub
// ---------------------------------------------------------------------------

interface Call {
  method: string;
  url: string;
  body: any;
}

const EXISTING_FEATURE = {
  type: 'Feature',
  geometry: { type: 'Point', coordinates: [-122.2711, 37.8044] },
  properties: {
    id: '11111111-2222-4333-8444-555555555555',
    name: 'Old Oakland Farmers Market',
    address: '499 9th Street, Oakland, CA',
    schedule: [{ day: 'fri', open: '08:00', close: '14:00' }],
    season_start: null,
    season_end: null,
    website: null,
    source: 'manual',
    tags: ['accepts-snap'],
    source_ref: null,
    active: true,
    country: 'US',
    timezone: 'America/Los_Angeles',
  },
};

const BASE_DATASET = {
  type: 'FeatureCollection',
  name: 'farmers-markets',
  features: [EXISTING_FEATURE],
};

const PR_URL = 'https://github.test/test-owner/test-repo/pull/7';

/**
 * Stands in for api.github.com. Records every request so the tests can read back what
 * the agent proposed. Any request the real batch does not make is an error, not a
 * default — a silent fallthrough would let a test pass against a stub instead of code.
 */
function stubGitHub(dataset: unknown = BASE_DATASET, openPulls: unknown[] = []) {
  const calls: Call[] = [];
  const original = globalThis.fetch;

  globalThis.fetch = (async (input: unknown, init?: RequestInit) => {
    const url = String(input);
    const method = (init?.method ?? 'GET').toUpperCase();
    calls.push({ method, url, body: init?.body ? JSON.parse(String(init.body)) : null });

    if (method === 'GET' && url.includes('/pulls?')) {
      return new Response(JSON.stringify(openPulls), { status: 200 });
    }
    if (method === 'GET' && url.includes('/git/ref/heads/')) {
      return new Response(JSON.stringify({ object: { sha: 'base-sha' } }), { status: 200 });
    }
    if (method === 'GET' && url.includes('/contents/data/markets.json')) {
      return new Response(
        JSON.stringify({
          sha: 'dataset-blob-sha',
          content: Buffer.from(JSON.stringify(dataset)).toString('base64'),
        }),
        { status: 200 }
      );
    }
    if (method === 'POST' && url.endsWith('/git/refs')) return new Response('{}', { status: 201 });
    if (method === 'PUT' && url.includes('/contents/data/markets.json')) {
      return new Response('{}', { status: 200 });
    }
    if (method === 'POST' && url.endsWith('/pulls')) {
      return new Response(JSON.stringify({ html_url: PR_URL }), { status: 201 });
    }
    throw new Error(`unstubbed GitHub request: ${method} ${url}`);
  }) as unknown as typeof fetch;

  return { calls, restore: () => void (globalThis.fetch = original) };
}

async function runBatch() {
  return (await import('../server/batch')).runBatch();
}

/** The dataset as it was committed to the branch — i.e. what `toFeature` produced. */
function committedDataset(calls: Call[]) {
  const put = calls.find((c) => c.method === 'PUT' && c.url.includes('/contents/data/markets.json'));
  assert.ok(put, 'expected the batch to commit data/markets.json');
  return JSON.parse(Buffer.from(put.body.content, 'base64').toString('utf8'));
}

/** Features the batch appended, i.e. everything past the base dataset. */
function addedFeatures(calls: Call[], baseCount = BASE_DATASET.features.length) {
  return committedDataset(calls).features.slice(baseCount);
}

/** The pull request request body — i.e. what `prBody` produced. */
function pullRequest(calls: Call[]) {
  const post = calls.find((c) => c.method === 'POST' && c.url.endsWith('/pulls'));
  assert.ok(post, 'expected the batch to open a pull request');
  return post.body as { title: string; body: string; head: string; base: string };
}

/** Runs one batch against the stub and hands back both sides of what it proposed. */
async function propose(dataset: unknown = BASE_DATASET) {
  const gh = stubGitHub(dataset);
  try {
    const result = await runBatch();
    return { result, calls: gh.calls, added: addedFeatures(gh.calls), pr: pullRequest(gh.calls) };
  } finally {
    gh.restore();
  }
}

// ---------------------------------------------------------------------------
// toFeature — the shape the batching agent assigns
// ---------------------------------------------------------------------------

test('a queued submission becomes a feature the shared schema accepts', async () => {
  await queue([{ payload: submission() }]);
  const { added } = await propose();

  assert.equal(added.length, 1);
  // Asserted against src/lib/market-schema.ts itself, not a restatement of it. This is the
  // one-schema rule with teeth: if the agent's shape and the contract CI runs ever drift,
  // the failure is a pull request that passes intake and then fails CI, which is the worst
  // possible place to find it.
  const parsed = MarketFeature.safeParse(added[0]);
  assert.equal(
    parsed.success,
    true,
    parsed.success ? '' : parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ')
  );
});

test('the agent assigns the provenance a submitter cannot: fresh id, community source, no source_ref, active', async () => {
  const [queueId] = await queue([{ payload: submission() }]);
  const { added } = await propose();
  const props = added[0].properties;

  assert.match(props.id, /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
  // Not the queue row's id: the record's identity is minted for the dataset, and reusing
  // the queue id would leak an internal handle into published, permanent data.
  assert.notEqual(props.id, queueId);
  assert.equal(props.source, 'community');
  assert.equal(props.source_ref, null);
  assert.equal(props.active, true);
});

test('provenance sent by a submitter is overwritten, never trusted', async () => {
  // Intake strips these before queueing, so this row could only exist if something upstream
  // changed. The agent must still be the one that decides attribution: accepting `source`
  // from the wire would let anyone label their own submission as coming from a state portal,
  // which is a false attribution in an ODbL dataset.
  const hostile = {
    ...submission({ name: 'Hostile Provenance Market' }),
    id: '00000000-0000-4000-8000-000000000000',
    source: 'state_portal',
    source_ref: 'https://example.gov/definitely-official',
    active: false,
  };
  await queue([{ payload: hostile }]);
  const { added } = await propose();
  const props = added[0].properties;

  assert.notEqual(props.id, '00000000-0000-4000-8000-000000000000');
  assert.equal(props.source, 'community');
  assert.equal(props.source_ref, null);
  assert.equal(props.active, true);
});

test('a proposed feature carries no verified field — merging is the check', async () => {
  // Regression guard for the retired trust badge. `verified`/`verified_at` are gone, and
  // MarketProperties is a strictObject precisely so a re-added key is a loud CI failure
  // rather than a silent strip. If a writer ever re-adds one here it must be caught in the
  // agent, before it reaches a branch.
  await queue([{ payload: submission({ website: 'https://example.com/market' }) }]);
  const { added } = await propose();
  const props = added[0].properties;

  assert.equal('verified' in props, false);
  assert.equal('verified_at' in props, false);
  // strictObject: a pass also proves there are no other extra keys riding along.
  assert.equal(MarketProperties.safeParse(props).success, true);
});

test('the facts a submitter supplied survive into the feature unchanged', async () => {
  const payload = submission({
    name: 'Marin Civic Center Farmers Market',
    address: '10 Avenue of the Flags, San Rafael, CA',
    lat: 37.9994,
    lon: -122.5316,
    schedule: [
      { day: 'thu', open: '08:00', close: '13:00' },
      { day: 'sun', open: '08:00', close: '13:00' },
    ],
    season_start: '04-01',
    season_end: '11-15',
    website: 'https://example.com/marin',
    tags: ['producer-owned', 'accepts-snap'],
  });
  await queue([{ payload }]);
  const { added } = await propose();
  const feature = added[0];

  assert.equal(feature.properties.name, payload.name);
  assert.equal(feature.properties.address, payload.address);
  assert.deepEqual(feature.properties.schedule, payload.schedule);
  assert.equal(feature.properties.season_start, '04-01');
  assert.equal(feature.properties.season_end, '11-15');
  assert.equal(feature.properties.website, payload.website);
  assert.deepEqual(feature.properties.tags, ['producer-owned', 'accepts-snap']);
  // GeoJSON is [lon, lat]. Swapping them is the classic way to put a market in the sea,
  // and for most of North America a swapped pair is still inside the schema's ranges only
  // sometimes — so assert the order rather than relying on validation to notice.
  assert.deepEqual(feature.geometry.coordinates, [-122.5316, 37.9994]);
  assert.equal(feature.geometry.type, 'Point');
});

test("a submitter's note is review context and is never published into the dataset", async () => {
  await queue([{ payload: submission({ note: 'The Tuesday market moved to the plaza in 2025.' }) }]);
  const { added, pr } = await propose();

  assert.equal('note' in added[0].properties, false);
  // It is dropped from the record but must not be dropped from the review — see below.
  assert.match(pr.body, /moved to the plaza in 2025/);
});

// ---------------------------------------------------------------------------
// prBody — the only place the system explains the merge button
// ---------------------------------------------------------------------------

test('the pull request tells its reviewer that merging is the check', async () => {
  await queue([{ payload: submission() }]);
  const { pr } = await propose();

  // This wording is load-bearing, not decoration: it is the only place the system tells the
  // one human gate what pressing merge means. There is no verification UI and no second
  // step behind it.
  assert.match(pr.body, /merging this pull request is the check/i);
  assert.match(pr.body, /nothing here has been looked at by a person/i);
  assert.match(pr.body, /confirm each one exists/i);
  // "verified" is retired vocabulary. A body that promises a reviewer something is verified
  // would be describing a field, and a trust model, that no longer exist.
  assert.doesNotMatch(pr.body, /\bverified\b/i);
});

test('a clean batch still says nobody has looked, rather than implying approval', async () => {
  await queue([
    { payload: submission({ name: 'Clean Batch Market One' }), flags: [] },
    { payload: submission({ name: 'Clean Batch Market Two' }), flags: [] },
  ]);
  const { pr } = await propose();

  assert.match(pr.body, /no soft check tripped/i);
  // The dangerous reading of "no flags" is "these are fine". The body has to close it off.
  assert.match(pr.body, /not that anyone has looked/i);
  assert.match(pr.body, /still needs checking/i);
  assert.doesNotMatch(pr.body, /## Notes from submitters/);
});

test('flagged submissions are named in the pull request, because the agent never rejects', async () => {
  await queue([
    { payload: submission({ name: 'Unflagged Corner Market' }), flags: [] },
    { payload: submission({ name: 'Flagged Riverside Market' }), flags: ['no_website', 'no_schedule'] },
    { payload: submission({ name: 'Flagged Hilltop Market' }), flags: ['near_duplicate'] },
  ]);
  const { pr, added } = await propose();

  // Never auto-reject: a soft check is a hint for the reviewer, so every submission is in
  // the diff regardless of how it was flagged. A wrong accept costs a review comment; a
  // wrong reject is a silent deletion nobody sees.
  assert.equal(added.length, 3);
  const names = added.map((f: any) => f.properties.name).sort();
  assert.deepEqual(names, [
    'Flagged Hilltop Market',
    'Flagged Riverside Market',
    'Unflagged Corner Market',
  ]);

  // And they are surfaced, not buried: named, with their reasons, and stated to be present.
  assert.match(pr.body, /2 of these tripped a soft check/i);
  assert.match(pr.body, /\*\*in the diff\*\*/);
  assert.match(pr.body, /does not reject/i);
  assert.match(pr.body, /\*\*Flagged Riverside Market\*\* — no_website, no_schedule/);
  assert.match(pr.body, /\*\*Flagged Hilltop Market\*\* — near_duplicate/);
  // The unflagged one is not called out as a problem, but is still in the count above.
  assert.doesNotMatch(pr.body, /\*\*Unflagged Corner Market\*\* —/);
  assert.match(pr.body, /^3 markets submitted through the intake form\./m);
});

test('submitter notes reach review as context, marked as unpublished', async () => {
  await queue([
    { payload: submission({ name: 'Noted Bayview Market', note: 'City moved it one block east.' }) },
    { payload: submission({ name: 'Silent Glen Market' }) },
  ]);
  const { pr } = await propose();

  assert.match(pr.body, /## Notes from submitters/);
  assert.match(pr.body, /_Context for review; not published\._/);
  assert.match(pr.body, /\*\*Noted Bayview Market\*\*: City moved it one block east\./);
  // A market nobody annotated must not appear with an empty note, which would read as
  // "the submitter said nothing useful" rather than "the submitter said nothing".
  assert.doesNotMatch(pr.body, /\*\*Silent Glen Market\*\*:/);
});

test('a note on a flagged submission appears in both roles it plays', async () => {
  // The note explains the flag as often as not — "no website because they only use
  // Instagram" — so it has to survive alongside the flag rather than replace it.
  await queue([
    {
      payload: submission({ name: 'Instagram Only Market', note: 'They only have an Instagram page.' }),
      flags: ['no_website'],
    },
  ]);
  const { pr } = await propose();

  assert.match(pr.body, /\*\*Instagram Only Market\*\* — no_website/);
  assert.match(pr.body, /\*\*Instagram Only Market\*\*: They only have an Instagram page\./);
});

test('a single market is described in the singular, in the title and the body', async () => {
  // Small, but this text is read by a person on every batch; "1 markets" is the kind of
  // seam that makes an automated pull request look untrustworthy.
  await queue([{ payload: submission({ name: 'Lone Pine Market' }) }]);
  const { pr, calls } = await propose();

  assert.match(pr.body, /^1 market submitted through the intake form\./m);
  assert.equal(pr.title, 'data: 1 market from the intake form');
  const put = calls.find((c) => c.method === 'PUT')!;
  assert.equal(put.body.message, 'data: add 1 submitted market');
});

test('the pull request is honest that schema validation is not existence checking', async () => {
  await queue([{ payload: submission() }]);
  const { pr } = await propose();

  // The footer's job is to stop "CI is green" being read as "this market is real".
  assert.match(pr.body, /same[\s\S]{0,20}schema CI uses/i);
  assert.match(pr.body, /not that the market exists/i);
});

// ---------------------------------------------------------------------------
// runBatch — proposing, and refusing to propose
// ---------------------------------------------------------------------------

test('an empty queue touches GitHub not at all', async () => {
  await queue([]);
  const gh = stubGitHub();
  try {
    const result = await runBatch();
    assert.deepEqual(result, { opened: null, count: 0 });
    // Not merely "no pull request": no branch, no commit, no request of any kind. A batch
    // run on a quiet day must leave no trace in the repository.
    assert.deepEqual(gh.calls, []);
  } finally {
    gh.restore();
  }
});

test('proposing appends to the dataset instead of replacing it', async () => {
  await queue([{ payload: submission({ name: 'Appended Market' }) }]);
  const { calls } = await propose();
  const dataset = committedDataset(calls);

  assert.equal(dataset.type, 'FeatureCollection');
  assert.equal(dataset.name, BASE_DATASET.name);
  assert.equal(dataset.features.length, BASE_DATASET.features.length + 1);
  // The existing record must come through byte-for-byte: a batch that rewrites entries it
  // was not given is a data loss the diff makes look intentional.
  assert.deepEqual(dataset.features[0], EXISTING_FEATURE);
});

test('a proposal is a branch off the base, never a commit to it', async () => {
  await queue([{ payload: submission() }]);
  const { calls, pr } = await propose();

  const created = calls.find((c) => c.method === 'POST' && c.url.endsWith('/git/refs'));
  assert.ok(created, 'expected a new branch');
  assert.match(created.body.ref, /^refs\/heads\/intake\/batch-/);
  assert.equal(created.body.sha, 'base-sha');

  const put = calls.find((c) => c.method === 'PUT')!;
  // The commit lands on the new branch, and carries the blob sha it read, so a concurrent
  // edit to the dataset conflicts rather than being clobbered.
  assert.equal(put.body.branch, created.body.ref.replace('refs/heads/', ''));
  assert.notEqual(put.body.branch, 'main');
  assert.equal(put.body.sha, 'dataset-blob-sha');

  assert.equal(pr.base, 'main');
  assert.equal(pr.head, put.body.branch);
});

test('queued rows are marked batched against the pull request that carries them', async () => {
  // Otherwise the next run proposes the same markets again and the reviewer merges a
  // duplicate that CI cannot catch, because the ids differ.
  const ids = await queue([
    { payload: submission({ name: 'Batched Market One' }) },
    { payload: submission({ name: 'Batched Market Two' }) },
  ]);
  const { result } = await propose();

  assert.deepEqual(result, { opened: PR_URL, count: 2 });
  for (const id of ids) {
    assert.deepEqual(queueRow(id), { status: 'batched', pr_url: PR_URL });
  }
});

test('a run proposes at most the committed batch size, and leaves the rest queued', async () => {
  // batch_size is policy, versioned with the data in intake.config.json, so the test reads
  // it rather than restating it.
  const over = config.batch_size + 2;
  const ids = await queue(
    Array.from({ length: over }, (_, i) => ({ payload: submission({ name: `Batch Size Market ${i}` }) }))
  );
  const { result, added } = await propose();

  assert.equal(result.count, config.batch_size);
  assert.equal(added.length, config.batch_size);
  // The overflow is still pending, not dropped. Which rows land in which batch depends on
  // insertion order the store does not promise at this granularity, so only the counts are
  // asserted here.
  const rows = ids.map(queueRow);
  const batched = rows.filter((r) => r.status === 'batched');
  const pending = rows.filter((r) => r.status === 'pending');
  assert.equal(batched.length, config.batch_size);
  assert.equal(pending.length, over - config.batch_size);
  assert.equal(pending.every((r) => r.pr_url === null), true);
});

/**
 * Every batch branches from the base and appends to the same data/markets.json, so two open
 * pull requests always conflict and the second to merge goes stale. Closing the loser is
 * worse than the conflict: its rows are already `batched` with that pull request's URL, so
 * the agent never offers them again and accepted submissions vanish. Waiting costs nothing.
 */
test('a second batch is not opened while one is still under review', async () => {
  const ids = await queue([{ payload: submission({ name: 'Waits Its Turn Market' }) }]);

  const gh = stubGitHub(BASE_DATASET, [
    { number: 7, head: { ref: 'intake/batch-2026-09-09-abcd1234' } },
  ]);
  try {
    const result = await runBatch();
    assert.equal(result.opened, null);
    assert.equal(result.count, 0);
    // It asks, then stops: no branch, no commit, no pull request.
    assert.deepEqual(
      gh.calls.map((c) => c.method),
      ['GET']
    );
  } finally {
    gh.restore();
  }

  // The submission is untouched, so the next run picks it up.
  for (const id of ids) assert.deepEqual(queueRow(id), { status: 'pending', pr_url: null });
});

/** Somebody else's pull request against the same branch is not a batch and must not block. */
test('an unrelated open pull request does not hold up a batch', async () => {
  const ids = await queue([{ payload: submission({ name: 'Not Blocked Market' }) }]);

  const gh = stubGitHub(BASE_DATASET, [{ number: 9, head: { ref: 'fix/some-typo' } }]);
  try {
    const result = await runBatch();
    assert.equal(result.opened, PR_URL);
    assert.equal(result.count, 1);
  } finally {
    gh.restore();
  }

  for (const id of ids) assert.deepEqual(queueRow(id), { status: 'batched', pr_url: PR_URL });
});

test('a batch that would fail CI is refused before a branch exists, and nothing is lost', async () => {
  // Tags are a closed vocabulary; an unknown one cannot survive `Submission.parse`, so this
  // row stands in for any drift between what the queue holds and what the dataset schema
  // accepts. The agent must not open a pull request the submitter cannot fix.
  const ids = await queue([
    { payload: submission({ name: 'Valid Neighbour Market' }) },
    { payload: { ...submission({ name: 'Invented Tag Market' }), tags: ['artisanal-vibes'] } },
  ]);

  const gh = stubGitHub();
  try {
    await assert.rejects(runBatch(), /refusing to open a PR that would fail validation/);
    // It bails before mutating anything: the three reads happened — open pull requests, the
    // base ref, the dataset — and then no branch, no commit, no PR.
    assert.deepEqual(
      gh.calls.map((c) => c.method),
      ['GET', 'GET', 'GET']
    );
  } finally {
    gh.restore();
  }

  // NOTE: current behaviour, documented rather than endorsed. One unacceptable row blocks
  // the whole batch, including the valid market queued beside it. Nothing is deleted — both
  // rows stay pending, which is the right side of the never-auto-reject rule — but the queue
  // jams until a person intervenes, and only the exit code says so.
  for (const id of ids) {
    assert.deepEqual(queueRow(id), { status: 'pending', pr_url: null });
  }
});

test('every proposed market gets an id of its own, distinct from everything already listed', async () => {
  // `id` is the join key the app and every later edit use. MarketProperties cannot see across
  // features, so uniqueness is not something the pre-flight check can catch — it has to be
  // true because the agent minted each one.
  await queue([
    { payload: submission({ name: 'Distinct Id Market One' }) },
    { payload: submission({ name: 'Distinct Id Market Two' }) },
  ]);
  const { calls, added } = await propose();

  assert.equal(added.length, 2);
  const ids = committedDataset(calls).features.map((f: any) => f.properties.id);
  assert.equal(new Set(ids).size, ids.length);
  assert.equal(ids.includes(EXISTING_FEATURE.properties.id), true);
});
