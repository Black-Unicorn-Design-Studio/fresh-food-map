/**
 * Reading a time somebody typed.
 *
 * The schema takes `HH:MM` on a 24-hour clock (`HHMM` in `market-schema.ts`) and the form
 * used to demand it literally: type `7` under "Saturday opens" and you got "Times look like
 * 08:30" for a value whose meaning nobody could mistake. That is a machine asking a person to
 * do the machine's job, on the one form in the app whose whole virtue is that it asks for
 * little.
 *
 * So the field accepts what people write and normalises it here, and an error is left for
 * input that has no sensible reading at all. **The guess is never silent** — the field rewrites
 * itself to the normalised value as soon as it loses focus, so `7` visibly becomes `07:00`
 * before anybody submits. That is the same argument `geocode.ts` makes about a found address:
 * a value the app inferred has to be shown, because a wrong guess that nobody saw rides into a
 * pull request looking exactly like a right one.
 *
 * What it reads:
 *
 * | typed | means | why |
 * | --- | --- | --- |
 * | `7` | `07:00` | a bare hour is an hour on the 24-hour clock |
 * | `19` | `19:00` | so this needs no meridiem to say evening |
 * | `7pm`, `7 p.m.`, `7PM` | `19:00` | meridiem wins over the bare reading |
 * | `730`, `7:30` | `07:30` | three digits are `h:mm` |
 * | `1930`, `19:30` | `19:30` | four are `hh:mm` |
 * | `12am` / `12pm` | `00:00` / `12:00` | the two everyone gets wrong |
 * | `noon` / `midnight` | `12:00` / `00:00` | written more often than they look |
 *
 * And what it refuses, because no reading is available rather than because the format is
 * unfamiliar: `25`, `7:99`, `13pm` (a meridiem hour runs 1–12), `0pm`, `abc`, empty.
 *
 * **Empty is not an error and never was.** `scheduleFor()` drops any pair missing either half,
 * so a blank time means "no hours given", which is a thing a market is allowed to be — absent
 * hours are unknown hours, and `isOpenNow()` already treats them as never open rather than
 * guessing. Returning `null` for `''` would put an error under an untouched field.
 */

/** `HH:MM`, or `null` when the input has no sensible reading. `''` maps to `''`. */
export function parseTimeInput(raw: string): string | null {
  const text = raw.trim().toLowerCase();
  if (text === '') return '';

  if (text === 'noon' || text === 'midday') return '12:00';
  if (text === 'midnight') return '00:00';

  // `7 p.m.` and `7pm` are the same intent typed two ways, and the dots and spaces carry
  // nothing. Stripped before anything is measured so the digit rules below see one shape.
  const compact = text.replace(/[\s.]/g, '');

  const meridiem = /(am|pm)$/.exec(compact)?.[1] as 'am' | 'pm' | undefined;
  const digits = meridiem ? compact.slice(0, -2) : compact;

  // A colon is the one separator worth honouring: it tells us where the hour ends, which is
  // the only ambiguity `730` leaves. Anything else between the numbers is a typo we cannot
  // read, not a format we should learn.
  const parts = /^(\d{1,2}):(\d{2})$/.exec(digits);
  let hour: number;
  let minute: number;

  if (parts) {
    hour = Number(parts[1]);
    minute = Number(parts[2]);
  } else if (/^\d{1,2}$/.test(digits)) {
    hour = Number(digits);
    minute = 0;
  } else if (/^\d{3}$/.test(digits)) {
    // `730` is half past seven. Reading it as 73:0 is the only alternative and is not a time.
    hour = Number(digits.slice(0, 1));
    minute = Number(digits.slice(1));
  } else if (/^\d{4}$/.test(digits)) {
    hour = Number(digits.slice(0, 2));
    minute = Number(digits.slice(2));
  } else {
    return null;
  }

  if (!Number.isInteger(hour) || !Number.isInteger(minute)) return null;
  if (minute > 59) return null;

  if (meridiem) {
    // A meridiem hour is 1–12 and nothing else. `13pm` is not a time somebody meant in a way
    // we can recover, and `0pm` is not one either — guessing at those is how a form invents a
    // value its own CI would then reject.
    if (hour < 1 || hour > 12) return null;
    if (meridiem === 'am') hour = hour === 12 ? 0 : hour;
    else hour = hour === 12 ? 12 : hour + 12;
  } else if (hour > 23) {
    return null;
  }

  return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
}
