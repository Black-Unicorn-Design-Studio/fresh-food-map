import { strict as assert } from 'node:assert';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { after, test } from 'node:test';

/**
 * A submission's hashed IP lasts only while it waits in the queue.
 *
 * The privacy policy (`src/app/privacy.tsx`) says so in as many words, so this is a test of a
 * promise made to the people submitting, not only of a column. It used to be kept for the
 * life of the queue — the one place the service held who submitted what — and the failure
 * these guard against is silent: a hash nobody reads, sitting beside a payload, forever.
 */

const WORK_DIR = mkdtempSync(join(tmpdir(), 'fff-queue-hash-'));

// Before server/config.ts loads: it reads INTAKE_DB_PATH once, when its body runs, so every
// import of server code below is dynamic.
process.env.INTAKE_DB_PATH = join(WORK_DIR, 'intake.db');
process.env.INTAKE_STORE = 'sqlite';

after(() => rmSync(WORK_DIR, { recursive: true, force: true }));

async function openStore() {
  const { SqliteStore } = await import('../server/store/sqlite');
  const store = new SqliteStore();
  await store.init();
  return store;
}

/** node:sqlite returns null-prototype rows; copied out so assertions compare plain values. */
function hashOf(id: string): string {
  const db = new DatabaseSync(process.env.INTAKE_DB_PATH!);
  const row = db.prepare('select ip_hash from submissions where id = ?').get(id) as
    | { ip_hash: string }
    | undefined;
  db.close();
  assert.ok(row, `queue row ${id} disappeared`);
  return row.ip_hash;
}

test('a pending submission keeps its hash, and batching clears it', async () => {
  const store = await openStore();
  await store.enqueue({ id: 'a', payload: { name: 'A' }, ipHash: 'hash-a', flags: [] });
  await store.enqueue({ id: 'b', payload: { name: 'B' }, ipHash: 'hash-b', flags: [] });
  assert.equal(hashOf('a'), 'hash-a');

  await store.markBatched(['a'], 'https://github.test/o/r/pull/1');
  await store.close();

  assert.equal(hashOf('a'), '', 'a batched row must not keep who sent it');
  assert.equal(hashOf('b'), 'hash-b', 'a row still waiting is untouched');
});

test('rows batched before the fix are cleared on boot, and pending ones are not', async () => {
  // The shape a queue written by the old markBatched() has on disk: batched, hash intact.
  const db = new DatabaseSync(process.env.INTAKE_DB_PATH!);
  db.prepare(
    `insert into submissions (id, received_at, payload, status, flags, pr_url, ip_hash)
     values ('old', datetime('now'), '{}', 'batched', '[]', 'https://github.test/o/r/pull/0', 'hash-old')`
  ).run();
  db.close();

  const store = await openStore();
  await store.close();

  assert.equal(hashOf('old'), '');
  assert.equal(hashOf('b'), 'hash-b');
});
