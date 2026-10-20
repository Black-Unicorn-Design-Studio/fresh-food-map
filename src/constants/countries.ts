/**
 * The countries this app knows how to be correct in.
 *
 * **A closed vocabulary, like the tags**, and for the same reason: a country here is not a
 * label on a record, it is a promise that the app can format an address, pick a unit, choose a
 * sensible map centre, name the parts of an address out loud, and decide which filters mean
 * anything. `GB` cost a rewrite of the
 * importer's address gate and will cost more in the composer; a code nobody has done that work
 * for would be a record the app renders wrongly rather than a record it cannot render at all,
 * which is the worse of the two failures because nothing announces it.
 *
 * So adding a country is a pull request that arrives with the work already done, and CI
 * rejects any other code outright (`src/lib/market-schema.ts`).
 *
 * ISO 3166-1 alpha-2, uppercase — the same standard the geocoder's `countrycodes` speaks,
 * lowercased at that boundary rather than stored twice in two cases.
 */
export const COUNTRIES = ['US', 'GB', 'JM'] as const;

export type CountryCode = (typeof COUNTRIES)[number];

/**
 * Which unit distances are shown in.
 *
 * Per country and not per reader, for now. Britain is genuinely mixed — road signs are miles,
 * everything else is metric — so this is a judgement rather than a fact, and the judgement is
 * that a market is a place you walk or drive to within a town, which is the metric half of
 * British life. If that turns out wrong it becomes a third setting rather than a different
 * guess, because there is no answer here that is correct for everybody.
 *
 * Jamaica needs no such argument: it went metric in the 1970s and its road signs followed in
 * 2018, so `km` is the fact there rather than the judgement it is for Britain.
 */
export const COUNTRY_UNITS: Record<CountryCode, 'mi' | 'km'> = {
  US: 'mi',
  GB: 'km',
  JM: 'km',
};

export type DistanceUnit = (typeof COUNTRY_UNITS)[CountryCode];

/**
 * What this country calls the postal part of an address — and `null` where there isn't one.
 *
 * The search box asks for "a town, address or ___", and the blank was filled with `zipcode`,
 * which is right in exactly one of the three countries the app supports. A Briton reads it as
 * the app not knowing where they are; a Jamaican reads it as the app asking for a thing their
 * country abolished. Neither is a formatting slip — it is the app telling somebody it was
 * built for somewhere else, in the first control they touch.
 *
 * **`null` is a real answer here and not a gap.** Jamaica discontinued postal codes outright,
 * so there is no word to supply and the sentence has to lose the clause rather than name
 * something that does not exist. That is why this is `string | null` rather than a string with
 * an awkward default: a missing postcode system is a fact about the country, and the type is
 * what makes a caller deal with it instead of printing "or ".
 *
 * Only what a reader is *asked to type* belongs here. The composed output of a lookup is a
 * different question, answered by the composers in `src/lib/geocode.ts`.
 */
export const POSTAL_CODE_LABELS: Record<CountryCode, string | null> = {
  US: 'ZIP code',
  GB: 'postcode',
  JM: null,
};

/** What each one is called, for the settings panel. The app's own name for the place. */
export const COUNTRY_LABELS: Record<CountryCode, string> = {
  US: 'United States',
  GB: 'United Kingdom',
  JM: 'Jamaica',
};

/**
 * The fallback when the device says somewhere this app has not been taught.
 *
 * `US` rather than "unknown": most of the dataset is American, so it is the answer that is
 * right most often, and a reader it is wrong for is one press from changing it. It was once
 * "every record in the dataset is American", which stopped being true the moment Manchester
 * landed — the fallback survives the correction because "most often right" is all it ever
 * needed to be, but the reason had to stop claiming more than it could.
 * A nullable country would push that same guess into every call site instead, each free to
 * make it differently.
 */
export const DEFAULT_COUNTRY: CountryCode = 'US';

/**
 * An example listing, for the submit form's placeholders.
 *
 * Every one of these was a San Francisco literal typed into `submit.tsx` — the Ferry Plaza
 * market, its address, and its latitude and longitude. That is a fine example in the United
 * States and a confusing one anywhere else: a reader in Manchester was being shown
 * `1 Ferry Building, San Francisco, CA` as the model for what to type, which demonstrates a
 * grammar their address does not have (a state code) and omits the one it does (a postcode
 * after the town). A placeholder's whole job is to show the shape of the expected answer, so
 * one from the wrong country teaches the wrong shape.
 *
 * **They are real places with checked coordinates**, not plausible-looking inventions. The
 * British pair is the fixture `test/geocode.test.ts` already pins; the Jamaican one is a
 * reverse lookup measured against live Nominatim while the composer was being written.
 *
 * Jamaica's address deliberately shows no parish, and that is the grammar rather than an
 * omission: Kingston is both the town and the parish, and `composeJamaican` drops the
 * repetition — so this is what the app itself would write for that point.
 */
export const COUNTRY_EXAMPLES: Record<
  CountryCode,
  { name: string; address: string; lat: string; lon: string }
> = {
  US: {
    name: 'Ferry Plaza Farmers Market',
    address: '1 Ferry Building, San Francisco, CA',
    lat: '37.795',
    lon: '-122.393',
  },
  GB: {
    name: 'Borough Market',
    address: '8 Southwark Street, London SE1 1TL',
    lat: '51.5055',
    lon: '-0.0911',
  },
  JM: {
    name: 'Coronation Market',
    address: 'Peters Lane, Kingston',
    lat: '17.9686',
    lon: '-76.7936',
  },
};

/** Whether the device's region is somewhere this app has been taught to be correct. */
export function isSupportedCountry(code: string | null | undefined): code is CountryCode {
  return !!code && (COUNTRIES as readonly string[]).includes(code.toUpperCase());
}

/**
 * The region subtag of a BCP-47 locale identifier — `en-GB` and `es-Latn-GB` both give `GB`.
 *
 * Parsed here rather than with `Intl.Locale`, which Hermes does not reliably provide, and read
 * from `Intl.DateTimeFormat().resolvedOptions().locale` rather than from a native module. iOS
 * composes that identifier from the *Region* setting as well as the language, so a phone in
 * Spanish with Region set to United Kingdom reports `es-GB` — which is the case that made the
 * region worth reading separately from the language in the first place.
 *
 * A tag with no region at all (`en`) returns null, and the caller falls back. That is the one
 * thing a dedicated localization API would do better, and it cost a native module that broke
 * the debug linker to have it.
 *
 * Grammar, from the spec: language is 2-3 letters, an optional 4-letter script follows, and the
 * region is 2 letters or 3 digits. Matching "two letters after a dash" alone would read the
 * `Latn` in `es-Latn-GB` as nothing and the `zh` in `zh-Hant` as a region.
 */
export function regionFromLocale(tag: string | null | undefined): string | null {
  if (!tag) return null;
  const parts = tag.replace(/_/g, '-').split('-');
  // Skip the language, then an optional script, and take what is left if it looks like a region.
  let i = 1;
  if (parts[i] && /^[A-Za-z]{4}$/.test(parts[i])) i += 1;
  const region = parts[i];
  return region && /^([A-Za-z]{2}|\d{3})$/.test(region) ? region.toUpperCase() : null;
}
