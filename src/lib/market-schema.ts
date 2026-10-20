/**
 * The market record contract, in one place.
 *
 * Three things validate market data and they must agree: CI
 * (`scripts/validate-data.ts`), the intake service that accepts public
 * submissions, and the batching agent that writes accepted ones into a pull
 * request. Two copies of a schema is two schemas — the moment one gains a
 * field the other rejects it, and the failure shows up as a submission that
 * passes intake and then fails CI, which is the worst place to find it.
 *
 * Only zod and the tag vocabulary are imported here, deliberately: this module
 * is loaded by a Node server that must not pull React Native in behind it.
 */
import { z } from 'zod';

import { COUNTRIES } from '@/constants/countries';
import { MARKET_TAGS } from '@/constants/tags';

export const DAY = z.enum(['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun']);
export const HHMM = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Times look like 08:30');
export const MMDD = z
  .string()
  .regex(/^(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/, 'Season dates look like 04-01');

export const ScheduleEntry = z.object({ day: DAY, open: HHMM, close: HHMM });

/**
 * A timezone this runtime can actually format in, which is the property that matters: if
 * `Intl.DateTimeFormat` accepts the name, `isOpenNow` can compute the market's own clock from
 * it, and if it does not, no amount of it looking well-formed helps.
 *
 * Validating by construction rather than against a compiled-in list of names. The IANA
 * database changes — zones are added, renamed and merged — and a list in this repo would be a
 * second copy going stale against the one the platform already has.
 */
const TIMEZONE = z.string().min(1).max(64).refine(
  (zone) => {
    try {
      new Intl.DateTimeFormat('en-US', { timeZone: zone });
      return true;
    } catch {
      return false;
    }
  },
  { message: 'Not a timezone this runtime recognises — use an IANA name like Europe/London' },
);



/** Everything a published feature carries. */
// strictObject, not object: plain `z.object` strips unknown keys silently, so a leftover
// `verified` in a future data pull request — or one re-added by an unpatched writer — would
// merge unnoticed and nothing would ever catch it again. The cost is that a
// forward-compatible extra key now fails CI loudly, which is the right direction here.
export const MarketProperties = z.strictObject({
  id: z.string().uuid(),
  name: z.string().min(3).max(120),
  address: z.string().min(5).max(200),
  schedule: z.array(ScheduleEntry).max(14),
  season_start: MMDD.nullable(),
  season_end: MMDD.nullable(),
  website: z.string().url().startsWith('https://').nullable(),
  source: z.enum(['usda', 'osm', 'state_portal', 'city_portal', 'community', 'manual']),
  tags: z.array(z.enum(MARKET_TAGS)).max(MARKET_TAGS.length),
  source_ref: z.string().nullable(),
  active: z.boolean(),
  /**
   * Which country's conventions this record is written in — **not** decoration, and not
   * derivable from the address string it sits beside.
   *
   * `address` is a single line, and the shape of that line differs by country: the US writes
   * `<street>, <city>, <ST> <zip>` and the UK writes a post town and a postcode joined by a
   * space with no state at all. Anything reading an address back — the card overline that
   * takes a town by comma position, the normaliser that uppercases a postcode, the composer
   * that decides whether a subdivision belongs in it — has to know which grammar it is holding
   * before it can parse it, and guessing from the string is how you decide that `Bath, BA1`
   * contains a US state code.
   *
   * A closed enum rather than a free two-letter field, for the reason in
   * `src/constants/countries.ts`: a code is a promise the app can render the record correctly,
   * so CI refusing an unknown one is the feature.
   */
  country: z.enum(COUNTRIES),
  /**
   * Where this market's `schedule` is in local time — an IANA name, not an offset.
   *
   * `schedule` says `09:00` and means nine in the morning *at the market*. Without this the
   * only clock available was the reader's, so `isOpenNow` was right only while they stood in
   * the same zone as the thing they were looking at. That was never exactly true — California
   * reading a Maryland market is three hours out — and stopped being nearly true when the
   * dataset crossed an ocean.
   *
   * **A name and not an offset**, because an offset is one day's answer: `-05:00` reads an
   * hour wrong for the eight months of the year that New York is on daylight time, and reads
   * wrong *quietly*, which is worse than being consistently wrong.
   */
  timezone: TIMEZONE,
});

export const MarketFeature = z.object({
  type: z.literal('Feature'),
  geometry: z.object({
    type: z.literal('Point'),
    coordinates: z.tuple([z.number().min(-180).max(180), z.number().min(-90).max(90)]),
  }),
  properties: MarketProperties,
});

export const MarketCollection = z.object({
  type: z.literal('FeatureCollection'),
  name: z.string(),
  features: z.array(MarketFeature),
});

/**
 * What a member of the public may send. Deliberately NOT the feature schema:
 * a submitter supplies facts about a market, never its provenance. `id`,
 * `source`, `source_ref` and `active` are the service's to assign — accepting
 * `source` from the wire would let anyone label their own submission as coming
 * from a state portal, which is a false attribution in an ODbL dataset.
 */
export const Submission = z.object({
  name: z.string().min(3).max(120),
  address: z.string().min(5).max(200),
  lat: z.number().min(-90).max(90),
  lon: z.number().min(-180).max(180),
  schedule: z.array(ScheduleEntry).max(14).default([]),
  season_start: MMDD.nullable().default(null),
  season_end: MMDD.nullable().default(null),
  website: z.string().url().startsWith('https://').max(200).nullable().default(null),
  tags: z.array(z.enum(MARKET_TAGS)).max(MARKET_TAGS.length).default([]),
  /**
   * Where the submitter is, which is a fact about the market rather than provenance — so it
   * belongs here where `source` does not. It decides how the address is read, and the person
   * filling the form is standing in the place and has the app's own country setting to hand.
   *
   * Required rather than defaulted: a default of `US` would silently relabel every British
   * submission from a client that had not been updated, and a wrong country is quieter than a
   * missing one. A missing one is a `422` naming the field, which is what this service already
   * promises for a payload that misses the schema.
   */
  country: z.enum(COUNTRIES),
  /**
   * The submitter's own timezone, which is the market's: they are standing in it. Free and
   * exact, where the alternative is the service inferring one from coordinates — a lookup on
   * the one path that is deliberately mechanical and offline.
   */
  timezone: TIMEZONE,
  /** Context for whoever reviews the pull request. Never published. */
  note: z.string().max(500).nullable().default(null),
});

export type SubmissionInput = z.infer<typeof Submission>;

/** Both season fields or neither — the same rule CI enforces on the dataset. */
export function seasonIsCoherent(s: { season_start: string | null; season_end: string | null }) {
  return (s.season_start === null) === (s.season_end === null);
}
