import { cloneElement, useId, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { MARKET_TAGS, TAG_LABELS, type MarketTag } from '@/constants/tags';
import { TagInfoButton, TagInfoPanel } from '@/components/tag-info';
import { spaceToPress } from '@/lib/a11y';
import { Radii, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

interface Props {
  selected: MarketTag[];
  onChange: (next: MarketTag[]) => void;
  /** How many markets carry each tag, given everything else already filtered. */
  counts: Record<MarketTag, number>;
  /**
   * Filters that narrow by something about the *reader* rather than about a kind of market —
   * `🕒 OPEN NOW` (what time it is) and `📍 NEAR ME` (where you are). Drawn centred on their own
   * line above the tags, closed off by a rule.
   *
   * A slot rather than a built-in pair, so this component keeps knowing only about tags: what
   * else narrows a list is the screen's business. Both screens pass both, which is what stops
   * the two tabs offering different filters.
   *
   * **This has been both ways, and the reversal is worth keeping.** They were inline and first
   * among the chips, on the argument that they filter exactly as a tag does and a set is a row
   * you scan rather than a thing with members sitting apart from it. That argument is sound
   * and is not what failed. What failed is width: these are long chips — `📍 WITHIN 50 MI`
   * especially — so on a phone they took the whole first line and pushed the tags into a
   * ragged second and third, leaving a pile of pills in which the two that ask about you were
   * merely the widest. A separate line states the grouping that the ordering could not.
   *
   * An array because there are two. There was one while `🕒 OPEN NOW` was the only such filter;
   * `📍 NEAR ME` became the second when it stopped being a camera control and started narrowing.
   */
  leading?:
    | React.ReactElement<{ style?: unknown }>
    | React.ReactElement<{ style?: unknown }>[];
  /**
   * Which tags the loaded dataset actually uses (`availableTags` in `lib/markets.ts`).
   * Anything outside this list is not drawn at all — see the note on hiding versus disabling
   * above the component.
   *
   * Optional, and its absence means "draw the whole vocabulary". That is the honest default
   * for a component that cannot tell an empty dataset from one it was simply not told about:
   * a caller with no market data yet would otherwise render no chips and look broken.
   */
  available?: readonly MarketTag[];
  /**
   * `scroll` (default) is a single horizontal rail that fills its container — right for a
   * full-width screen. `wrap` lets the row size to its chips instead, which is what a
   * floating panel needs: a horizontal ScrollView would stretch to the viewport. `stack`
   * gives one chip per line, for a panel read as a list rather than scanned as a rail.
   */
  layout?: 'scroll' | 'wrap' | 'stack';
  /**
   * `stack` only: let every chip size to its own label instead of filling the column.
   *
   * **Nothing sets this today.** The list did, back when it stacked its chips one to a line
   * inside a panel as wide as the content column — stretching four short labels across that
   * drew banners rather than chips. It wraps now, where chip width is intrinsic and this
   * option means nothing, and the map's panel already sizes to its chips. Kept rather than
   * deleted for the same reason `scroll` is: an unmounted arrangement is cheap, and `wrap`
   * was one until the list reached for it.
   *
   * Off is the right default regardless — equal-width chips give equal-width hit targets,
   * and ragged pill edges down a column read as a pile. Turn it on only where the container
   * is wider than the chips have any reason to be, and pair it with a container that then
   * hugs them back; on its own it just makes them ragged inside the same too-wide box.
   */
  fitChips?: boolean;
  /**
   * `wrap` only: force exactly this many chips to a row, each sharing the width equally.
   *
   * Unset lets the row wrap on its own, which is right when there is room for everything but
   * ugly in between — four chips of their labels' widths on a 430 pt phone fall three then
   * one, and a lone chip under a full row reads as a mistake rather than a layout.
   *
   * The basis is `100 / (columns + 0.5)`, not `100 / columns`. At exactly `100 / columns`
   * two chips plus the gap between them total more than the row, so the second wraps and you
   * get one per line — the opposite of what was asked for. The half-column of slack absorbs
   * the gap at any sane column count, and `flexGrow` then spends the remainder so the chips
   * still meet at equal widths.
   */
  columns?: number;
}

/**
 * Display order, by label rather than by tag id — `accepts-snap` sorts before
 * `producer-owned` either way, but "Organic focus" and "organic-focus" need not agree in
 * general, and it is the label a shopper is scanning.
 *
 * Sorted here rather than in `constants/tags.ts`: that file is the vocabulary CI enforces,
 * and reordering a closed set to suit one screen invites the idea that its order means
 * something. It does not — this is presentation.
 */
export const ORDERED_TAGS: readonly MarketTag[] = [...MARKET_TAGS].sort((a, b) =>
  TAG_LABELS[a].localeCompare(TAG_LABELS[b]),
);

/**
 * Tag chips. Selecting more than one narrows (AND), matching what a second
 * filter is normally taken to mean.
 *
 * **Empty is two different things, and they get two different answers.**
 *
 * A tag no market *in view* carries is shown disabled rather than hidden: chips appearing and
 * vanishing as you select makes the row jump under your finger, and a greyed count of zero is
 * a more honest answer than pretending the facet does not exist. A selected chip is never
 * disabled, or you could not undo it.
 *
 * A tag no market in the *dataset* carries is not drawn at all. That is not the same case
 * wearing a different threshold: it cannot change while you use the screen, so nothing jumps,
 * and there is no state of the filters in which pressing it would show you anything. The
 * vocabulary is closed and deliberately broader than any one dataset — a fork with no indoor
 * markets should not be offered `Indoor` — so this is the set the data has, not the set the
 * app knows. `available` carries it; see `availableTags`.
 *
 * A selected tag is drawn whatever `available` says. The dataset can change under a live
 * screen — the CDN refresh lands, and a tag can leave with the last market carrying it — and a
 * chip that vanished while still filtering the list would be a filter nobody could switch off.
 *
 * The dim is deliberately slight. Opacity here is *group* opacity — it composites
 * the label onto the page along with the chip — so 0.45 put the count at about
 * 2:1 against its own background, unreadable, and with this dataset two of four
 * chips start empty, so that was the default state rather than an edge case. 0.9
 * clears 4.5:1 in both themes. Disabled is carried by aria-disabled (Pressable
 * emits it), by the count reading zero, and by the chip not responding — none of
 * which depend on a reader being able to perceive a 55% fade.
 */
export function TagFilter({
  selected,
  onChange,
  counts,
  available,
  leading,
  layout = 'scroll',
  fitChips = false,
  columns,
}: Props) {
  const theme = useTheme();
  /**
   * Which tag is being explained, if any. One at a time: two open panels under a wrapping row
   * would push the markets down twice and leave the reader hunting for which chip each
   * belonged to. Pressing the open one again closes it, which is what makes the `ⓘ` a toggle
   * rather than a one-way door.
   */
  const [explaining, setExplaining] = useState<MarketTag | null>(null);
  const nativeID = useId();

  const toggle = (tag: MarketTag) =>
    onChange(selected.includes(tag) ? selected.filter((t) => t !== tag) : [...selected, tag]);

  const offered = available
    ? ORDERED_TAGS.filter((tag) => available.includes(tag) || selected.includes(tag))
    : ORDERED_TAGS;

  const chips = offered.map((tag) => {
    const on = selected.includes(tag);
    const empty = counts[tag] === 0 && !on;
    return (
      /* The pill is this View, not the switch inside it. Two controls share it — the toggle
         and the `ⓘ` that explains the tag — and nesting one Pressable in another is how a
         press on the inner one also toggles the outer: on the web the click bubbles, and the
         chip would flip every time somebody asked what it meant. Siblings in a row cannot do
         that, and each keeps its own role, name and target. The border and fill move up here
         so the pair still reads as one pill. */
      <View
        key={tag}
        style={[
          styles.chipGroup,
          {
            backgroundColor: on ? theme.backgroundSelected : theme.backgroundElement,
            // `tint` on and off alike. The border was kraft until a chip was switched on, so
            // the row was a set of faint pills with one green one — and once `🕒 OPEN NOW`
            // joined it wearing a full neon edge, the tags beside it read as disabled rather
            // than as its equals. Every filter in the row is drawn as a filter now, and the
            // green edge is what says "this narrows the list" rather than "this is on".
            //
            // **What carries the on state instead**: the fill (`backgroundSelected`), the
            // label colour, and `checked` on a `switch` — three signals, none of them the
            // border, which is what keeps this inside the never-colour-alone rule even though
            // it takes the one ink the style guide reserved for "on".
            borderColor: theme.tint,
            borderStyle: empty ? 'dashed' : 'solid',
            opacity: empty ? 0.9 : 1,
          },
        ]}>
      {/* spaceToPress is bound only when enabled: unlike RNW's own key handler, this one
          does not early-return on `disabled`. */}
      <Pressable
        accessibilityRole="switch"
        accessibilityState={{ checked: on, disabled: empty }}
        aria-checked={on}
        accessibilityLabel={`${TAG_LABELS[tag]}, ${counts[tag]} ${counts[tag] === 1 ? 'market' : 'markets'}`}
        disabled={empty}
        onPress={() => toggle(tag)}
        {...(empty ? {} : spaceToPress(() => toggle(tag)))}
        style={styles.chip}>
        {/* The label alone. The count still decides whether this chip is disabled and is
            still spoken in its name — it is simply not printed, because four numbers beside
            four words read as data about the tags rather than a property of the list, and
            the number that matters is the shown/total beside the sprout.

            Keeping it in `accessibilityLabel` is not an oversight. A dimmed, dashed chip
            tells a sighted reader why it will not respond; "Indoor, 0 markets" is the only
            thing that tells anybody else. */}
        <Text style={[styles.label, { color: on ? theme.tint : theme.textSecondary }]}>
          {TAG_LABELS[tag]}
        </Text>
      </Pressable>
        <TagInfoButton
          tag={tag}
          open={explaining === tag}
          panelId={`${nativeID}-about-${tag}`}
          onPress={() => setExplaining((cur) => (cur === tag ? null : tag))}
        />
      </View>
    );
  });

  /**
   * The reader-relative filters get their own centred line above the tags, closed off by a
   * rule, rather than leading the wrapping row.
   *
   * This has been both ways and the reversal is the useful record. They sat inline and first,
   * on the argument that a control which moved position as the vocabulary grew would stop
   * being findable — true, and not what went wrong. What went wrong is that `🕒 OPEN NOW` and
   * `📍 WITHIN 50 MI` are long chips: on a phone they consumed the first line and pushed the
   * tags into a ragged second and third, so the row read as one undifferentiated pile of
   * pills in which the two that ask about *you* were merely the widest.
   *
   * Their own line says what the grouping is. Centred because there are two of them and a
   * left-aligned pair under a full-width rule reads as the start of a list that got cut off.
   */
  const front = leading ? (Array.isArray(leading) ? leading : [leading]) : [];
  const row = chips;

  /**
   * One panel for the whole row, under it rather than between the chips.
   *
   * Between them it would land mid-wrap and shove the rest of the row sideways under the
   * finger that opened it. Under the row it pushes only what is already below, which on both
   * screens is the market list — the same displacement the filter panel itself makes, and the
   * reason that one is an accordion rather than an overlay.
   */
  /**
   * Drawn above every layout, so the two screens cannot disagree about where these sit.
   *
   * The rule is `textSecondary`, the mid brown — darker than the pale kraft the map's summary
   * card uses between its own parts, and deliberately so. That one separates lines of text
   * inside a small card, where a strong rule would outweigh the words; this one separates two
   * *kinds of control* inside a panel, which is a heavier boundary and wants a line you notice
   * rather than one you find when you look for it.
   *
   * `aria-hidden` sits on a childless `View`: this component's own history is that the divider
   * markup was once moved onto the wrapper around the chips and took all four of them out of
   * the accessibility tree while leaving them in the DOM (CLAUDE.md).
   */
  const frontRow =
    front.length > 0 ? (
      <>
        <View style={styles.frontRow}>
          {front.map((el, i) => cloneElement(el, { key: `leading-${i}` }))}
        </View>
        <View
          style={[styles.frontRule, { backgroundColor: theme.textSecondary }]}
          aria-hidden={true}
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
        />
      </>
    ) : null;

  const panel =
    explaining !== null ? (
      <TagInfoPanel
        tag={explaining}
        panelId={`${nativeID}-about-${explaining}`}
        onClose={() => setExplaining(null)}
      />
    ) : null;

  if (layout === 'wrap') {
    // Applied to the chips rather than the container: `flexWrap` decides how many fit from
    // each child's basis, so a grid here is a property of the chips and not of the box.
    const sized =
      columns === undefined
        ? row
        : row.map((chip) =>
            cloneElement(chip, {
              style: [chip.props.style, { flexGrow: 1, flexBasis: `${100 / (columns + 0.5)}%` }],
            }),
          );
    return (
      <View>
        {frontRow}
        <View style={styles.wrap}>{sized}</View>
        {panel}
      </View>
    );
  }

  // Stretched by default rather than centred: ragged pill edges down a column read as a
  // pile, and a chip's whole box is its hit target, so equal width also makes the targets
  // uniform. `fitChips` gives that up deliberately — see the prop.
  if (layout === 'stack') {
    return (
      <View>
        {frontRow}
        <View style={[styles.stack, fitChips && styles.stackFit]}>{row}</View>
        {panel}
      </View>
    );
  }

  return (
    // flexShrink: 0 is load-bearing. This rail sits in a flex column beside a FlatList that
    // also flexes, and react-native-web lets a ScrollView shrink below its own content —
    // which clipped the chips to about two thirds of their height, with overflowY hidden so
    // nothing scrolled into view. The rail scrolls sideways; it must never be squashed.
    // The panel sits outside the rail, not in it: inside a horizontal ScrollView it would
    // scroll sideways away from the chip it explains.
    <View>
      {frontRow}
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        style={styles.rail}
        contentContainerStyle={styles.row}>
        {row}
      </ScrollView>
      {panel}
    </View>
  );
}

const styles = StyleSheet.create({
  // Centred, wrapping if a widened radius makes the pair too long for one line on a phone.
  frontRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'center',
    gap: Spacing.two,
    paddingTop: Spacing.two,
  },
  // A full point, not a hairline: a sub-pixel rule reads as a rendering artefact.
  frontRule: { height: 1, alignSelf: 'stretch', marginTop: Spacing.two },
  rail: { flexGrow: 0, flexShrink: 0 },
  row: { gap: Spacing.two, paddingVertical: Spacing.two, paddingRight: Spacing.three },
  // Centred, like the `🕒 OPEN NOW` / `📍 NEAR ME` line above it and the market count below.
  // Word-width chips mean the last line is nearly always short — one chip of a row of two —
  // and left-aligned that reads as a row that failed to fill rather than as the end of a set.
  // Centring makes the ragged edge symmetrical, which is the difference between a shape and a
  // gap. It is the wrapping that makes this worth doing: a rail or a stack has no short line.
  wrap: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'center',
    gap: Spacing.two,
    paddingVertical: Spacing.two,
  },
  stack: { gap: Spacing.two, paddingVertical: Spacing.two, alignItems: 'stretch' },
  // flex-start rather than a width on the chip: a pill has to end where its text does, and
  // only the text knows where that is. The column then measures to the widest of them, which
  // is what lets the panel around it hug the set.
  stackFit: { alignItems: 'flex-start' },
  // The pill. It holds the border and fill for the switch and the `ⓘ` both, so two controls
  // read as one chip.
  chipGroup: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: Radii.pill,
    // 1, not a hairline: the same weight `🕒 OPEN NOW` wears, so the row is one set of pills
    // rather than one bordered control beside four suggestions of one. A hairline in `tint`
    // also reads as grey at arm's length, which is the defect that made the neon border on the
    // switch a full point in the first place.
    borderWidth: 1,
    // The right inset is the `ⓘ`'s own, so the glyph is not jammed against the rim.
    paddingRight: Spacing.two,
  },
  // No border or fill of its own any more — the group draws those. It keeps the padding,
  // because the padding is what makes the label a target rather than a word.
  chip: {
    /**
     * Asymmetric on purpose: 12 to the pill's left edge, 8 to the `ⓘ` on its right. The right
     * side has a control in it and the left has a border, so equal padding made the label and
     * the glyph read as two things sharing an edge rather than one chip.
     *
     * **12 and not 16, and the four points are load-bearing.** Measured on an iPhone SE, the
     * narrowest phone this has to work on: the panel gives the chips 307 pt, and
     * `Accepts SNAP` (152) + the 8 pt gap + `Grocery store` (150) came to 310 — over by three,
     * so the pair split across two lines with `Accepts SNAP` sitting alone above a gap. Four
     * points off each side of every chip buys eight and puts them on one line with room to
     * spare. Widen this again and they split again; the number is a measurement, not a taste.
     */
    paddingLeft: Spacing.two + Spacing.one,
    paddingRight: Spacing.two,
    paddingVertical: Spacing.two,
  },
  label: { fontSize: 11, fontWeight: '700', letterSpacing: 1.2 },
});
