import { type CountryCode } from '@/constants/countries';
import { MARKET_TAGS, type MarketTag } from '@/constants/tags';
import { DAY } from '@/lib/market-schema';
import type { ScheduleEntry } from '@/lib/markets';

/**
 * Where the intake service lives. Unset means the Submit tab tells people to
 * open a pull request instead, which is always a valid route and needs nothing
 * running — so a fresh checkout with no configuration still behaves honestly
 * rather than showing a form that cannot work.
 */
export const INTAKE_URL = process.env.EXPO_PUBLIC_INTAKE_URL ?? null;

export type Weekday = ScheduleEntry['day'];

export interface SubmitForm {
  name: string;
  address: string;
  lat: string;
  lon: string;
  website: string;
  days: MarketTag[] | string[];
  /** The shared pair. Every selected day takes these unless `perDayHours` says otherwise. */
  open: string;
  close: string;
  /**
   * Whether the form is in per-day mode. Off is the common case and the default: most
   * markets trade the same hours every day they trade, and asking those people for a time
   * pair per day would be the form charging everyone for the minority case.
   */
  perDayHours: boolean;
  /**
   * Overrides, by day, used only while `perDayHours` is on. Sparse on purpose — a day with
   * no entry falls back to the shared pair, so turning the mode on and changing one day
   * leaves the rest alone.
   */
  dayHours: Partial<Record<Weekday, { open: string; close: string }>>;
  tags: MarketTag[];
  note: string;
}

/** The pair a given day actually submits: its own override, or the shared one. */
export function hoursFor(form: SubmitForm, day: Weekday): { open: string; close: string } {
  const per = form.perDayHours ? form.dayHours[day] : undefined;
  return { open: per?.open ?? form.open, close: per?.close ?? form.close };
}

/** Monday-first, straight off the schema's own enum rather than a second list to drift. */
const WEEK_ORDER: readonly Weekday[] = DAY.options;

/**
 * The schedule the payload will carry, in the order the wire will see it.
 *
 * **Week order, not tap order.** The days are normalised so that two people submitting the
 * same market produce byte-identical JSON however they tapped the chips — a pull request
 * diff should show a real difference or nothing at all, and "Wednesday moved above
 * Saturday" is neither. It also matches what the form draws and what `WeekStrip` will draw
 * on the card, so nobody checks their own work against a different sequence than the one
 * they are shown. `ScheduleEntry` imposes no order, so this is ours to pick; picking one is
 * the point.
 *
 * Exported because the error mapping below needs exactly this order: a message about
 * `schedule.2.open` has to find the input that produced entry 2, and only this function
 * knows which day that was.
 *
 * A day whose pair is incomplete is dropped rather than sent half-filled — hours are
 * optional, so "Saturday, no times" is a market a reviewer can still finish, while
 * `{ day: 'sat', open: '08:00', close: '' }` is a validation failure for no reason. Note
 * that dropping happens before indexing, so the index counts entries actually sent.
 */
export function scheduleFor(form: SubmitForm): ScheduleEntry[] {
  const picked = new Set(form.days as Weekday[]);
  return WEEK_ORDER.filter((day) => picked.has(day))
    .map((day) => ({ day, ...hoursFor(form, day) }))
    .filter((e) => e.open !== '' && e.close !== '');
}

/**
 * Which form fields actually render an error. `field()` is the only thing that shows one,
 * so a message routed anywhere else is a message nobody sees — the day chips and the tag
 * chips have no error slot at all.
 */
const FIELDS_WITH_ERROR_SLOTS = [
  'name',
  'address',
  'lat',
  'lon',
  'open',
  'close',
  'website',
  'note',
] as const;

/**
 * Maps a validation path from the wire back to a form field.
 *
 * The form is not shaped like the payload: one open/close pair is expanded into a schedule
 * entry per selected day, so a malformed time comes back as `schedule.0.open` — a key no
 * field owns. Those messages were dropped silently, for everyone.
 *
 * This belongs here rather than in the service: this module builds the schedule, so it owns
 * the reverse translation, and the service validates a *submission* without having to know
 * what any particular form looks like.
 *
 * Returns null when nothing can display it, which the caller then puts in the message —
 * never nowhere.
 */
function toFormField(path: string, form: SubmitForm): string | null {
  if (!path.startsWith('schedule.')) {
    return FIELDS_WITH_ERROR_SLOTS.find((f) => f === path) ?? null;
  }
  const [, index, key] = path.split('.');
  if (key !== 'open' && key !== 'close') return null;
  // In shared mode every entry came from the one pair, so the one pair is where the message
  // belongs. In per-day mode it has to land on the day that produced it, or somebody reads
  // "looks like 08:00" under Saturday while Wednesday is the broken one.
  if (!form.perDayHours) return key;
  const day = scheduleFor(form)[Number(index)]?.day;
  return day ? `${key}_${day}` : key;
}

export type SubmitResult =
  | { ok: true }
  | { ok: false; message: string; fields?: Record<string, string> };

/**
 * Posts a submission. The two anti-spam signals the service expects are
 * supplied here rather than by the caller: `website_url` is a honeypot that
 * must stay empty, and `elapsed_seconds` is how long the form was open. Both
 * are cheap, need no third party, and add no tracking — which matters given
 * the project's no-trackers rule.
 */
export async function submitMarket(
  form: SubmitForm,
  meta: { honeypot: string; openedAt: number; country: CountryCode; timezone: string }
): Promise<SubmitResult> {
  if (!INTAKE_URL) {
    return { ok: false, message: 'No intake service is configured for this build.' };
  }

  const schedule = scheduleFor(form);

  const body = {
    website_url: meta.honeypot,
    elapsed_seconds: (Date.now() - meta.openedAt) / 1000,
    market: {
      name: form.name.trim(),
      address: form.address.trim(),
      lat: Number(form.lat),
      lon: Number(form.lon),
      website: form.website.trim() === '' ? null : form.website.trim(),
      schedule,
      tags: form.tags.filter((t) => (MARKET_TAGS as readonly string[]).includes(t)),
      // Context rather than a field: nobody typed it, and it travels with the honeypot and the
      // timing for the same reason — it describes the submission, not the market's opening
      // hours. The service needs it to know which grammar the address line is written in.
      country: meta.country,
      // The submitter's own zone, which is the market's: they are standing in it. This is what
      // lets `isOpenNow` answer for a market in a timezone the reader is not in.
      timezone: meta.timezone,
      note: form.note.trim() === '' ? null : form.note.trim(),
    },
  };

  let res: Response;
  try {
    res = await fetch(`${INTAKE_URL.replace(/\/$/, '')}/submit`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
  } catch {
    return { ok: false, message: "Couldn't reach the submission service. Try again shortly." };
  }

  if (res.status === 202) return { ok: true };

  if (res.status === 429) {
    return {
      ok: false,
      message:
        'That is a lot of submissions from one connection. Try again later, or open a pull request against data/markets.json.',
    };
  }

  if (res.status === 422) {
    const body = (await res.json().catch(() => null)) as {
      issues?: { path: string; message: string }[];
    } | null;
    const fields: Record<string, string> = {};
    const unplaceable: string[] = [];
    for (const i of body?.issues ?? []) {
      const key = toFormField(i.path, form);
      if (key) fields[key] = i.message;
      else unplaceable.push(i.message);
    }
    return {
      ok: false,
      // An issue with no field to sit beside still gets said. Dropping it leaves someone
      // staring at a form that refuses them without saying why — the same class of failure
      // as a submission rejected in silence.
      message: unplaceable.length
        ? `Some details need fixing. ${unplaceable.join(' ')}`
        : 'Some details need fixing.',
      fields,
    };
  }

  return { ok: false, message: `The service returned an unexpected error (${res.status}).` };
}
