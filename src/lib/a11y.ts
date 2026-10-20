/**
 * Web accessibility helpers for gaps react-native-web leaves.
 *
 * The recurring shape: a React Native accessibility prop is not guaranteed to reach the
 * DOM. `accessible`, `accessibilityState`, `accessibilityHint`,
 * `accessibilityElementsHidden` and `importantForAccessibility` are all dropped by
 * react-native-web 0.21.2. The house rule is to add the W3C attribute *alongside* the RN
 * one rather than replacing it, so native keeps working.
 */

/**
 * Restores Space as an activation key on a switch.
 *
 * React-native-web only accepts Space for button roles (`PressResponder`'s
 * `isValidKeyPress`, and its scroll-prevention guard is gated the same way), so on
 * `accessibilityRole="switch"` the keypress falls through to the browser: the page scrolls
 * and the control does not toggle. Enter already works, so the control is operable and
 * this is not a 2.1.1 failure — it simply reads as broken to anyone using a keyboard, and
 * the ARIA switch pattern specifies Space.
 *
 * `!repeat` matters: a held Space auto-repeats keydown and the control would strobe.
 *
 * Cast to `object` because `onKeyDown` is absent from React Native's `Pressable` types.
 * Native ignores the unknown prop, so nothing regresses off the web.
 */
export const spaceToPress = (toggle: () => void) =>
  ({
    onKeyDown: (e: { key: string; repeat: boolean; preventDefault: () => void }) => {
      if ((e.key === ' ' || e.key === 'Spacebar') && !e.repeat) {
        e.preventDefault();
        toggle();
      }
    },
  }) as object;

/**
 * Closes a disclosure on Escape, from the trigger or from anywhere inside what it opened.
 *
 * Expected of anything that opens over or under the thing you were reading — a reader who
 * opens a list to look at it needs a way out that is not "find the button again" — and
 * there is no equivalent on native, where the back gesture and the keyboard dismiss serve
 * the same purpose. So this is web-only by construction rather than by omission.
 *
 * **Never spread this onto the same element as `spaceToPress`.** Both return `{ onKeyDown }`,
 * and the later spread wins — the survivor is whichever is written second, silently, with no
 * type error and nothing at runtime to notice. Where a control needs both behaviours they
 * have to be one handler; in practice it has not come up, because `spaceToPress` is only
 * needed on roles react-native-web withholds Space from and `escapeToClose` belongs on the
 * disclosure button and its panel.
 *
 * `stopPropagation` because these nest: the sort list sits inside a screen that may grow
 * other Escape handlers, and an Escape meant for the innermost open thing should close one
 * layer, not all of them.
 *
 * Cast to `object` for the same reason `spaceToPress` is: `onKeyDown` is absent from React
 * Native's `Pressable` and `View` types, and native ignores the unknown prop.
 */
export const escapeToClose = (close: () => void) =>
  ({
    onKeyDown: (e: { key: string; stopPropagation: () => void }) => {
      if (e.key === 'Escape' || e.key === 'Esc') {
        e.stopPropagation();
        close();
      }
    },
  }) as object;
