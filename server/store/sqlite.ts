import { DatabaseSync } from 'node:sqlite';

import type { IntakeConfig } from '../config';
import { env } from '../config';
import type { QueueRow, Store } from './index';

/**
 * Default. One file, no service, no dependency — Node 22 ships SQLite.
 *
 * The file MUST be on persistent disk. On an ephemeral container filesystem it
 * is recreated empty on every deploy: pending submissions vanish and every rate
 * limit resets, and nothing errors, so the failure is invisible until somebody
 * asks where their submission went. If your platform gives you a volume, point
 * INTAKE_DB_PATH at it and this backend is still the right choice. If it does
 * not, use the github backend instead (see server/README.md).
 */
export class SqliteStore implements Store {
  readonly kind = 'sqlite' as const;
  private db!: DatabaseSync;

  async init() {
    this.db = new DatabaseSync(env.dbPath);
    this.db.exec('pragma journal_mode = WAL');
    this.db.exec(`
      create table if not exists submissions (
        id text primary key, received_at text not null, payload text not null,
        status text not null default 'pending', flags text, pr_url text, ip_hash text not null
      );
      create index if not exists submissions_status_idx on submissions (status, received_at);
      create table if not exists rate_limit (
        ip_hash text not null, window_start text not null, count integer not null default 0,
        primary key (ip_hash, window_start)
      );
    `);
    // Rows batched before markBatched() began scrubbing still carry their hash. Clearing
    // them here, on every boot, is idempotent and costs nothing once there are none — and it
    // is what makes the privacy policy's sentence true for a queue that predates the fix,
    // rather than only for submissions that arrive after it.
    this.db.exec(`update submissions set ip_hash = '' where status != 'pending' and ip_hash != ''`);
  }

  async enqueue(row: { id: string; payload: unknown; ipHash: string; flags: string[] }) {
    this.db
      .prepare(
        `insert into submissions (id, received_at, payload, status, flags, ip_hash)
         values (?, datetime('now'), ?, 'pending', ?, ?)`
      )
      .run(row.id, JSON.stringify(row.payload), JSON.stringify(row.flags), row.ipHash);
  }

  async pending(limit: number): Promise<QueueRow[]> {
    return this.db
      .prepare(
        `select id, received_at, payload, status, flags, pr_url from submissions
          where status = 'pending' order by received_at asc limit ?`
      )
      .all(limit) as unknown as QueueRow[];
  }

  /**
   * Marks rows batched **and forgets who sent them.**
   *
   * The hash rides with a pending row and nothing reads it there — rate limiting counts the
   * `rate_limit` table, which `prune()` empties after a day. Once a submission is a pull
   * request it is a public proposal and the queue row is bookkeeping, so the hash has no
   * purpose left and is cleared in the same transaction that changes the status. It was kept
   * for the life of the queue before this, which was the one place the service held who
   * submitted what. `''` rather than `null` because the column is `not null`, and a schema
   * migration on a live queue is a worse trade than an empty string.
   *
   * `src/app/privacy.tsx` promises exactly this. Changing it changes that screen too.
   */
  async markBatched(ids: string[], prUrl: string) {
    const stmt = this.db.prepare(
      `update submissions set status='batched', pr_url=?, ip_hash='' where id=?`
    );
    this.db.exec('begin');
    try {
      for (const id of ids) stmt.run(prUrl, id);
      this.db.exec('commit');
    } catch (e) {
      this.db.exec('rollback');
      throw e;
    }
  }

  async overLimit(ipHash: string, limits: IntakeConfig['rate_limit']) {
    const n = (since: string) =>
      (
        this.db
          .prepare(
            `select coalesce(sum(count),0) as n from rate_limit
              where ip_hash=? and window_start >= datetime('now', ?)`
          )
          .get(ipHash, since) as { n: number }
      ).n;
    if (n('-1 hour') >= limits.per_ip_per_hour) return { blocked: true, reason: 'hourly' };
    if (n('-1 day') >= limits.per_ip_per_day) return { blocked: true, reason: 'daily' };
    return { blocked: false };
  }

  async record(ipHash: string) {
    this.db
      .prepare(
        `insert into rate_limit (ip_hash, window_start, count)
         values (?, strftime('%Y-%m-%dT%H:00:00','now'), 1)
         on conflict (ip_hash, window_start) do update set count = count + 1`
      )
      .run(ipHash);
  }

  async prune(r: IntakeConfig['retention_days']) {
    const a = this.db
      .prepare(`delete from rate_limit where window_start < datetime('now', ?)`)
      .run(`-${r.rate_limit} days`);
    const b = this.db
      .prepare(`delete from submissions where status='rejected' and received_at < datetime('now', ?)`)
      .run(`-${r.rejected} days`);
    return { rateLimitRows: Number(a.changes), rejectedRows: Number(b.changes) };
  }

  async close() {
    this.db.close();
  }
}
