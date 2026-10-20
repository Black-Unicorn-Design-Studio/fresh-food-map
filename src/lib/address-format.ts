/**
 * Tidying an address somebody typed.
 *
 * The dataset's convention is `<street>, <city>, <ST> <zip>` — what
 * `composeAddress()` in `geocode.ts` produces from Nominatim's components, and what
 * 48 of 61 rows already look like. The other 13 arrived by hand or from a source
 * that carried less, and the drift is the kind that makes a dataset read as
 * unmaintained to exactly the agencies this project wants to be trusted by.
 *
 * **It is best-effort and never refuses.** That is the difference from
 * `parseTimeInput`, which returns `null` for input with no reading: a time either
 * parses or it does not, but an address is free text, and rejecting one would block
 * a submission over formatting. So this improves what it can recognise and returns
 * the rest untouched. A missing city cannot be invented, and nothing here tries.
 *
 * What it does:
 *
 * | typed | becomes | why |
 * | --- | --- | --- |
 * | `Morrow, GA, 30260` | `Morrow, GA 30260` | the zip is not a separate field |
 * | `Atlanta, Georgia, 30306` | `Atlanta, GA 30306` | the dataset abbreviates states |
 * | `12610 old gunpowder rd` | `12610 Old Gunpowder Rd` | only when the whole string is lowercase |
 * | `  two   spaces ` | `two spaces` | collapse and trim |
 *
 * **Case is only touched when the whole string is lowercase**, which is the signature
 * of fast typing rather than of a considered spelling. Anything with existing capitals
 * is left exactly alone, so `LaFayette`, `McDonald`, `O'Brien` and `DeKalb` survive —
 * a title-caser that lowercased those would be doing damage in the name of tidiness.
 */

/** Full state and territory names to the postal abbreviations the dataset uses. */
const STATES: Record<string, string> = {
  alabama: 'AL', alaska: 'AK', arizona: 'AZ', arkansas: 'AR', california: 'CA',
  colorado: 'CO', connecticut: 'CT', delaware: 'DE', florida: 'FL', georgia: 'GA',
  hawaii: 'HI', idaho: 'ID', illinois: 'IL', indiana: 'IN', iowa: 'IA', kansas: 'KS',
  kentucky: 'KY', louisiana: 'LA', maine: 'ME', maryland: 'MD', massachusetts: 'MA',
  michigan: 'MI', minnesota: 'MN', mississippi: 'MS', missouri: 'MO', montana: 'MT',
  nebraska: 'NE', nevada: 'NV', 'new hampshire': 'NH', 'new jersey': 'NJ',
  'new mexico': 'NM', 'new york': 'NY', 'north carolina': 'NC', 'north dakota': 'ND',
  ohio: 'OH', oklahoma: 'OK', oregon: 'OR', pennsylvania: 'PA', 'rhode island': 'RI',
  'south carolina': 'SC', 'south dakota': 'SD', tennessee: 'TN', texas: 'TX',
  utah: 'UT', vermont: 'VT', virginia: 'VA', washington: 'WA', 'west virginia': 'WV',
  wisconsin: 'WI', wyoming: 'WY', 'district of columbia': 'DC', 'puerto rico': 'PR',
};

/**
 * Words that stay lowercase inside a title-cased address, and abbreviations that
 * stay upper. Short and conventional rather than exhaustive: a longer list would
 * start making decisions about names.
 */
const MINOR = new Set(['of', 'the', 'and', 'at', 'on', 'in', 'by']);

/**
 * The valid postal codes, derived from the table above so the two cannot drift.
 *
 * Membership is checked rather than "any two letters", and that is load-bearing: a
 * trailing `St` in `123 Main St` is two letters and is not a state, and an earlier
 * draft of this file uppercased it to `ST`. Only a real code is treated as one.
 */
const STATE_CODES = new Set(Object.values(STATES));
const UPPER = new Set(['ne', 'nw', 'se', 'sw', 'us', 'md', 'sr', 'ii', 'iii', 'iv']);

function titleCaseWord(w: string, index: number): string {
  const bare = w.replace(/[^a-z]/g, '');
  if (index > 0 && MINOR.has(bare)) return w;
  if (UPPER.has(bare)) return w.toUpperCase();
  // Hyphens and slashes each start a new word: `east-west` -> `East-West`.
  return w.replace(/[a-z]+/g, (part, at) => {
    if (at > 0 && MINOR.has(part)) return part;
    return part.charAt(0).toUpperCase() + part.slice(1);
  });
}

/** Returns a tidied address. Never returns null; `''` maps to `''`. */
export function normalizeAddress(raw: string): string {
  let text = raw.replace(/\s+/g, ' ').trim();
  if (text === '') return '';

  // Only when nothing is capitalised — see the note above on why.
  if (text === text.toLowerCase()) {
    text = text
      .split(' ')
      .map((w, i) => titleCaseWord(w, i))
      .join(' ');
  }

  // A spelled-out state, but only where a state belongs: last segment, or the
  // segment before a trailing zip. `Georgia Avenue` in a street must survive.
  const zip = /\b(\d{5})(-\d{4})?\s*$/.exec(text);
  const tail = zip ? text.slice(0, zip.index) : text;
  const rest = zip ? zip[0].trim() : '';

  const parts = tail.split(',').map((p) => p.trim()).filter(Boolean);
  let endsWithState = false;
  if (parts.length > 0) {
    const lastIdx = parts.length - 1;
    const last = parts[lastIdx];
    const whole = last.toLowerCase();

    if (STATES[whole]) {
      // The segment is a spelled-out state: `Georgia` -> `GA`.
      parts[lastIdx] = STATES[whole];
      endsWithState = true;
    } else if (STATE_CODES.has(last.toUpperCase()) && /^[A-Za-z]{2}$/.test(last)) {
      // The segment is already a code, possibly lowercased by fast typing.
      parts[lastIdx] = last.toUpperCase();
      endsWithState = true;
    } else {
      // No commas around it: the state trails the last segment, as in
      // `12610 Old Gunpowder Rd MD`. Only a real code counts — see STATE_CODES.
      const trailing = /\s([A-Za-z]{2})$/.exec(last);
      if (trailing && STATE_CODES.has(trailing[1].toUpperCase())) {
        parts[lastIdx] = last.slice(0, trailing.index) + ' ' + trailing[1].toUpperCase();
        endsWithState = true;
      }
    }
  }

  if (!rest) return ukPostcodeCased(parts.join(', '));
  // The zip joins a STATE with a space — `, MD 20866`, never `, MD, 20866`. With no
  // state it keeps its comma: `Ellicott City, 21042`, because `Ellicott City 21042`
  // reads as a street number. Dropping that comma was a real bug the tests caught.
  return ukPostcodeCased(
    endsWithState ? `${parts.join(', ')} ${rest}` : `${parts.join(', ')}, ${rest}`,
  );
}

/**
 * A British postcode is uppercase, both halves of it.
 *
 * The title-caser above runs on a wholly lowercase string — which is exactly what fast typing
 * on a phone produces — and it mangles every one of them. Measured before this existed:
 * `se1 1tl` became `SE1 1Tl`, `ba1 1lz` became `Ba1 1Lz`, `m6 5ja` became `M6 5Ja`. The
 * outward half sometimes survived by accident, because `se`, `nw` and `sw` are in the US
 * street-quadrant set; the inward half never did, and `ba` and `m` are in no set at all.
 *
 * A post-pass rather than another branch in the caser, because a postcode is the one token
 * here whose casing is a property of the *whole* token and not of its letters: `SE1 1TL` is
 * not two words that happen to be capitalised.
 *
 * The pattern is the real grammar — one or two letters, a digit, an optional letter or digit,
 * then a digit and two letters — anchored to the end so it cannot fire mid-address. It cannot
 * collide with an American address: `MD 20866` and `CA 90210` put a space where this wants a
 * digit, so neither matches.
 */
function ukPostcodeCased(address: string): string {
  return address.replace(/\b([A-Za-z]{1,2}\d[A-Za-z\d]?)\s*(\d[A-Za-z]{2})$/, (_m, out, inward) =>
    `${String(out).toUpperCase()} ${String(inward).toUpperCase()}`,
  );
}
