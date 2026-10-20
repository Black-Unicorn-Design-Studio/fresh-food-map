/**
 * Checks that what a deployment serves is what git says it should serve.
 *
 * Run after publishing, and on a timer. The failures it exists to catch are all silent ones:
 * a `web/` directory that never received the last rsync, a build that produced a stale
 * dataset, a bind mount orphaned by a rebuild — each of which leaves a healthy-looking site
 * serving markets nobody merged, or missing markets somebody did.
 *
 * It compares against `data/markets.json` in the checkout, never against the compiled
 * bundle: the bundle is the thing that goes stale, so a bundle-to-file comparison would
 * agree with itself while both were wrong.
 *
 * Imports the same schema as CI, the intake service and the batching agent. A fourth copy of
 * the contract would be a fourth thing to drift.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { MarketCollection } from '@/lib/market-schema';

const url = process.argv[2];
if (!url) {
  console.error('usage: verify-published.ts <url of the served markets.json>');
  process.exit(2);
}

// A function declaration, not an arrow const: TypeScript only treats a `never`-returning
// call as terminating control flow for a declaration or an explicitly annotated const, and
// without that narrowing every `.data` below stays possibly-undefined.
function fail(msg: string): never {
  console.error(`published dataset FAILED: ${msg}`);
  process.exit(1);
}

async function main(): Promise<void> {
const expectedRaw = JSON.parse(
  readFileSync(resolve(process.cwd(), 'data/markets.json'), 'utf8')
) as unknown;
const expected = MarketCollection.safeParse(expectedRaw);
if (!expected.success) {
  fail(`data/markets.json in the checkout is itself invalid: ${expected.error.issues[0]?.message}`);
}

const res = await fetch(url).catch((e: unknown) => fail(`could not fetch ${url}: ${String(e)}`));
if (!res.ok) fail(`${url} returned HTTP ${res.status}`);

const servedRaw = await res.json().catch(() => fail(`${url} did not return JSON`));
const served = MarketCollection.safeParse(servedRaw);
if (!served.success) {
  // The same validation the app now applies before believing a fetched dataset, so a feed
  // the app would refuse never passes silently here either.
  fail(`served dataset does not match the schema: ${served.error.issues[0]?.message}`);
}

const ids = (c: { features: { properties: { id: string } }[] }) =>
  new Set(c.features.map((f) => f.properties.id));
const want = ids(expected.data);
const have = ids(served.data);

const missing = [...want].filter((id) => !have.has(id));
const extra = [...have].filter((id) => !want.has(id));

if (missing.length || extra.length) {
  const detail = [
    missing.length ? `${missing.length} merged market(s) not being served` : '',
    extra.length ? `${extra.length} served market(s) not in git` : '',
  ]
    .filter(Boolean)
    .join('; ');
  fail(`${detail}. Served ${have.size}, git has ${want.size}. Publish is stale or diverged.`);
}

console.log(`published dataset OK: ${have.size} markets, matching data/markets.json`);
}

main();
