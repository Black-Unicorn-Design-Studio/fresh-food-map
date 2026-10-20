import { useEffect, useRef } from 'react';
import { Platform, Pressable, StyleSheet, Text, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { TAG_LABELS } from '@/constants/tags';
import { Display, Elevation, Radii, Spacing } from '@/constants/theme';
import { escapeToClose } from '@/lib/a11y';
import { useTheme } from '@/hooks/use-theme';
import { isOpenNow, type Market } from '@/lib/markets';

/**
 * What a pin says when you press it.
 *
 * Pressing a pin used to navigate straight to the detail screen, which answered a question
 * nobody had asked yet: on a map, the first question is "what is this one" and only the second
 * is "tell me everything". A summary answers the first without losing the map — the camera
 * does not move, the other pins stay where they are, and `VIEW DETAILS` is still one press
 * away.
 *
 * **Anchored to the pin it belongs to**, on both platforms, and still one component: the web map
 * portals this into a `maplibregl.Popup` and the native map hands it to a MapLibre `Marker`,
 * which takes React Native children at a coordinate. It was docked over the map's controls
 * first, which was simpler and wrong — eight identical pins and one card in the middle of the
 * screen leaves the reader matching a name against a map, and the card sat where the thing it
 * described was not.
 *
 * What anchoring costs: the card moves with the map, so it can be clipped at the viewport's
 * edge, and near the bottom of the screen it can pass behind the floating dock. Both maps place
 * it above the pin where there is room, which is what keeps the second case rare.
 *
 * **No `entering` animation, in a file surrounded by them.** A Reanimated `entering` holds its
 * subtree at `visibility: hidden` until the animation actually runs, and `.focus()` on a
 * hidden element silently does nothing — so the focus move below would land on an occluded or
 * backgrounded tab and be lost. The card is a response to a press; appearing at once is also
 * simply the right behaviour for one.
 */
/**
 * One of the card's three rules, in dark brown.
 *
 * The card had grown to five stacked lines separated by nothing but gaps, and a gap does not
 * say which lines belong together. Three rules close it into the parts it actually has: which
 * market and where, when it trades, and what kind it is.
 *
 * **`border`, the pale kraft brown** — the colour every card edge in the app already uses,
 * so a rule inside this card matches the line around it. It was `textSecondary` for an hour,
 * which is the brown of the town label and the `✕`; at a full point across a 260 pt card that
 * read as heavier than the words it was separating, which is the opposite of what a rule is
 * for. A divider should be found when looked for and ignored otherwise.
 *
 * A full point rather than a hairline, for the reason every rule in this app is a full point:
 * at sub-pixel weight these read as a rendering artefact rather than a line.
 *
 * **It is a leaf with no children, and that is the whole safety argument.** This card's own
 * scar: the divider markup was once moved onto the `View` wrapping the tag chips, which took
 * all four chips out of the accessibility tree on both screens while leaving them in the DOM,
 * and a violations-only axe run said nothing because axe raises it as an *incomplete*
 * (`aria-hidden-focus`). A `View` with no role, no text and no children cannot hide anything,
 * so keeping the hiding props on a childless component is what makes them safe. Never spread
 * them onto something that wraps content.
 */
function Rule() {
  const theme = useTheme();
  return (
    <View
      style={[styles.divider, { backgroundColor: theme.border }]}
      // **Load-bearing, not tidiness.** The `✕` is a 44 pt target pulled up and right by 8 to
      // put the glyph in the corner, so its box overflows the short name row above — and a
      // later sibling paints over an earlier one. A stretched `View` with a background is a
      // hit target, so the first rule sat on the overflowing part of the close button and
      // swallowed presses that landed there. The button stopped working the day these were
      // added. Paint must not take a touch.
      pointerEvents="none"
      aria-hidden={true}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
    />
  );
}

export function MarketCallout({
  market,
  onClose,
  onViewDetails,
}: {
  market: Market;
  onClose: () => void;
  onViewDetails: () => void;
}) {
  const theme = useTheme();
  const headingRef = useRef<Text | null>(null);

  // The card replaces nothing and interrupts nothing, so focus does not *have* to move — but a
  // keyboard reader who pressed a pin has no other way to reach what appeared, since the card
  // is earlier in the dock than the pin they pressed and Tab only goes forward. Keyed on the
  // id so pressing a second pin re-announces rather than leaving the reader on a heading that
  // quietly changed under them.
  useEffect(() => {
    if (Platform.OS !== 'web') return;
    const frame = requestAnimationFrame(() => {
      (headingRef.current as unknown as HTMLElement | null)?.focus?.();
    });
    return () => cancelAnimationFrame(frame);
  }, [market.id]);

  // Absent hours are unknown hours, never "closed" — the same rule `isOpenNow` follows, said
  // out loud here because a market with no schedule would otherwise read as one that is shut
  // today, which is a claim the dataset has not made.
  const hours =
    market.schedule.length === 0
      ? 'Hours not listed yet'
      : isOpenNow(market)
        ? '🕒 Open now'
        : 'Closed right now';

  // The town, as the card on the list draws it: the second comma-separated part of the
  // address. The full address belongs on the detail screen, where there is room for it.
  const town = market.address.split(',').slice(1, 2).join('').trim();

  return (
    <View
      style={[styles.card, { backgroundColor: theme.background, borderColor: theme.border }]}
      // Escape closes it, from the card or anything inside it — expected of anything that
      // opens over what you were reading. Native has the back gesture and needs no equivalent.
      {...escapeToClose(onClose)}>
      <View style={styles.headerRow}>
        <ThemedText
          ref={headingRef}
          // tabIndex so it can take programmatic focus without joining the tab order; the
          // header role makes focusing it announce "heading, <name>", which is the orientation
          // cue that something appeared.
          tabIndex={-1}
          accessibilityRole="header"
          aria-level={2}
          style={styles.name}>
          {market.name}
        </ThemedText>
        {/* 44 as a floor rather than as slop: react-native-web drops `hitSlop`, so a control
            sized 32 with 6 of slop is 44 on a phone and 32 in a browser, and nothing says so. */}
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Close market summary"
          onPress={onClose}
          style={styles.close}>
          <Text style={[styles.closeMark, { color: theme.textSecondary }]}>✕</Text>
        </Pressable>
      </View>

      <Rule />

      {town ? (
        <>
          <ThemedText type="small" themeColor="textSecondary" style={styles.town}>
            {town.toUpperCase()}
          </ThemedText>
          {/* Inside the conditional, or a market with no town would draw two rules with
              nothing between them. */}
          <Rule />
        </>
      ) : null}

      {/* Words, not a colour. The state is spoken by the sentence itself, so nothing here
          depends on telling green from grey — and the clock is a second cue, not the cue. */}
      <ThemedText type="small">{hours}</ThemedText>

      <Rule />

      {market.tags.length > 0 ? (
        <>
          <View style={styles.tags}>
            {market.tags.map((tag) => (
              <View
                key={tag}
                style={[
                  styles.tagChip,
                  { backgroundColor: theme.backgroundSelected, borderColor: theme.tint },
                ]}>
                <Text style={[styles.tagChipText, { color: theme.tint }]}>{TAG_LABELS[tag]}</Text>
              </View>
            ))}
          </View>
          {/* Inside the conditional for the same reason the town's rule is: an untagged market
              would otherwise draw this directly under the rule above it, two lines with
              nothing in between. Most markets in the dataset are untagged today, so this is
              the common case rather than a guard against an unlikely one. */}
          <Rule />
        </>
      ) : null}

      <Pressable
        accessibilityRole="button"
        // The market is named again, because "View details" alone is the same string on every
        // card this screen can draw, and a reader arriving on the button out of context has no
        // way to tell which one they are on.
        accessibilityLabel={`View details for ${market.name}`}
        onPress={onViewDetails}
        style={[styles.button, { backgroundColor: theme.tint }]}>
        <Text style={[styles.buttonLabel, { color: theme.background }]}>VIEW DETAILS</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: Radii.card,
    borderWidth: StyleSheet.hairlineWidth,
    padding: Spacing.three,
    gap: Spacing.two,
    // A fixed width, which a card floating at a point needs and a card docked in a column did
    // not. Anchored to a pin there is no column to measure against: left to size itself the
    // card is as wide as the market's name, so two pins side by side produce two differently
    // shaped bubbles, and a long name produces one wider than the phone. 260 holds
    // `Producer-owned` and `Accepts SNAP` on one line and fits inside a 320 pt screen with the
    // popup's own offset to spare.
    width: 260,
    ...Elevation.floating,
  },
  headerRow: { flexDirection: 'row', alignItems: 'flex-start', gap: Spacing.two },
  name: {
    fontFamily: Display.semi,
    fontSize: 20,
    lineHeight: 26,
    // Takes the row's width so the close button stays pinned to the right edge rather than
    // floating beside a short name.
    flexShrink: 1,
    flexGrow: 1,
  },
  close: {
    minWidth: 44,
    minHeight: 44,
    /**
     * **The glyph moves inside the box; the box does not move outside its row.**
     *
     * This used to be `alignItems/justifyContent: 'center'` with `marginTop: -8` and
     * `marginRight: -8`, and the comment beside it claimed "the target it carries stays the
     * full 44". On the web that was true. On iOS it was not, and the difference is the whole
     * defect: UIKit hit-tests against each ancestor's bounds, so a subview pushed outside its
     * parent is drawn and cannot be touched. The negative margins put roughly a third of the
     * button past the top and right edges of the header row, leaving a `✕` that looked
     * perfectly normal and ate presses.
     *
     * It reported as market-specific because it was: how much of the button survives depends
     * on how tall the row is, and the row is as tall as the name, so the markets whose names
     * wrap to two lines fail differently from the ones that do not.
     *
     * Aligning the glyph to the top-right of its own box gets the corner placement the margins
     * were faking — it lands ~6 pt further right and ~5 pt higher than before — while every
     * one of the 44 points stays inside the row, where a touch can reach it.
     */
    alignItems: 'flex-end',
    justifyContent: 'flex-start',
  },
  closeMark: { fontSize: 16, fontWeight: '700' },
  town: { letterSpacing: 1.2, fontSize: 11 },
  /**
   * A full point of `tint` rather than a hairline, for the reason every green edge in this app
   * is a full point: at sub-pixel weight this green reads as grey at arm's length, which is
   * what took the filter chips, the chip box and the sort list off hairlines.
   *
   * `backgroundColor` on a height rather than a `borderBottomWidth` on the element above it:
   * the rule is its own object here, so it can sit between two children without either of
   * them owning it, and the card's `gap` spaces it evenly from both.
   */
  divider: { height: 1, alignSelf: 'stretch' },
  tags: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.one + Spacing.half },
  tagChip: {
    borderRadius: Radii.pill,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: Spacing.two,
    paddingVertical: Spacing.half,
  },
  tagChipText: { fontSize: 11, fontWeight: '700', letterSpacing: 1.2 },
  button: {
    borderRadius: Radii.button,
    paddingVertical: Spacing.two + Spacing.half,
    paddingHorizontal: Spacing.four,
    alignItems: 'center',
    minHeight: 44,
    justifyContent: 'center',
  },
  buttonLabel: { fontSize: 13, fontWeight: '800', letterSpacing: 1.5 },
});
