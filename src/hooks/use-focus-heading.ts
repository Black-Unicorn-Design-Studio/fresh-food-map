import { useFocusEffect } from 'expo-router';
import { useCallback, useRef } from 'react';
import { Platform, type Text } from 'react-native';

/**
 * Moves focus to a screen's heading when that screen is navigated back to.
 *
 * Expo Router hides the outgoing screen with `display:none` *and* `aria-hidden`, so the
 * focused element is destroyed and focus resets to `<body>`. Nothing in the app or in the
 * router's own layer moves it. Forward navigation survives that — the hidden subtree
 * contributes no tab stops, so the first stop is the new screen's back button — but going
 * *back* leaves a keyboard user at the top of the document, re-tabbing through every
 * control above the list to reach the card they just came from.
 *
 * Returns a ref to attach to the heading, which needs `tabIndex={-1}` so it can take
 * programmatic focus without joining the tab order. Because `accessibilityRole="header"`
 * renders a real heading element, focusing it announces "heading, <name>" — which doubles
 * as an orientation cue that the screen changed.
 *
 * The first focus is deliberately skipped: on a cold load this hook would otherwise steal
 * focus from the top of the document before the reader had begun.
 *
 * Web only. On native the platform already manages focus across screen transitions.
 *
 * No dependency is needed: the effect re-runs whenever the screen regains focus, and the
 * only routes into a market are the list and the map, so one market never replaces another
 * in place.
 */
export function useFocusHeading() {
  const ref = useRef<Text | null>(null);
  const isFirstFocus = useRef(true);

  useFocusEffect(
    useCallback(() => {
      if (Platform.OS !== 'web') return;
      if (isFirstFocus.current) {
        isFirstFocus.current = false;
        return;
      }
      // A frame later: the incoming screen is not yet focusable in the same tick.
      const frame = requestAnimationFrame(() => {
        (ref.current as unknown as HTMLElement | null)?.focus?.();
      });
      return () => cancelAnimationFrame(frame);
    }, [])
  );

  return ref;
}
