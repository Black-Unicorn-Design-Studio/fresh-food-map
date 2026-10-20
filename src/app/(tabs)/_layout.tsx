import { Tabs, useNavigation } from 'expo-router';
import { Text } from 'react-native';

import { TABS } from '@/constants/tabs';
import { useTheme } from '@/hooks/use-theme';

function tabIcon(emoji: string) {
  // Emoji icons keep the scaffold dependency-free; swap for an icon set later.
  function TabIcon({ focused }: { focused: boolean }) {
    // Decorative: the tab's visible label already names it, and expo-router only sets
    // tabBarAccessibilityLabel on iOS, so on web the emoji became part of the tab's
    // accessible name — twice over, since the active and inactive copies are cross-faded
    // with opacity and both stay in the accessibility tree.
    return (
      <Text aria-hidden={true} style={{ fontSize: 20, opacity: focused ? 1 : 0.55 }}>
        {emoji}
      </Text>
    );
  }
  return TabIcon;
}

export default function TabLayout() {
  const theme = useTheme();
  /**
   * The **root stack**, not the tab navigator. `useNavigation` returns whichever navigator
   * rendered the calling component, and this component *is* the `(tabs)` route's element — so
   * what comes back is the stack the tabs sit inside, and `setOptions` on it sets options for
   * the `(tabs)` screen.
   *
   * That matters because a native stack's back button is labelled from the *previous* screen's
   * `title`, and the previous screen for a market detail page is always `(tabs)`. One static
   * title there could only ever name the group — it read `Markets` — so returning to the map
   * and returning to the list were offered in the same words. Naming it on focus makes the
   * button name the tab it will actually go back to.
   */
  const stack = useNavigation();

  return (
    <Tabs
      screenOptions={{
        tabBarActiveTintColor: theme.tint,
        tabBarInactiveTintColor: theme.textSecondary,
        tabBarStyle: {
          backgroundColor: theme.backgroundElement,
          borderTopColor: theme.border,
        },
        headerShown: false,
      }}>
      {TABS.map(({ name, title, glyph }) => (
        <Tabs.Screen
          key={name}
          name={name}
          options={{ title, tabBarIcon: tabIcon(glyph) }}
          /* `focus` rather than reading the focused tab at render time: that is navigation
             state, and the documented way to reach it — `getFocusedRouteNameFromRoute` — is
             not on expo-router's public surface. It lives under
             `expo-router/build/react-navigation/core/` and reads a route key the library
             marks private in as many words ("coz we want this private"), so reaching for it
             means importing a build path and depending on a private field. A focus listener
             is public, and says the same thing at the moment it changes. */
          listeners={{ focus: () => stack.setOptions({ title }) }}
        />
      ))}
    </Tabs>
  );
}
