import { type CountryCode } from '@/constants/countries';

/**
 * The market tag vocabulary — a closed set, deliberately.
 *
 * Free-form tags in a curated dataset decay fast: `producer-owned`,
 * `producer_owned` and `Producer Owned` become three facets describing one
 * thing, and no filter can recover from it. So the validator enforces this list
 * (`scripts/validate-data.ts` imports it), CI rejects anything outside it, and
 * adding a tag is a pull request people can argue about — which is the right
 * amount of friction for a vocabulary everyone has to share.
 *
 * Keep the set small. Every tag has to be something a reviewer can check from a
 * market's own listing, and something a shopper would actually filter on. A tag
 * nobody can check is a claim, not a fact.
 *
 * Nothing here may restate a field the schema already has. `year-round` was in an
 * early draft and removed: `season_start === null` already says it, and two
 * encodings of one fact drift apart the moment somebody edits only one.
 */
export const MARKET_TAGS = [
  'producer-owned',
  'accepts-snap',
  'indoor',
  'organic-focus',
  'grocery-store',
  'donations-available',
] as const;

export type MarketTag = (typeof MARKET_TAGS)[number];

/** Shown on filter chips. Sentence case; the chip styling does the shouting. */
export const TAG_LABELS: Record<MarketTag, string> = {
  'producer-owned': 'Producer-owned',
  'accepts-snap': 'Accepts SNAP',
  indoor: 'Indoor',
  'organic-focus': 'Organic focus',
  'grocery-store': 'Grocery store',
  'donations-available': 'Donations available',
};

/** One line each, for the detail screen — a tag nobody understands is noise. */
export const TAG_DESCRIPTIONS: Record<MarketTag, string> = {
  'producer-owned': 'Run by the growers who sell there, not by a management company.',
  'accepts-snap': 'Accepts SNAP/EBT benefits.',
  indoor: 'Under cover — worth knowing in January.',
  'organic-focus': 'Predominantly certified-organic growers.',
  'grocery-store': 'A shop with regular opening hours, not a stall-based market.',
  'donations-available': 'Free or donated produce is offered here — a gleaning table, a food-bank stall, or similar.',
};

/**
 * Tags that only mean something in some countries.
 *
 * SNAP is a United States federal programme. Offering `Accepts SNAP` as a filter to somebody
 * in Manchester is offering them a question with no answer — every British market would be
 * excluded by it, and not because of anything true about British markets.
 *
 * **It hides the filter, never the fact.** A tag absent from this map is offered everywhere; a
 * tag listed here is offered only where it is listed. The vocabulary itself stays closed and
 * global, so an American market keeps its `accepts-snap` and a reader in Britain looking at
 * that market still sees it on the detail screen — because that is a true thing about that
 * market, and hiding it would be editing the record to suit the reader's postcode.
 *
 * The British analogue is Healthy Start, which OpenStreetMap does not tag and this app does not
 * yet have a vocabulary entry for. Adding one is a pull request, deliberately, like every other
 * tag.
 */
export const TAG_COUNTRIES: Partial<Record<MarketTag, readonly CountryCode[]>> = {
  'accepts-snap': ['US'],
};

/** Whether a tag is worth offering as a filter to a reader in this country. */
export function tagAppliesIn(tag: MarketTag, country: CountryCode): boolean {
  const only = TAG_COUNTRIES[tag];
  return !only || only.includes(country);
}
