import { useEffect } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import Animated, {
  cancelAnimation,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withDelay,
  withRepeat,
  withSequence,
  withTiming,
} from 'react-native-reanimated';

import {
  SPROUT_BARS_RN,
  SPROUT_BAR_THICKNESS,
  SPROUT_GRID,
  SPROUT_STEM_RN,
} from '@/constants/sprout';
import { Elevation, Radii, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

/**
 * 44pt, the minimum comfortable touch target. The map pin this echoes is 28, because a pin
 * is a map feature you aim at with the map's own zoom; this is a control on top of it.
 */
const TARGET = 44;

/**
 * The disc fills the target exactly, so `SLOP` computes to zero and `hitSlop` adds nothing.
 *
 * It was 40 for a while, on the argument that at 44 the 24-unit glyph sat in 10 pt of padding a
 * side and read as more disc than mark, with the 4 pt it gave up returned as `hitSlop`. That
 * stopped applying when the disc gained its keyline: the dot that marks an active filter is a
 * square in the corner of a circle, and at 40 the only insets that keep it inside the keyline
 * push it most of the way to the middle. 44 buys the clearance — see `dot` below for the
 * arithmetic.
 *
 * The `hitSlop` note is kept because the reasoning still binds anything that shrinks the paint
 * again: react-native-web drops `hitSlop` entirely, so a disc smaller than its target is 44 on
 * a phone and its own size in a browser. Shrinking a control's paint is fine; shrinking its
 * target is not, and the two are only the same number by convention.
 */
const DISC = 44;
const SLOP = (TARGET - DISC) / 2;

/**
 * Two pulses, a rest, and round again for as long as the hint is wanted.
 *
 * It was a single burst that stopped itself, which was chosen to sit inside WCAG 2.2.2 —
 * moving content that starts on its own and lasts past five seconds needs a way to pause,
 * stop or hide it, and content that stops inside five is exempt. **A recurring hint gives
 * that exemption up**, and the honest position is to say so rather than to argue the rests
 * count as stopping: it runs until somebody presses something. What stands in for the
 * mechanism is that any press in the dock ends it for the session, and that a reader who has
 * turned motion off never sees it at all. If strict conformance matters more than the
 * recurrence, the fix is a cap — a few cycles and then done — not a longer rest.
 *
 * The burst stayed at two because one pulse reads as a glitch and three reads as nagging.
 * 550 up and 550 down twice is 2.2 seconds of movement in every 8.2 of cycle.
 */
const PULSE_MS = 550;
const REST_MS = 6000;
/** How far past the disc the ring travels. 40 -> ~49, which clears the rim without reading
 *  as a second object. */
const PULSE_SCALE = 0.22;

/**
 * The glyph is drawn from `src/constants/sprout.ts`, on the sprout's own 24-unit grid.
 *
 * It used to be hand-carried: this file held its own copies of the bar length, thickness and
 * positions, with a comment explaining that importing them would imply a rasterisation step
 * this glyph does not have. That reasoning expired when the map pin became this disc at pin
 * size — the mark is now one mark, and two files holding the same numbers is the drift the
 * rest of this codebase spends its comments avoiding.
 */
const GRID = SPROUT_GRID;
const [BAR_LOWER, BAR_UPPER] = SPROUT_BARS_RN;

/**
 * Opens and closes the map's tag filters: the sprout redrawn as a menu, so the mark that
 * means "market" on the map also means "filter the markets" in the chrome. Two bars stand in
 * for the sprout's two leaves, staggered the way the leaves are, over the same stem.
 *
 * The geometry comes from `src/constants/sprout.ts`, which is now the mark for both surfaces:
 * the map pin is this disc at pin size. Built from Views rather than SVG because bars and a
 * stem are rectangles, and one icon does not justify a drawing dependency — the web map draws
 * the same two endpoints as SVG lines, and `scripts/gen-icons.js` rasterises them for the
 * native pin, which is the one copy of the numbers that cannot import them.
 *
 * Colours invert the pin: cream on the logo's green, the same `tint`/`background` pair the
 * wordmark and the favicon use, so all three stay a set across both themes.
 */
export function FilterToggle({
  expanded,
  activeCount,
  controls,
  onPress,
  floating = false,
  label,
  highlight = false,
}: {
  expanded: boolean;
  /**
   * How many things are narrowing the list — tags, and on the list a non-empty search.
   * Painted only as presence — a dot — never as a numeral: a
   * number here sat inches from the chips' own market counts and read as one of them
   * (a chip reading "Producer-owned 2", then a badge saying 1, invited the reading that one
   * market matched — the chips print no counts now, but a numeral here would find something
   * else to be mistaken for).
   * The figure itself is spoken instead, where nothing collides with it.
   */
  activeCount: number;
  /** id of the panel this opens, so the two are associated when it is open. */
  controls: string;
  onPress: () => void;
  /**
   * The lift a control needs to sit over map tiles. Off by default because the list is a
   * flat page, where a shadow on one chip and not its neighbours reads as a mistake — the
   * same split `Wordmark` makes for the same reason.
   */
  floating?: boolean;
  /**
   * A word beside the mark, and the whole control becomes one target rather than a disc with
   * a caption. Opt-in because the two surfaces have different room: on the list the row is
   * half empty and a bare glyph asks the reader to already know what a sprout means, while
   * the map's dock is three stacked controls over the tiles the screen exists to show.
   *
   * **It does not become the accessible name**, which it used to. The spoken name has to
   * cover everything behind the disc, and the visible one has to fit a row beside two other
   * labels — one string cannot do both, and making it try is how the panel ends up announced
   * as half of what it holds. What keeps the two from drifting is the rule instead: the
   * visible word must appear inside the spoken name, which is what WCAG 2.5.3 asks and what
   * `FILTER` inside `Search and filter` satisfies — the containment is case-insensitive, so
   * the drawn word may shout and the spoken one stay a sentence. Anything that does not
   * belong in that sentence does not belong here.
   */
  label?: string;
  /**
   * Keeps the attention pulse running while it is true — two pulses, a rest, repeating. Off
   * by default and set by the screen, because *when* somebody needs pointing at this control
   * is a question about that screen: the map asks three seconds after you arrive on it,
   * because its dock is a bare mark over tiles, and the list never asks because the disc
   * there carries the word `FILTER`.
   *
   * Flipping it back to false stops it mid-cycle and resets the ring, which is what the map
   * does both when the panel opens and when you leave the screen.
   */
  highlight?: boolean;
}) {
  const theme = useTheme();
  const reduceMotion = useReducedMotion();
  const pulse = useSharedValue(0);

  // Suppressed outright under reduced motion rather than shortened: a pulse is the whole
  // mechanism here, and there is no slower version of it that is still a pulse. The cost is
  // stated plainly in the style guide — a reader who has turned motion off gets no hint, and
  // the answer to that is a label, which is what the list screen has.
  const animating = highlight && !reduceMotion;

  useEffect(() => {
    if (!animating) {
      cancelAnimation(pulse);
      pulse.value = 0;
      return;
    }
    // The rest is inside the sequence rather than in a JS timer, so the whole cycle lives on
    // the UI thread and keeps time whether or not the bridge is busy. The trailing zero-length
    // step exists only to give `withDelay` something to hold the value through.
    pulse.value = withRepeat(
      withSequence(
        withTiming(1, { duration: PULSE_MS }),
        withTiming(0, { duration: PULSE_MS }),
        withTiming(1, { duration: PULSE_MS }),
        withTiming(0, { duration: PULSE_MS }),
        withDelay(REST_MS, withTiming(0, { duration: 0 }))
      ),
      -1,
      false
    );
    return () => {
      cancelAnimation(pulse);
      pulse.value = 0;
    };
  }, [animating, pulse]);

  // Opacity and transform only, so this runs on the compositor and never touches layout —
  // an animated `borderWidth` would reflow the dock twice a second.
  const ring = useAnimatedStyle(() => ({
    opacity: pulse.value,
    transform: [{ scale: 1 + pulse.value * PULSE_SCALE }],
  }));
  // The panel holds a search field as well as the chips on the list, so the spoken name has
  // to cover both — "Filters" would send somebody looking for a search box past the one
  // control that opens it. The map's panel is chips only, but one name for one control is
  // worth more than a name that is precise on one screen and absent on the other.
  const name = 'Search and filter';

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={activeCount > 0 ? `${name}, ${activeCount} active` : name}
      // react-native-web drops accessibilityState, so the W3C attribute goes alongside it
      // rather than instead of it — native reads the first, the browser the second.
      accessibilityState={{ expanded }}
      aria-expanded={expanded}
      // Only while the panel exists: pointing at an absent id associates nothing.
      {...(expanded ? { 'aria-controls': controls } : {})}
      onPress={onPress}
      hitSlop={SLOP}
      style={styles.control}>
      <View style={[styles.disc, floating && styles.floating, { backgroundColor: theme.tint }]}>
        {/* The keyline the map's plaque wears, brought round to this disc so the two marks
            read as one set: a cream line just inside the rim, at the same weight and the same
            opacity. On the plaque it echoes the app icon's crate stamp; here it does the same
            job at the same size, which is what makes the corner mark and the control look
            like they came from the same hand.

            Paint, and a leaf — never a wrapper. `aria-hidden` on something with children
            takes the children with it, and the button above already carries the whole
            accessible name. */}
        <View
          style={[styles.keyline, { borderColor: theme.background }]}
          aria-hidden={true}
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
        />
        {/* Paint, and a leaf — never a wrapper, which is the distinction that cost this
            codebase four tag chips once: `aria-hidden` on something with children takes the
            children with it. This has none.

            `pointerEvents: 'none'` is not decoration either. It sits over the disc's own
            rim, and a ring that swallowed the press would make the control harder to use at
            exactly the moment it is asking to be pressed. */}
        {animating ? (
          <Animated.View
            style={[styles.pulse, ring, { borderColor: theme.tint }]}
            pointerEvents="none"
            aria-hidden={true}
            accessibilityElementsHidden
            importantForAccessibility="no-hide-descendants"
          />
        ) : null}
        {/* Paint only. The button carries the whole accessible name, and a stray leaf or bar
            announced on its own would only add noise. */}
        <View
          style={styles.glyph}
          aria-hidden={true}
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants">
          <View style={[styles.bar, styles.barUpper, { backgroundColor: theme.background }]} />
          <View style={[styles.bar, styles.barLower, { backgroundColor: theme.background }]} />
          <View style={[styles.stem, { backgroundColor: theme.background }]} />
        </View>

      {/* Presence, not quantity. A numeral here sat inches from the chips' own market counts
          and was read as one of them; a dot says only "something is filtering", which is the
          part a closed panel hides. How many, and which, stay in the accessible name and on
          the chips themselves. Shown while open too — the filters are still on, and blinking
          it out on every toggle would draw more attention than it saves. */}
        {activeCount > 0 ? (
          <View
            style={[styles.dot, { backgroundColor: theme.background }]}
            aria-hidden={true}
            accessibilityElementsHidden
            importantForAccessibility="no-hide-descendants"
          />
        ) : null}
      </View>

      {/* The overline's treatment, uppercasing and all, because what this sits beside is
          `SORT` — two labels on one row now that `🕒 OPEN NOW` has moved in among the chips,
          and a sentence-case word beside an uppercase one reads as a different kind of thing
          rather than as the other half of a pair. It is the chips inside the panel that keep
          sentence case, which is the type disagreement the style guide records rather than
          quietly settles.

          aria-hidden because the button's own name already contains this word; announcing
          both would say "filter" twice. */}
      {label ? (
        <Text
          style={[styles.label, { color: theme.textSecondary }]}
          aria-hidden={true}
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants">
          {label}
        </Text>
      ) : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  // The row is the target, so the words are as tappable as the mark. Without a label this
  // collapses to exactly the disc it used to be.
  control: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  // `chipLabel`'s metrics to the number, in both screens' row styles — the same 11/700/1.2
  // the two switches beside it wear. Not imported from either: a component that reached into
  // a screen's StyleSheet would be the wrong direction, and the style guide's §3 table is
  // where the four numbers actually live.
  label: { fontSize: 11, fontWeight: '700', letterSpacing: 1.2, textTransform: 'uppercase' },
  disc: {
    width: DISC,
    height: DISC,
    borderRadius: Radii.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  floating: { ...Elevation.floating },
  // Inset from the rim by the same 2 the plaque uses, and `Radii.pill` so it follows a circle
  // rather than cutting a rounded square across it. Sits under the glyph and over the fill;
  // the pulse ring is drawn outside the rim and does not meet it.
  keyline: {
    position: 'absolute',
    top: Spacing.half,
    left: Spacing.half,
    right: Spacing.half,
    bottom: Spacing.half,
    borderWidth: 1,
    borderRadius: Radii.pill,
    opacity: 0.75,
  },
  // Just outside the rim, and inset negatively so it grows outward from the disc's centre
  // rather than pushing anything.
  //
  // `tint`, having been white, then `tint`, then the neon, then white, and back to `tint`.
  //
  // The objection to white was the one that kept being right: the map's tiles are pale cream
  // and green, so a white ring has very little to sit against once it has expanded clear of
  // the disc, and the motion ends up carrying the hint on its own. The disc's cream keyline
  // was supposed to rescue it — the ring reading as that line lifting off the mark — and it
  // does at the first frame and not at the last, which is the frame that has to land.
  //
  // `tint` is the disc's own colour, so the ring reads as the mark itself expanding, and it
  // holds against pale tiles at every radius. It needs no fixed token: the disc it grows from
  // is `tint` in both themes, so a themed green stays legible over a map that never darkens —
  // which is exactly what a themed white could not do. The fixed `mapOverlay` white that
  // existed for this one ring went with it; the web pins' discs are a literal `#fff` in a CSS
  // string and always were (§2 records that as the one deliberate hex in a component).
  //
  // The neon stays where it earned its place, on `🕒 OPEN NOW`.
  //
  // Opacity and scale peak on the same value, so the ring is invisible while it hugs the rim
  // and resolves only once it has expanded onto the tiles.
  pulse: {
    position: 'absolute',
    top: -3,
    left: -3,
    right: -3,
    bottom: -3,
    borderRadius: Radii.pill,
    borderWidth: 2,
  },
  glyph: { width: GRID, height: GRID },
  // Each bar lies along the axis of the leaf it replaces — the diagonals sprout.ts draws from
  // (12,13) up to (4.5,5.5) and (12,10.5) up to (19.5,3) — so the mark reads as growth.
  // Axis-aligned bars were tried twice and read as neither: stacked near the centre they make
  // a funnel, and square off the stem they make a signpost.
  bar: {
    position: 'absolute',
    height: SPROUT_BAR_THICKNESS,
    borderRadius: Radii.pill,
  },
  // Right leaf, high; left leaf, low. The offsets and the rotations are computed from the two
  // endpoints in sprout.ts — nothing here is a measurement of its own.
  barUpper: {
    width: BAR_UPPER.length,
    top: BAR_UPPER.top,
    left: BAR_UPPER.left,
    transform: [{ rotate: BAR_UPPER.rotate }],
  },
  barLower: {
    width: BAR_LOWER.length,
    top: BAR_LOWER.top,
    left: BAR_LOWER.left,
    transform: [{ rotate: BAR_LOWER.rotate }],
  },
  // Top right, mirroring the lower-right position it was tried in — same inset from the side,
  // the same distance from the other edge. That puts it near the tip of the upper leaf, where
  // it reads a little like a berry on the plant. Deliberate: the badge is legible either way,
  // and the mark is friendlier for it. Inset rather than straddling the rim, since the disc
  // carries a shadow and a dot hung off the edge would cast its own and read as a second
  // object.
  // Inset 8, and the number is geometry rather than taste. The disc now carries a keyline 2 in
  // from the rim, and a dot in the corner of a *square* box crosses a *circular* line: at an
  // inset of `i` the dot's far corner sits `(DISC/2 - i)·√2` from the centre, which at 6 was
  // 22.6 against a keyline radius of 20 — the berry landing between the two borders. 8 brings
  // that to 19.8, just inside the line, which is why the disc also grew 2 of radius: at 40 the
  // only insets that clear the keyline push the dot most of the way to the middle.
  dot: {
    position: 'absolute',
    top: Spacing.two,
    right: Spacing.two,
    width: 8,
    height: 8,
    borderRadius: Radii.pill,
  },
  // `M12 21 V11`, the sprout's own stem, to the unit — from sprout.ts rather than retyped.
  stem: {
    position: 'absolute',
    top: SPROUT_STEM_RN.top,
    left: SPROUT_STEM_RN.x - SPROUT_STEM_RN.thickness / 2,
    width: SPROUT_STEM_RN.thickness,
    height: SPROUT_STEM_RN.length,
    borderRadius: Radii.pill,
  },
});
