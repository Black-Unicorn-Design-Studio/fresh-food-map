import { useCallback, useMemo } from 'react';

import { useFilters } from '@/hooks/use-filters';
import { useUserLocation } from '@/hooks/use-location';
import { nearestWithin, radiiFor, type LatLon } from '@/lib/geo';
import { COUNTRY_UNITS } from '@/constants/countries';
import { useSettings } from '@/hooks/use-settings';
import type { Market } from '@/lib/markets';

/**
 * `📍 NEAR ME`, resolved once for both screens.
 *
 * It lives here rather than in either screen for the reason `activeCount` does: the two tabs
 * computed `🕒 OPEN NOW` separately and drifted the moment it became shared, putting a dot on
 * one disc and not the other while both were filtered the same way. A radius filter has more
 * to get wrong than a boolean — the permission, the widening, the number to display — so
 * duplicating it would be duplicating four chances to disagree.
 *
 * **Turning it on asks for permission, and a refusal leaves it off.** That is the pattern
 * `chooseSort()` already follows for the distance orders: "a refusal leaves the order alone
 * rather than half-applying it". A chip that switched on and then filtered nothing would be
 * lying about its own state.
 */
export function useNearMe(markets: Market[]) {
  const { nearMe, setNearMe } = useFilters();
  // Which unit the radius is stated in, and therefore which ladder it climbs.
  const { country } = useSettings();
  const unit = COUNTRY_UNITS[country];
  const { location, denied, request } = useUserLocation();
  /**
   * No local copy of the position any more. It used to hold one because `request()` resolves
   * before this hook's state has re-rendered — but a copy per hook *instance* is what let the
   * map and the list disagree: the flag was shared through `useFilters` and the position was
   * not, so the list saw the filter on with nothing to measure from. The position is shared
   * now (`UserLocationProvider`), and both screens read the same one.
   */
  const origin = location;

  const toggle = useCallback(
    async (next: boolean) => {
      if (!next) {
        setNearMe(false);
        return;
      }
      if (origin) {
        setNearMe(true);
        return;
      }
      const { point: here } = await request();
      if (!here) return; // Refused or unavailable: the chip stays off and says nothing false.
      setNearMe(true);
    },
    [origin, request, setNearMe],
  );

  /**
   * The narrowed set, plus the radius that produced it.
   *
   * `miles` is non-null only while the filter is actually applied, so a screen can draw the
   * number without first asking whether the filter is on. `widened` is what the chip reads to
   * decide between `📍 NEAR ME` and `📍 WITHIN 50 MI` — see `geo.ts` on why a wider radius has
   * to be announced rather than silently used.
   */
  const result = useMemo(() => {
    if (!nearMe || !origin) {
      return {
        markets,
        radius: null as number | null,
        unit,
        widened: false,
        origin: null as LatLon | null,
      };
    }
    const found = nearestWithin(markets, origin, radiiFor(unit), unit);
    return {
      markets: found.markets,
      radius: found.radius,
      unit: found.unit,
      widened: found.widened,
      origin,
    };
  }, [markets, nearMe, origin, unit]);

  return { ...result, on: nearMe, toggle, denied };
}
