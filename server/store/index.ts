import type { IntakeConfig } from '../config';

/**
 * The queue, behind an interface, because where it lives depends on where this
 * runs and that is not a decision the rest of the service should see.
 *
 * Deliberately one codebase with a runtime switch rather than two releases:
 * two builds of the same service is two things to keep in step, and they drift
 * exactly like two copies of a schema do.
 */
export type Status = 'pending' | 'batched' | 'merged' | 'rejected';

export interface QueueRow {
  id: string;
  received_at: string;
  payload: string;
  status: Status;
  flags: string | null;
  pr_url: string | null;
}

export interface Store {
  readonly kind: 'sqlite' | 'github';
  init(): Promise<void>;
  enqueue(row: { id: string; payload: unknown; ipHash: string; flags: string[] }): Promise<void>;
  pending(limit: number): Promise<QueueRow[]>;
  markBatched(ids: string[], prUrl: string): Promise<void>;
  overLimit(
    ipHash: string,
    limits: IntakeConfig['rate_limit']
  ): Promise<{ blocked: boolean; reason?: string }>;
  record(ipHash: string): Promise<void>;
  prune(retention: IntakeConfig['retention_days']): Promise<{ rateLimitRows: number; rejectedRows: number }>;
  close(): Promise<void>;
}

export async function createStore(): Promise<Store> {
  const kind = (process.env.INTAKE_STORE ?? 'sqlite').toLowerCase();
  if (kind === 'github') {
    const { GitHubStore } = await import('./github');
    return new GitHubStore();
  }
  if (kind === 'sqlite') {
    const { SqliteStore } = await import('./sqlite');
    return new SqliteStore();
  }
  throw new Error(`INTAKE_STORE must be "sqlite" or "github", got "${kind}"`);
}
