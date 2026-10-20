import { z } from 'zod';

import { DAY } from '@/lib/market-schema';

type Weekday = z.infer<typeof DAY>;

/**
 * What time it is **where the market is**.
 *
 * `isOpenNow` used to read the device clock, and a market's `schedule` means local time at the
 * market — so the two agreed only while the reader stood in the same timezone as the thing
 * they were looking at. That was never quite true (California reading a Maryland market is
 * three hours out) and stopped being nearly true when the dataset crossed an ocean: at 10:00
 * in Manchester a Maryland market listing 09:00–13:00 reported itself open while it was 05:00
 * there and the stalls were not up.
 *
 * **`Intl` does the work, and it is available.** Verified on Hermes in the iOS simulator
 * before this was designed: formatting 15:00 UTC gives `11:00` for `America/New_York` and
 * `16:00` for `Europe/London` — the offsets *and* the daylight-saving rules, with no library.
 * That is the whole reason the dataset stores an IANA name rather than a UTC offset: an offset
 * is one day's answer, and would read an hour wrong for eight months of the year, quietly.
 *
 * `hourCycle: 'h23'` rather than `hour12: false`, which is specified to produce `24` for
 * midnight in some implementations — an hour that does not exist and sorts after everything.
 */
export interface MarketClock {
  /** The market's own weekday, which is not always the reader's. */
  day: Weekday;
  /** Minutes since midnight, at the market. */
  minutes: number;
  /** `MM-DD` at the market, for the season comparison. */
  monthDay: string;
}

const DAY_BY_NAME: Record<string, Weekday> = {
  Sun: 'sun',
  Mon: 'mon',
  Tue: 'tue',
  Wed: 'wed',
  Thu: 'thu',
  Fri: 'fri',
  Sat: 'sat',
};

/**
 * The reader's own zone, for a market that has none recorded.
 *
 * Only reachable for a record written before the field existed, which CI now refuses — but a
 * dataset refetched from a CDN can be older than the app reading it, and the honest fallback
 * for "I do not know where this is" is the old behaviour rather than a crash or a guess.
 */
export function deviceTimezone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  } catch {
    return 'UTC';
  }
}

export function marketClock(timezone: string | null | undefined, now: Date): MarketClock {
  const zone = timezone || deviceTimezone();
  let parts: Intl.DateTimeFormatPart[];
  try {
    parts = new Intl.DateTimeFormat('en-US', {
      timeZone: zone,
      weekday: 'short',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    }).formatToParts(now);
  } catch {
    // An unknown zone reaching a running app is a record the validator should have caught.
    // Falling back to the device keeps the list usable instead of throwing inside a render.
    parts = new Intl.DateTimeFormat('en-US', {
      weekday: 'short',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    }).formatToParts(now);
  }

  const at = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((p) => p.type === type)?.value ?? '';

  return {
    day: DAY_BY_NAME[at('weekday')] ?? 'sun',
    minutes: Number(at('hour')) * 60 + Number(at('minute')),
    monthDay: `${at('month')}-${at('day')}`,
  };
}

/** Whether a zone is one this runtime can actually format in — which is what using it needs. */
export function isUsableTimezone(zone: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: zone });
    return true;
  } catch {
    return false;
  }
}
