import { StyleSheet, Text, View } from 'react-native';

import { Display, Elevation, Radii, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

/**
 * The app icon, drawn at map scale: the `ffm` monogram in cream on a rounded `tint` field,
 * inside a cream keyline.
 *
 * It was the app's name set in Fraunces Italic on the same green plaque. Same two tokens, same
 * shape, different mark — and the mark is the point: what sits in the corner of the map is now
 * the thing on the home screen, so the app is recognisable from its own first screen.
 *
 * **Redrawn rather than the PNG.** `assets/images/icon.png` is 1024 square and would be shown
 * here at 48: the crate-stamp keylines are 10 and 4 units wide there, which is half a point and
 * a fifth of a point at this size, so the raster arrives as a soft green square with a grey
 * smudge around the edge. Type and a border scale; a photograph of type does not. Drawing it
 * also makes it follow the colour scheme, which a registered image cannot — the same argument
 * `scripts/gen-icons.js` loses on the native map pin and wins here.
 *
 * The icon carries **two** keylines, at 0.9 and 0.55 opacity. This carries one: the second
 * would land under a point wide and read as a rendering artefact rather than as a second line.
 *
 * Used on the map only — it is that screen's plaque. The list leads with "Fresh, from the
 * land." instead, where a mark above the heading only said the app's name twice.
 *
 * `asHeading` decides the semantics, not the look. On the map this is the screen's only
 * heading, so it passes it. A screen that already has one must not, or the two compete. Either
 * way the accessible name is the app's full name: the visible mark is an abbreviation, and
 * "ffm" is not what anybody calls this.
 *
 * `floating` adds the lift the map needs to sit over tiles. The list is a flat page and does
 * not want it.
 */
export function Wordmark({
  asHeading = false,
  floating = false,
}: {
  asHeading?: boolean;
  floating?: boolean;
}) {
  const theme = useTheme();

  return (
    <View
      style={[styles.plaque, { backgroundColor: theme.tint }, floating && styles.floating]}
      /**
       * **A heading is not a target.** This plaque is a `View` with a background, and this
       * codebase has already paid to learn that such a thing takes touches on both platforms
       * whether or not anything wants them — the same fault the callout's `Rule()` carries a
       * paragraph about. On the map it floats above the canvas at `zIndex: 1`, so anything the
       * map draws underneath it — a pin, a summary card, that card's `✕` — is pressing against
       * a plaque that has no press to give.
       *
       * **`none` and not `box-none`**, which was the first attempt and did not work: `box-none`
       * exempts the view itself and leaves its *children* catching, and the child here is
       * `keyline` — an absolutely positioned `View` inset half a step on every side, so it
       * covers almost the whole plaque and went on swallowing exactly what the fix was meant
       * to free. Nothing inside a wordmark is interactive; `none` says so once, for the
       * subtree.
       *
       * It costs nothing in the accessibility tree: `pointerEvents` governs touches, not
       * exposure, so the plaque keeps its heading role and its name.
       */
      pointerEvents="none"
      accessible
      accessibilityRole={asHeading ? 'header' : 'image'}
      accessibilityLabel="Fresh Food Map">
      {/* Paint. The plaque above carries the whole accessible name, and a border announced on
          its own would only add noise. */}
      <View
        style={[styles.keyline, { borderColor: theme.background }]}
        aria-hidden={true}
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
      />
      <Text style={[styles.monogram, { color: theme.background }]}>ffm</Text>
    </View>
  );
}

const SIZE = 52;

const styles = StyleSheet.create({
  plaque: {
    alignSelf: 'flex-start',
    width: SIZE,
    height: SIZE,
    borderRadius: Radii.card,
    alignItems: 'center',
    justifyContent: 'center',
  },
  floating: { ...Elevation.floating },
  // Inset from the rim by the same proportion the icon uses — 56 of 1024, which is 5.5% — and
  // radius reduced to match, so the line stays parallel to the corner it sits inside rather
  // than cutting across it.
  keyline: {
    position: 'absolute',
    top: Spacing.half,
    left: Spacing.half,
    right: Spacing.half,
    bottom: Spacing.half,
    borderWidth: 1,
    borderRadius: Radii.card - Spacing.half,
    opacity: 0.75,
  },
  // Fraunces Black, the face the icon is set in.
  //
  // **Deliberately smaller in proportion than the icon's own monogram**, which is 560 of 1024
  // — 55% of the field. Matching that here put the letters hard against the keyline: the icon
  // can carry it because its keyline is 10 units of 1024 and sits 56 units in, where this one
  // is a single point sitting two in, so the same ratio leaves a tenth of the clearance. 18 —
  // about a third of the plaque against the icon's 55% — gives the mark room to read as a mark
  // rather than as a box with letters wedged into it, which is what 26 and then 22 did.
  monogram: {
    fontFamily: Display.black,
    fontSize: 18,
    // Fraunces sits high in its em box at this weight; without this the mark reads as resting
    // on the lower keyline rather than centred between them.
    lineHeight: 22,
  },
});
