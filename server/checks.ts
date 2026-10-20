import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import type { IntakeConfig } from './config';
import type { SubmissionInput } from '@/lib/market-schema';

/**
 * Mechanical checks only. Nothing here is a judgement about whether a market is
 * worth listing — that decision belongs to a human on a pull request, not to a
 * server (docs/trd.md §4).
 *
 * Two outcomes, and the asymmetry between them is the whole design:
 *
 *   hard  — dropped, and left no record of: never queued, never logged, never counted.
 *           Essentially never a false positive, because nothing can review one.
 *   soft  — reaches the pull request, flagged with the reason.
 *
 * A wrong soft hold costs a reviewer ten seconds. A wrong hard fail is a silent
 * deletion nobody ever sees, which is why the hard list is short and boring.
 */
export type Verdict =
  | { kind: 'hard'; reason: string }
  | { kind: 'accept'; flags: string[] };

function haversineM(a: [number, number], b: [number, number]): number {
  const R = 6371000;
  const rad = (d: number) => (d * Math.PI) / 180;
  const dLat = rad(b[1] - a[1]);
  const dLon = rad(b[0] - a[0]);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(rad(a[1])) * Math.cos(rad(b[1])) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

let cachedDataset: { name: string; coords: [number, number] }[] | null = null;
function dataset(): { name: string; coords: [number, number] }[] {
  if (cachedDataset) return cachedDataset;
  const raw = JSON.parse(readFileSync(resolve(process.cwd(), 'data/markets.json'), 'utf8'));
  cachedDataset = (raw.features ?? []).map((f: any) => ({
    name: String(f.properties.name).toLowerCase(),
    coords: f.geometry.coordinates as [number, number],
  }));
  return cachedDataset!;
}

export function judge(
  input: SubmissionInput,
  meta: { honeypot: string | null; elapsedSeconds: number | null },
  config: IntakeConfig
): Verdict {
  // --- hard: a bot filled a field no human can see
  if (meta.honeypot) return { kind: 'hard', reason: 'honeypot' };

  // --- hard: nobody reads and completes this form in under two seconds
  if (meta.elapsedSeconds !== null && meta.elapsedSeconds < config.min_seconds_to_submit) {
    return { kind: 'hard', reason: 'too_fast' };
  }

  // --- hard: the dataset already rejects same-name-within-100m at merge time,
  // so accepting one here would only fail CI on a PR the submitter cannot fix.
  const here: [number, number] = [input.lon, input.lat];
  const name = input.name.toLowerCase();
  for (const existing of dataset()) {
    if (existing.name === name && haversineM(here, existing.coords) < config.dedupe.radius_m) {
      return { kind: 'hard', reason: 'already_listed' };
    }
  }

  // --- soft: worth a reviewer's eye, never worth discarding over
  const flags: string[] = [];
  if (!input.website) flags.push('no_website');
  if (input.schedule.length === 0) flags.push('no_schedule');
  for (const existing of dataset()) {
    if (haversineM(here, existing.coords) < config.dedupe.radius_m && existing.name !== name) {
      flags.push('near_duplicate');
      break;
    }
  }
  return { kind: 'accept', flags: flags.filter((f) => config.flag_for_review.includes(f)) };
}
