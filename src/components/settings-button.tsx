import { Pressable, StyleSheet, View } from 'react-native';

import { Elevation, Radii } from '@/constants/theme';
import { spaceToPress } from '@/lib/a11y';
import { useTheme } from '@/hooks/use-theme';

/**
 * The gear that opens the settings panel, top right of the map.
 *
 * **It is a sibling of the wordmark, not the wordmark itself.** The plaque is the map screen's
 * only heading (`asHeading`), and a heading and a button are different things: making the
 * plaque pressable would have left the screen with no heading at all, which is how a screen
 * reader user finds their place. This codebase has already paid for that lesson once, in
 * `tag-info.tsx` — the `ⓘ` sits beside the chip it explains rather than inside it, because one
 * element doing two jobs broke both.
 *
 * Same `tint` disc and `background` mark as the filter toggle, and deliberately **not** the
 * same size: that one is 44 and fills its target, this one is 34 inside the same 44 pt target
 * (see `DISC`). The pairing is the app's own (§2) — the two floating controls on this screen
 * read as a set, one at each end of the top band, and neither is mistakable for a map control
 * — but the sprout is the screen's primary control and this is a way in to two preferences, so
 * they are a set that says which of them is which.
 *
 * The glyph is drawn rather than set as an emoji. `⚙️` renders as a different object on every
 * platform — flat on one, shaded on another, sometimes coloured — and the filter disc next to
 * it is geometry from `sprout.ts`, so an emoji here would be the one piece of platform
 * furniture in a band of drawn marks.
 */
const TARGET = 44;
/**
 * The disc is paint, and the paint is smaller than the target. It sat at the full 44 and read
 * as loud as the sprout disc that opens the filters — which is the screen's primary control,
 * where this is a way in to two preferences. It went to 24, which was too quiet, and settled
 * at 34.
 *
 * **The target stays 44.** Shrinking a control's paint is fine and shrinking its target is not
 * (§4), and the two are only the same number by convention. `hitSlop` cannot carry the
 * difference because react-native-web drops it, so the press area is a 44 pt box with a 34 pt
 * disc drawn in the middle of it.
 */
const DISC = 34;
/**
 * **Bars, not teeth** — each bar crosses the hub and so shows a tooth at both ends. Four bars
 * is eight teeth. Writing `8` here meant eight *bars* at 22.5°, sixteen teeth that merged into
 * a solid ring: the mark rendered as a washer with a dot in it, which is what a record button
 * looks like.
 */
const BARS = 4;

export function SettingsButton({ onPress, expanded }: { onPress: () => void; expanded: boolean }) {
  const theme = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel="Settings"
      // react-native-web drops accessibilityState, so the W3C attribute goes alongside rather
      // than instead of it — native reads the first, the browser the second.
      accessibilityState={{ expanded }}
      aria-expanded={expanded}
      onPress={onPress}
      {...spaceToPress(onPress)}
      style={styles.target}>
      <View style={[styles.disc, styles.floating, { backgroundColor: theme.tint }]}>
        {/* Paint. The button's own name says what it does; the gear announced beside it would
            only add "gear" to "Settings". */}
        <View
          style={styles.gear}
          aria-hidden={true}
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants">
          {Array.from({ length: BARS }, (_, i) => (
            <View
              key={i}
              style={[
                styles.tooth,
                { backgroundColor: theme.background, transform: [{ rotate: `${(180 / BARS) * i}deg` }] },
              ]}
            />
          ))}
          <View style={[styles.hub, { backgroundColor: theme.background }]} />
          {/* The bore, in the disc's own fill rather than a hole: a transparent centre would
              show the map through it and read as a smudge over moving tiles. */}
          <View style={[styles.bore, { backgroundColor: theme.tint }]} />
        </View>
      </View>
    </Pressable>
  );
}

/**
 * The glyph inside the disc, and the only thing here that grew.
 *
 * 15 → 19. The disc stays 34 and the target stays 44, so the control occupies exactly the same
 * space and reads louder inside it: the gear went from filling 44% of the disc to 56%, and the
 * cream margin around it from 9.5 pt to 7.5. Every other number in this file is a ratio of this
 * one, so the silhouette is preserved by construction — the hub, the teeth and the bore all
 * scale together, and the proportions the comments below were argued into stay exactly as
 * argued. 19 rather than 18.75, which is the literal 25%: whole points land on the pixel grid
 * at 2x and 3x where a quarter-point does not, and a gear this small is mostly edges.
 */
const GEAR = 19;
const styles = StyleSheet.create({
  target: { width: TARGET, height: TARGET, alignItems: 'center', justifyContent: 'center' },
  disc: {
    width: DISC,
    height: DISC,
    borderRadius: Radii.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  floating: { ...Elevation.floating },
  gear: { width: GEAR, height: GEAR, alignItems: 'center', justifyContent: 'center' },
  // Four bars crossed at 22.5° read as eight teeth, which is the cheapest honest gear: drawing
  // eight separate teeth at this size puts each one under a point wide, where they alias into
  // a grey ring.
  // The proportions are the whole difference between a gear and a washer. At a hub of 0.72
  // the teeth protruded about three points and the mark read as a ring with a dot in it —
  // a record button. The hub sits at 0.62 and the teeth at 0.22, so each stub is longer than
  // it is wide and the silhouette is toothed rather than round. (These were 0.54 and 0.2 while
  // the disc was 24; they were retuned with it and this comment was not, which is why the
  // numbers are now read off the constants below rather than retyped here.)
  // Two failures bracket this. At a hub of 0.54 with thick teeth the stubs protruded three
  // points and the mark was a washer; at 0.48 with thin ones the teeth grew as long as the hub
  // was wide and it became an asterisk. A gear is a *solid body with stubby teeth*, so the hub
  // takes most of the box and each stub is about as wide as it is long.
  tooth: {
    position: 'absolute',
    width: GEAR,
    height: GEAR * 0.22,
    borderRadius: 1,
  },
  hub: { position: 'absolute', width: GEAR * 0.62, height: GEAR * 0.62, borderRadius: Radii.pill },
  bore: { position: 'absolute', width: GEAR * 0.22, height: GEAR * 0.22, borderRadius: Radii.pill },
});
