import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * Policy comes from a committed file; secrets and placement come from the
 * environment. The split is the point — anyone can read the rules this service
 * enforces without having access to the machine it runs on.
 */
export interface IntakeConfig {
  batch_size: number;
  min_seconds_to_submit: number;
  rate_limit: { per_ip_per_hour: number; per_ip_per_day: number };
  dedupe: { radius_m: number };
  retention_days: { rate_limit: number; rejected: number };
  flag_for_review: string[];
}

export function loadConfig(path = resolve(process.cwd(), 'intake.config.json')): IntakeConfig {
  return JSON.parse(readFileSync(path, 'utf8')) as IntakeConfig;
}

function required(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`${name} is required — see server/README.md`);
  return v;
}

export const env = {
  port: Number(process.env.PORT ?? 8787),

  /**
   * Where the queue lives. It MUST be persistent disk. On an ephemeral
   * container filesystem this file is recreated empty on every deploy, losing
   * pending submissions and resetting every rate-limit counter — and nothing
   * errors, so the failure is invisible until someone asks where a submission
   * went.
   */
  dbPath: process.env.INTAKE_DB_PATH ?? resolve(process.cwd(), 'intake.db'),

  /** Salt for hashing IPs. Rotating it resets rate limiting; that is the trade. */
  get ipSalt() {
    return required('INTAKE_IP_SALT');
  },

  /**
   * Set when the service sits behind a proxy that overwrites this header
   * itself. Left unset, X-Forwarded-For is ignored entirely, because a client
   * can send it and a limiter that trusts it counts every request separately.
   */
  trustedProxyHeader: process.env.INTAKE_TRUSTED_PROXY_HEADER ?? null,

  github: {
    get token() {
      return required('GITHUB_TOKEN');
    },
    repo: process.env.GITHUB_REPO ?? 'Black-Unicorn-Design-Studio/fresh-food-map',
    baseBranch: process.env.GITHUB_BASE_BRANCH ?? 'main',
  },
};

/**
 * Touches every variable the running service needs, so a misconfigured deployment fails at
 * boot instead of on the first real submission.
 *
 * The accessors above are lazy deliberately: this module has to be importable without a
 * full environment, and the batching agent needs a different subset from the service. The
 * cost is that a container with no `INTAKE_IP_SALT` starts, reports healthy, and throws only
 * when somebody actually submits — which is both the worst moment to find out and the
 * hardest to attribute, because the container looks fine. Under an orchestrator, failing at
 * boot is a container that never goes live; failing later is one that quietly eats
 * submissions.
 */
export function assertServiceEnv(): void {
  void env.ipSalt;
  if ((process.env.INTAKE_STORE ?? 'sqlite').toLowerCase() === 'github') {
    void env.github.token;
  }
}
