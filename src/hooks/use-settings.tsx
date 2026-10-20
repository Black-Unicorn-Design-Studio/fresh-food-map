import AsyncStorage from '@react-native-async-storage/async-storage';
import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';

import {
  DEFAULT_COUNTRY,
  isSupportedCountry,
  regionFromLocale,
  type CountryCode,
} from '@/constants/countries';

/**
 * How the reader wants the app to behave, as opposed to what they are looking for.
 *
 * Deliberately a separate provider from `useFilters`, which holds the *question* — the tags,
 * the search, the clock. This holds the *answer's shape*: which country's conventions to read
 * addresses in, and which theme to draw. A filter is discarded when the app closes and is
 * meant to be; a setting is the opposite, and mixing the two would mean either persisting
 * something that should not survive a relaunch or losing something that should.
 *
 * **This is the first thing in the app that persists anything**, and it is worth being precise
 * that it does not contradict "git is the whole data tier". That rule is about *market data*,
 * whose recovery path must never require logging into a box. These are per-device preferences:
 * losing them costs two presses, they are meaningful to exactly one phone, and there is nowhere
 * else they could live — there are no accounts.
 */
export type ThemeChoice = 'system' | 'light' | 'dark';

export interface Settings {
  /** Which country's conventions to read and write addresses in. */
  country: CountryCode;
  setCountry: (next: CountryCode) => void;
  /** `system` follows the device, which is the default and what most readers want. */
  theme: ThemeChoice;
  setTheme: (next: ThemeChoice) => void;
  /**
   * False until the stored values have been read back.
   *
   * It exists because the first paint would otherwise be the *defaults* and the second the
   * reader's actual choice — a light flash for somebody who chose dark, and a US address shape
   * for somebody in Britain. Anything that would look wrong for one frame should wait on this
   * rather than render twice.
   */
  ready: boolean;
}

const KEY = 'fresh-food-map:settings:v1';

const SettingsContext = createContext<Settings | null>(null);

/**
 * The device's region, if it is somewhere this app has been taught to be correct.
 *
 * Read from `Intl`, not from a localization module. `expo-localization` was the obvious answer
 * and was installed for exactly one field, `regionCode` — then it broke the debug linker.
 * Adding any pod re-links the graph, and this project's had a latent `SwiftUICore` conflict
 * waiting in it: Release built, Debug did not, which costs Fast Refresh for every hour spent
 * on the rest of this work. A whole native dependency, and the obsoleting of every build
 * already installed, is a great deal to pay for one string.
 *
 * `Intl.DateTimeFormat().resolvedOptions().locale` gets substantially the same answer, because
 * iOS composes that identifier from the *Region* setting as well as the language — a phone in
 * Spanish with Region set to United Kingdom reports `es-GB`. That was the case the region was
 * worth reading separately for, and it survives.
 *
 * What is genuinely lost: a tag carrying no region at all (`en`) falls back where `regionCode`
 * would have known. One press in settings fixes that, and nothing else in the app changes.
 */
function deviceCountry(): CountryCode {
  const region = regionFromLocale(Intl.DateTimeFormat().resolvedOptions().locale);
  return isSupportedCountry(region) ? (region.toUpperCase() as CountryCode) : DEFAULT_COUNTRY;
}

export function SettingsProvider({ children }: { children: ReactNode }) {
  const [country, setCountryState] = useState<CountryCode>(deviceCountry);
  const [theme, setThemeState] = useState<ThemeChoice>('system');
  const [ready, setReady] = useState(false);

  // Read once on mount. A stored choice outranks the device, because it *is* the reader
  // overriding the device — that is the whole point of the setting existing.
  useEffect(() => {
    let live = true;
    AsyncStorage.getItem(KEY)
      .then((raw) => {
        if (!live || !raw) return;
        const saved = JSON.parse(raw) as Partial<{ country: string; theme: string }>;
        if (isSupportedCountry(saved.country)) {
          setCountryState(saved.country.toUpperCase() as CountryCode);
        }
        if (saved.theme === 'light' || saved.theme === 'dark' || saved.theme === 'system') {
          setThemeState(saved.theme);
        }
      })
      // Unreadable storage is not worth a broken app: the device's region and the system theme
      // are both perfectly good answers, and the next write repairs the record anyway.
      .catch(() => {})
      .finally(() => live && setReady(true));
    return () => {
      live = false;
    };
  }, []);

  const value = useMemo<Settings>(() => {
    // Written whole rather than per key, so the two can never be half-saved against each other.
    const persist = (next: { country: CountryCode; theme: ThemeChoice }) =>
      AsyncStorage.setItem(KEY, JSON.stringify(next)).catch(() => {});
    return {
      country,
      setCountry: (next) => {
        setCountryState(next);
        persist({ country: next, theme });
      },
      theme,
      setTheme: (next) => {
        setThemeState(next);
        persist({ country, theme: next });
      },
      ready,
    };
  }, [country, theme, ready]);

  return <SettingsContext.Provider value={value}>{children}</SettingsContext.Provider>;
}

export function useSettings(): Settings {
  const value = useContext(SettingsContext);
  if (!value) throw new Error('useSettings must be used inside <SettingsProvider>');
  return value;
}
