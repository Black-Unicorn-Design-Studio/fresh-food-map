import {
  Fraunces_400Regular_Italic,
  Fraunces_600SemiBold,
  Fraunces_700Bold,
  Fraunces_900Black,
} from '@expo-google-fonts/fraunces';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useFonts } from 'expo-font';
import { DarkTheme, DefaultTheme, ThemeProvider, Stack } from 'expo-router';

import { TABS } from '@/constants/tabs';
import { FiltersProvider } from '@/hooks/use-filters';
import { UserLocationProvider } from '@/hooks/use-location';
import { SettingsProvider } from '@/hooks/use-settings';
import { useResolvedScheme } from '@/hooks/use-theme';
import * as SplashScreen from 'expo-splash-screen';
import { useEffect, type ReactNode } from 'react';

import { Colors } from '@/constants/theme';

SplashScreen.preventAutoHideAsync();

/**
 * Anchors every stack route to the tabs. Without it, loading
 * /market/<id> straight from a URL — the normal case on web, where these are
 * shareable links — pushes a screen onto an empty stack: no back button, and
 * the tab bar belongs to the (tabs) group, so there is no way back into the
 * app at all short of editing the address bar.
 */
export const unstable_settings = {
  initialRouteName: '(tabs)',
};

const queryClient = new QueryClient();

/**
 * The navigation chrome's palette, resolved **inside** the settings provider.
 *
 * It cannot live in `RootLayout`: that component *renders* `SettingsProvider`, so a
 * `useSettings` call there sits above its own context and throws. Splitting it out is what
 * makes "the header follows the same choice the screens do" true rather than aspirational —
 * read the device directly here and the bar stays light while everything under it goes dark.
 */
function NavChrome({ children }: { children: ReactNode }) {
  const dark = useResolvedScheme() === 'dark';
  const palette = dark ? Colors.dark : Colors.light;
  const navTheme = {
    ...(dark ? DarkTheme : DefaultTheme),
    colors: {
      ...(dark ? DarkTheme : DefaultTheme).colors,
      primary: palette.tint,
      background: palette.background,
      card: palette.backgroundElement,
      text: palette.text,
      border: palette.border,
    },
  };

  return <ThemeProvider value={navTheme}>{children}</ThemeProvider>;
}

export default function RootLayout() {
  const [fontsLoaded] = useFonts({
    Fraunces_400Regular_Italic,
    Fraunces_600SemiBold,
    Fraunces_700Bold,
    Fraunces_900Black,
  });

  useEffect(() => {
    if (fontsLoaded) SplashScreen.hideAsync();
  }, [fontsLoaded]);

  if (!fontsLoaded) return null;

  return (
    <QueryClientProvider client={queryClient}>
      {/* The third provider, and the bar for a fourth stays high. It holds the narrowing the
          map and the list share — see `use-filters.tsx` for why that stopped being
          screen-local, and for what deliberately did not move with it. */}
      {/* Outside the filters, because the country decides how whatever the filters find is
          *rendered* — the address shape, the units — where the filters decide only which
          records those are. The dependency runs one way: a filter never needs to know the
          country, and settings never need to know what is filtered. */}
      <SettingsProvider>
        {/* One position for the whole app. Outside the filters because `📍 NEAR ME` is a
            filter whose *parameter* is the position, and the two must not live in different
            places — that is what let the map and the list disagree about it. */}
        <UserLocationProvider>
        <FiltersProvider>
          <NavChrome>
            <Stack>
              {/* This title is unseen here (headerShown: false) but labels the back button on
                every screen pushed above the tabs — without one it reads "(tabs)".
                **It is only a fallback now.** `src/app/(tabs)/_layout.tsx` sets it on every tab
                focus so the button names the tab it will return to — `Map` or `List` rather than
                one word for both, which is all a static title here could manage.
                What is left for this to cover is a cold launch straight into a market URL, where
                no tab has been focused; the first tab is the honest answer there, because that is
                where back leads. Taking it from `TABS[0]` rather than writing it out again makes
                that right by construction instead of by a rule to remember. Measured on iOS: a
                cold deep link does render this, as `‹ Map`, so it is load-bearing rather than
                belt and braces. On the web the same string is the button's `aria-label`, the
                label there being a bare chevron. */}
              <Stack.Screen
                name="(tabs)"
                options={{ headerShown: false, title: TABS[0].title }}
              />
              {/* The app's name, not the market's. The route set this itself from
                `market.name`, which put the name in the bar and again in the heading a thumb
                below it — the same words twice, the second at 36 in Fraunces. The heading wins:
                it wraps to as many lines as a name needs where the bar truncates to one, and
                the bar's job is to say where you are in the app. It also gives the back button
                its label back, which a long market name had been squeezing to a bare chevron.
                Here rather than in the route because it is a constant now, and because the
                route's not-found branch sets no options and would otherwise still read
                "Market" while a found one read something else. */}
              <Stack.Screen name="market/[id]" options={{ title: 'Fresh Food Map' }} />
              <Stack.Screen name="privacy" options={{ title: 'Privacy' }} />
            </Stack>
          </NavChrome>
        </FiltersProvider>
        </UserLocationProvider>
      </SettingsProvider>
    </QueryClientProvider>
  );
}
