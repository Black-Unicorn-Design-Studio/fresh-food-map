/**
 * Validates data/markets.json against the contract in docs/trd.md §2.
 * Run: npx tsx scripts/validate-data.ts   (CI runs this on every PR touching data/)
 * Exits non-zero on any violation so bad data cannot merge.
 */
import { readFileSync } from "node:fs";
import { z } from "zod";

// One schema, three consumers: this, the intake service, and the batching
// agent. See src/lib/market-schema.ts for why that matters.
import { MarketCollection, seasonIsCoherent } from "../src/lib/market-schema";

function haversineMeters(a: [number, number], b: [number, number]): number {
  const R = 6371000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b[1] - a[1]);
  const dLon = toRad(b[0] - a[0]);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a[1])) * Math.cos(toRad(b[1])) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

const path = new URL("../data/markets.json", import.meta.url).pathname;
const raw = JSON.parse(readFileSync(path, "utf8"));
const parsed = MarketCollection.safeParse(raw);

const errors: string[] = [];

if (!parsed.success) {
  for (const issue of parsed.error.issues) {
    errors.push(`${issue.path.join(".")}: ${issue.message}`);
  }
} else {
  const features = parsed.data.features;

  const ids = new Map<string, number>();
  features.forEach((f, i) => {
    const prev = ids.get(f.properties.id);
    if (prev !== undefined) errors.push(`duplicate id at features[${prev}] and features[${i}]: ${f.properties.id}`);
    ids.set(f.properties.id, i);
  });

  // Same name within ~100m is almost certainly the same market twice.
  for (let i = 0; i < features.length; i++) {
    for (let j = i + 1; j < features.length; j++) {
      const a = features[i], b = features[j];
      if (
        a.properties.name.toLowerCase() === b.properties.name.toLowerCase() &&
        haversineMeters(a.geometry.coordinates, b.geometry.coordinates) < 100
      ) {
        errors.push(`likely duplicate market: features[${i}] and features[${j}] ("${a.properties.name}")`);
      }
    }
  }

  for (const [i, f] of features.entries()) {
    const { season_start, season_end } = f.properties;
    if (!seasonIsCoherent({ season_start, season_end })) {
      errors.push(`features[${i}]: season_start and season_end must both be set or both null`);
    }
  }
}

if (errors.length > 0) {
  console.error(`markets.json: ${errors.length} problem(s)\n`);
  for (const e of errors) console.error(`  ✗ ${e}`);
  process.exit(1);
}

const all = (raw.features ?? []) as unknown[];
console.log(`markets.json: OK (${all.length} markets)`);
