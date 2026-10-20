import type { IntakeConfig } from '../config';
import { env } from '../config';
import type { QueueRow, Store } from './index';

/**
 * A queue that lives in the repository, for a container with no persistent disk.
 *
 * The reasoning: the queue is the only unrecoverable state this service holds.
 * Counters resetting on redeploy is harmless; a pending submission evaporating
 * means somebody was told "received" and it was not true. Nothing can rebuild
 * it from the repo unless it was written to the repo — so write it there.
 *
 * This adds no dependency the service did not already have. It needs GitHub
 * write access to open pull requests regardless, so a container running this
 * backend is fully self-contained: outbound HTTPS and nothing else. No volume,
 * no database, no account beyond the one that owns the repo.
 *
 * The cost is a commit and an API round trip per accepted submission, and a
 * write conflict when two land together — handled by optimistic concurrency on
 * the blob SHA with a retry. Hard fails never reach here, so spam does not
 * become commit noise.
 */
interface QueueFile {
  pending: (QueueRow & { ip_hash: string })[];
  /** Rolling window for rate limiting — trimmed by prune(), never grows without bound. */
  recent: { ip_hash: string; at: string }[];
}

const EMPTY: QueueFile = { pending: [], recent: [] };

export class GitHubStore implements Store {
  readonly kind = 'github' as const;
  private path = process.env.INTAKE_QUEUE_PATH ?? 'intake-queue.json';
  private branch = process.env.INTAKE_QUEUE_BRANCH ?? 'intake-queue';
  private sha: string | null = null;
  private cache: QueueFile = EMPTY;

  private async api(path: string, init?: RequestInit) {
    const res = await fetch(`https://api.github.com${path}`, {
      ...init,
      headers: {
        authorization: `Bearer ${env.github.token}`,
        accept: 'application/vnd.github+json',
        'content-type': 'application/json',
        'user-agent': 'fresh-food-map-intake',
        ...(init?.headers ?? {}),
      },
    });
    return res;
  }

  private async read(): Promise<QueueFile> {
    const res = await this.api(
      `/repos/${env.github.repo}/contents/${this.path}?ref=${this.branch}`
    );
    if (res.status === 404) {
      this.sha = null;
      this.cache = structuredClone(EMPTY);
      return this.cache;
    }
    if (!res.ok) throw new Error(`queue read failed: ${res.status} ${await res.text()}`);
    const body = (await res.json()) as { sha: string; content: string };
    this.sha = body.sha;
    this.cache = JSON.parse(Buffer.from(body.content, 'base64').toString('utf8')) as QueueFile;
    return this.cache;
  }

  /** Optimistic concurrency: the SHA we read is the SHA we must still be at. */
  private async write(next: QueueFile, message: string, attempt = 0): Promise<void> {
    const res = await this.api(`/repos/${env.github.repo}/contents/${this.path}`, {
      method: 'PUT',
      body: JSON.stringify({
        message,
        branch: this.branch,
        content: Buffer.from(JSON.stringify(next, null, 2) + '\n').toString('base64'),
        ...(this.sha ? { sha: this.sha } : {}),
      }),
    });
    if (res.status === 409 || res.status === 422) {
      // Somebody else wrote between our read and our write. Re-read and retry
      // rather than clobbering them — losing a concurrent submission is the
      // exact failure this backend exists to prevent.
      if (attempt >= 3) throw new Error('queue write conflicted repeatedly');
      const mine = next.pending.filter((p) => !this.cache.pending.some((c) => c.id === p.id));
      const fresh = await this.read();
      return this.write(
        { pending: [...fresh.pending, ...mine], recent: [...fresh.recent, ...next.recent.slice(-1)] },
        message,
        attempt + 1
      );
    }
    if (!res.ok) throw new Error(`queue write failed: ${res.status} ${await res.text()}`);
    this.sha = ((await res.json()) as { content: { sha: string } }).content.sha;
    this.cache = next;
  }

  async init() {
    // Ensure the branch exists, off the default branch's current head.
    const head = await this.api(`/repos/${env.github.repo}/git/ref/heads/${this.branch}`);
    if (head.status === 404) {
      const base = await this.api(`/repos/${env.github.repo}/git/ref/heads/${env.github.baseBranch}`);
      if (!base.ok) throw new Error(`cannot read ${env.github.baseBranch}: ${base.status}`);
      const sha = ((await base.json()) as { object: { sha: string } }).object.sha;
      const made = await this.api(`/repos/${env.github.repo}/git/refs`, {
        method: 'POST',
        body: JSON.stringify({ ref: `refs/heads/${this.branch}`, sha }),
      });
      if (!made.ok) throw new Error(`cannot create ${this.branch}: ${await made.text()}`);
    }
    await this.read();
  }

  async enqueue(row: { id: string; payload: unknown; ipHash: string; flags: string[] }) {
    const q = await this.read();
    q.pending.push({
      id: row.id,
      received_at: new Date().toISOString(),
      payload: JSON.stringify(row.payload),
      status: 'pending',
      flags: JSON.stringify(row.flags),
      pr_url: null,
      ip_hash: row.ipHash,
    });
    q.recent.push({ ip_hash: row.ipHash, at: new Date().toISOString() });
    await this.write(q, `chore(intake): queue submission ${row.id.slice(0, 8)}`);
  }

  async pending(limit: number): Promise<QueueRow[]> {
    return (await this.read()).pending.slice(0, limit);
  }

  async markBatched(ids: string[], prUrl: string) {
    const q = await this.read();
    q.pending = q.pending.filter((p) => !ids.includes(p.id));
    await this.write(q, `chore(intake): batch ${ids.length} into ${prUrl}`);
  }

  async overLimit(ipHash: string, limits: IntakeConfig['rate_limit']) {
    const q = await this.read();
    const since = (ms: number) => Date.now() - ms;
    const count = (ms: number) =>
      q.recent.filter((r) => r.ip_hash === ipHash && Date.parse(r.at) >= since(ms)).length;
    if (count(3600_000) >= limits.per_ip_per_hour) return { blocked: true, reason: 'hourly' };
    if (count(86_400_000) >= limits.per_ip_per_day) return { blocked: true, reason: 'daily' };
    return { blocked: false };
  }

  /** Recorded as part of enqueue — a commit per rate-limit tick would be absurd. */
  async record() {}

  async prune(r: IntakeConfig['retention_days']) {
    const q = await this.read();
    const cutoff = Date.now() - r.rate_limit * 86_400_000;
    const before = q.recent.length;
    q.recent = q.recent.filter((x) => Date.parse(x.at) >= cutoff);
    if (q.recent.length !== before) await this.write(q, 'chore(intake): prune rate-limit window');
    return { rateLimitRows: before - q.recent.length, rejectedRows: 0 };
  }

  async close() {}
}
