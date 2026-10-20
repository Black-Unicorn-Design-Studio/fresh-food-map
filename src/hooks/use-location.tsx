import * as Location from 'expo-location';
import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';

import { type LatLon } from '@/lib/geo';

/**
 * How good the fix was, which is a separate question from where it was.
 *
 * `reduced` is iOS 14's **Precise Location: Off** — the reader granted location but only
 * approximately, and the OS answers with a point fuzzed to a several-kilometre region rather
 * than refusing. Nothing about that looks like an error: permission is granted, a coordinate
 * arrives, and it is wrong by more than a town. `metres` is the fix's own claimed radius.
 *
 * Both are here because the screens have to be able to *say* which happened. A reverse lookup
 * that comes back with no street is either a place with no street or a position too vague to
 * have one, and the app used to have no way of telling those apart — so it reported the
 * second as though it were the first, and left the reader to wonder why their own road was
 * missing.
 */
export type LocationFix = { reduced: boolean; metres: number | null };

/**
 * User location, strictly on demand — we never request permission on mount
 * (privacy: PRD §6). `request()` resolves to the position or null if denied.
 *
 * `precise` asks for the best fix the device can give instead of the ~100 m default. It is for
 * the submit form, where the coordinate is written into a committed record and then reverse
 * geocoded to a street address: at a hundred metres the answer can be the wrong side of a
 * block, and the address composed from it goes into the dataset looking exactly as confident
 * as a right one. Discovery does not pass it — `📍 NEAR ME` searches twenty-five miles, where
 * a hundred metres is noise, and the better fix costs time and battery to acquire.
 */
interface UserLocation {
  location: LatLon | null;
  denied: boolean;
  fix: LocationFix | null;
  request: (opts?: { precise?: boolean }) => Promise<{ point: LatLon | null; fix: LocationFix | null }>;
}

const UserLocationContext = createContext<UserLocation | null>(null);

/**
 * One position for the whole app.
 *
 * It was per-hook state, and that is a bug with a name: pressing `📍 NEAR ME` on the map set
 * the shared *flag* through `useFilters` and the map's own *private* position, so switching to
 * the list found the filter on, no origin to measure from, and every market still listed. The
 * two tabs disagreed about a filter they were supposed to share — the exact failure
 * `useFilters` exists to prevent, reintroduced one level down by the parameter living
 * somewhere the flag did not.
 *
 * Granting location on one tab was invisible to the other for the same reason, which nobody
 * had reported yet because it reads as the permission simply not having been asked for.
 *
 * **Still strictly on demand** (PRD §6): mounting this provider asks for nothing. It holds the
 * answer once a press has obtained it, rather than obtaining it.
 */
export function UserLocationProvider({ children }: { children: ReactNode }) {
  const value = useUserLocationState();
  return <UserLocationContext.Provider value={value}>{children}</UserLocationContext.Provider>;
}

export function useUserLocation(): UserLocation {
  const value = useContext(UserLocationContext);
  if (!value) throw new Error('useUserLocation must be used inside <UserLocationProvider>');
  return value;
}

function useUserLocationState(): UserLocation {
  const [location, setLocation] = useState<LatLon | null>(null);
  const [denied, setDenied] = useState(false);
  const [fix, setFix] = useState<LocationFix | null>(null);

  const request = useCallback(
    async ({
      precise = false,
    }: { precise?: boolean } = {}): Promise<{ point: LatLon | null; fix: LocationFix | null }> => {
      try {
        const permission = await Location.requestForegroundPermissionsAsync();
        if (permission.status !== 'granted') {
          setDenied(true);
          return { point: null, fix: null };
        }
        const pos = await Location.getCurrentPositionAsync({
          accuracy: precise ? Location.Accuracy.Highest : Location.Accuracy.Balanced,
        });
        const next = { lat: pos.coords.latitude, lon: pos.coords.longitude };
        const quality: LocationFix = {
          // Absent below iOS 14 and on Android, where the field does not exist; treated as
          // full rather than unknown, because claiming a fix is vague when it is not would
          // put a warning on every good answer.
          reduced: permission.ios?.accuracy === 'reduced',
          metres: typeof pos.coords.accuracy === 'number' ? pos.coords.accuracy : null,
        };
        setLocation(next);
        setFix(quality);
        setDenied(false);
        // Returned as well as stored, for the reason `useNearMe` holds its own copy: this
        // resolves before the hook's state has re-rendered, so a caller that read `fix` here
        // would read the previous press's answer, or null on the first.
        return { point: next, fix: quality };
      } catch {
        setDenied(true);
        return { point: null, fix: null };
      }
    },
    [],
  );

  return useMemo(
    () => ({ location, denied, fix, request }),
    [location, denied, fix, request],
  );
}
