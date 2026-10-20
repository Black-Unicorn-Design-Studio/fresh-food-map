import { useMemo } from 'react';

import { type CountryCode } from '@/constants/countries';
import { useSettings } from '@/hooks/use-settings';
import { nearbyInOtherCountry, type LatLon } from '@/lib/geo';
import { useDatasetMarkets } from '@/lib/markets';

/**
 * Whether to offer the reader a country their own setting is hiding markets in.
 *
 * **In a hook because both screens ask it, which is the rule `useNearMe` was extracted for.**
 * The map and the list share the filter state, so they agree that `📍 NEAR ME` is on and that
 * nothing matched — two components computing the offer separately would be two chances to
 * disagree about an offer the reader can act on from either tab.
 *
 * It reads `useDatasetMarkets` rather than `useMarkets` **on purpose, and that is the whole
 * trick**: `useMarkets` has already narrowed the dataset to the reader's country, so asking it
 * about other countries returns nothing by construction. The unnarrowed query is the same
 * cached object either way — React Query hands both callers one result — so this costs a map
 * over an array already in memory and no second fetch.
 *
 * Four conditions, and all of them have to hold:
 *
 * - the filter is **on**, so the reader has actually asked about distance;
 * - it found **nothing**, so there is a silence to explain (an offer beside results would be
 *   noise, and worse, an invitation to leave a screen that was working);
 * - a position exists, because without one there is no question to answer;
 * - another country's own radius ladder finds markets from this point.
 *
 * The distance is not a parameter here: `nearbyInOtherCountry` asks each candidate country the
 * question it will be asked *after* the switch — its own radius ladder, in its own units — so
 * the number offered is the number the reader gets, and a country whose ladder finds nothing is
 * never offered. "Jamaica has markets" is true from London and useless; the ladder rules it out
 * without a second radius to keep in step.
 */
export function useCountryOffer({
  on,
  origin,
  shown,
}: {
  on: boolean;
  origin: LatLon | null;
  shown: number;
}): { country: CountryCode; count: number } | null {
  const { country } = useSettings();
  const dataset = useDatasetMarkets();
  const all = dataset.data;

  return useMemo(() => {
    if (!on || !origin || shown > 0 || !all) return null;
    const found = nearbyInOtherCountry(all, origin, country);
    return found ? { country: found.country, count: found.count } : null;
  }, [on, origin, shown, all, country]);
}
