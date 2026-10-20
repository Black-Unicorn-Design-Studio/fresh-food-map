/**
 * Boot-time environment validation.
 *
 * The accessors in `server/config.ts` are lazy on purpose: the module has to be importable
 * without a full environment, and the batching agent needs a different subset from the
 * service. The cost is that a container missing `INTAKE_IP_SALT` starts, reports healthy,
 * and throws only when somebody actually submits — the worst moment to find out, and the
 * hardest to attribute, because the container looks fine.
 *
 * `assertServiceEnv()` closes that gap, and these tests exist because the gap is invisible
 * in development: a `.env` file supplies the variables locally, so the failure only appears
 * on a deployment nobody is watching.
 */
import { strict as assert } from 'node:assert';
import { afterEach, describe, test } from 'node:test';

import { assertServiceEnv } from '../server/config';

const KEYS = ['INTAKE_IP_SALT', 'INTAKE_STORE', 'GITHUB_TOKEN'] as const;
const saved = Object.fromEntries(KEYS.map((k) => [k, process.env[k]]));

afterEach(() => {
  for (const k of KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
});

const withEnv = (vars: Partial<Record<(typeof KEYS)[number], string | undefined>>) => {
  for (const k of KEYS) delete process.env[k];
  for (const [k, v] of Object.entries(vars)) if (v !== undefined) process.env[k] = v;
};

describe('assertServiceEnv: a misconfigured deployment must not reach a listening socket', () => {
  test('a missing salt is refused at boot, naming the variable and where to read about it', () => {
    withEnv({});
    assert.throws(() => assertServiceEnv(), /INTAKE_IP_SALT is required/);
  });

  /** An empty string is the shape a half-filled env file produces, and it is not a salt. */
  test('an empty salt is refused too, not treated as set', () => {
    withEnv({ INTAKE_IP_SALT: '' });
    assert.throws(() => assertServiceEnv(), /INTAKE_IP_SALT is required/);
  });

  test('the default store needs only a salt — no GitHub token', () => {
    withEnv({ INTAKE_IP_SALT: 'probe' });
    assert.doesNotThrow(() => assertServiceEnv());
  });

  test('sqlite named explicitly behaves the same as the default', () => {
    withEnv({ INTAKE_IP_SALT: 'probe', INTAKE_STORE: 'sqlite' });
    assert.doesNotThrow(() => assertServiceEnv());
  });

  /**
   * The github store keeps the queue in a branch, so it cannot do anything at all without a
   * token — and unlike the salt, that failure would otherwise appear only when the first
   * submission tried to write.
   */
  test('the github store additionally requires a token', () => {
    withEnv({ INTAKE_IP_SALT: 'probe', INTAKE_STORE: 'github' });
    assert.throws(() => assertServiceEnv(), /GITHUB_TOKEN is required/);
  });

  test('the github store starts when both are present', () => {
    withEnv({ INTAKE_IP_SALT: 'probe', INTAKE_STORE: 'github', GITHUB_TOKEN: 'ghp_probe' });
    assert.doesNotThrow(() => assertServiceEnv());
  });

  /** Store selection is lowercased before comparison, so a capitalised value still matches. */
  test('the store name is matched case-insensitively', () => {
    withEnv({ INTAKE_IP_SALT: 'probe', INTAKE_STORE: 'GitHub' });
    assert.throws(() => assertServiceEnv(), /GITHUB_TOKEN is required/);
  });
});
