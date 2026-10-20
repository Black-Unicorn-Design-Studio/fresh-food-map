import { useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AccessibilityInfo,
  FlatList,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import Animated, { FadeIn, LinearTransition, useReducedMotion } from 'react-native-reanimated';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Attribution } from '@/components/attribution';
import { FilterToggle } from '@/components/filter-toggle';
import { MarketCard } from '@/components/market-card';
import { MarketSearch } from '@/components/market-search';
import { useFilters } from '@/hooks/use-filters';
import { CountryOffer } from '@/components/country-offer';
import { useCountryOffer } from '@/hooks/use-country-offer';
import { useNearMe } from '@/hooks/use-near-me';
import { PageTitle } from '@/components/page-title';
import { NearMeToggle } from '@/components/near-me-toggle';
import { OpenNowToggle } from '@/components/open-now-toggle';
import { TagFilter } from '@/components/tag-filter';
import { ThemedText } from '@/components/themed-text';
import { Display, Elevation, MaxContentWidth, Radii, Spacing } from '@/constants/theme';
import { escapeToClose, spaceToPress } from '@/lib/a11y';
import { useFocusHeading } from '@/hooks/use-focus-heading';
import { useTheme } from '@/hooks/use-theme';
import { useUserLocation } from '@/hooks/use-location';
import { useSettings } from '@/hooks/use-settings';
import { MARKET_TAGS, type MarketTag } from '@/constants/tags';
import {
  availableTags,
  filterByTags,
  isOpenNow,
  searchMarkets,
  sortByDistance,
  useMarkets,
} from '@/lib/markets';
import { PLACE_MESSAGES, geocode } from '@/lib/geocode';
import type { LatLon } from '@/lib/geo';

/**
 * The four orders this screen can be in, named rather than computed from two booleans.
 *
 * Deliberately not in `src/lib/markets.ts`: `sortByDistance` takes an origin and a
 * direction and is imported by tests and by the map, and a key like `closest` means nothing
 * without a screen that knows where "here" is. The mapping down to those two arguments is
 * the pair of `const`s beside `sorted`, and is the only place that has to know both.
 */
type SortKey = 'closest' | 'furthest' | 'name-az' | 'name-za';

/**
 * Visible text and spoken name are the same string, which is the cheapest way to satisfy
 * WCAG 2.5.3 — a visible label has to be contained in its accessible name, and identical
 * clears that without anybody having to check the containment again later. Spelled out
 * rather than abbreviated for the same reason §6 makes the day chips speak whole days:
 * `A–Z` is two letters and a dash, and what a screen reader makes of the dash is its own
 * business.
 */
const SORT_CHOICES: { key: SortKey; label: string }[] = [
  { key: 'closest', label: 'Closest first' },
  { key: 'furthest', label: 'Furthest first' },
  { key: 'name-az', label: 'Name A to Z' },
  { key: 'name-za', label: 'Name Z to A' },
];

const SORT_LABELS = Object.fromEntries(SORT_CHOICES.map((c) => [c.key, c.label])) as Record<
  SortKey,
  string
>;

/** Ties the sort button to the list it opens, via aria-controls. */
const SORT_LIST_ID = 'sort-choices';

/** Ties the toggle to the panel it opens, via aria-controls. */
const FILTER_PANEL_ID = 'list-filters';

/**
 * The green edge down the sides of the control row and the filter panel.
 *
 * Both boxes bleed to the column's edges and put the gutter back as padding, so the border
 * lands in the margin — and because a border sits *outside* the padding, the padding has to
 * give back what the border takes or everything inside drifts inward. At 2 pt and a 16 pt
 * gutter that is 14 pt of padding, which puts the search field, the chips and the sprout disc
 * back on the same left margin as every market card below them.
 *
 * Measured before the correction: at 2 pt the disc sat at 18 against the cards' 16, and the
 * sort overlay hung 2 pt past the button that opens it. Because the padding is derived, the
 * width can move without any of that alignment being re-checked by hand — it has been 2, then
 * 5, and is 1 now.
 *
 * **1, because this draws a border and not a band.** At 5 it was a slab down the left and
 * right with nothing across the top or bottom, which does not read as an edge at all: it
 * reads as a shadow on either side of the controls. The fix was both halves together —
 * close the ring (`controlRow` takes the top, `filterPanel` or `controlRowClosed` the
 * bottom) and take the weight down to something a border can be.
 */
const PANEL_EDGE = 1;

/**
 * How far the filter block's contents sit from its own outer edge, border included — and the
 * one number the sort overlay lines up with too.
 *
 * The block used to bleed `-Spacing.three` out to the content column's edges and pad
 * `Spacing.three` back in, which put its contents on the market cards' 16 pt margin and its
 * surface hard against the column. It no longer bleeds: it sits inside the column, so the
 * band's green runs down both sides of it and the header reads as something the controls are
 * standing *on* rather than a stripe they fill. The inset came down with it — 16 of padding
 * inside a box that is 32 narrower would have left the chips in a column of their own.
 *
 * **The sort overlay is derived from this and not written separately.** It hangs off
 * `rowAnchor`, which still spans the full column, while the `SORT` button that opens it now
 * stops `PANEL_INSET` short of that — so an overlay at `right: 0` would hang past its own
 * button by exactly this much. That misalignment has happened once already, at 2 pt, when the
 * two numbers were maintained by hand.
 */
const PANEL_INSET = Spacing.two;

/**
 * How much of the header band shows down each side of the filter block — the green gutter.
 *
 * Written as the thing being looked at rather than as the margin that produces it: the block
 * sits in a column already padded `Spacing.three`, so the margin is whatever closes the gap
 * between that and this, and stating it the other way round means the number in the file is
 * the number somebody measured off the screen. At `Spacing.three` there is no bleed and no
 * margin; below it the block spreads back out toward the column's edges.
 *
 * It has been 16 (no bleed at all), then 12, and is 8 now — the block widening by 4 a side
 * each time, the band narrowing to match.
 */
const PANEL_GUTTER = Spacing.two;

export default function ListScreen() {
  const router = useRouter();
  const theme = useTheme();
  const { location, denied, request } = useUserLocation();
  const { country, setCountry } = useSettings();
  // Shared with the map: narrowing on one tab and finding the full set on the other reads
  // as the two disagreeing about what you asked for. Sort, OPEN NOW and the geocoded origin
  // stay here — see `use-filters.tsx` for why each of those did not move.
  const { tags, setTags, query, setQuery, mode, setMode, openNow, setOpenNow, activeCount } =
    useFilters();

  const [filtersOpen, setFiltersOpen] = useState(false);
  /**
   * One value where there were two booleans, because there was only ever one question.
   * `byDistance` and `descending` could express four orders and the screen could only get
   * you to them through two controls that each said half of it — a switch that meant
   * "distance, or else name" and an arrow pair that meant "or the other way", with the
   * second silently modifying whatever the first had settled. Naming the four outright is
   * shorter to say and shorter to read back.
   *
   * The two booleans survive as derived values immediately below: `sortByDistance` takes an
   * origin and a direction, and rewriting that to take a key would push this screen's
   * vocabulary into a pure function that four tests and the map both use.
   */
  const [sort, setSort] = useState<SortKey>('name-az');
  /** Which control the sort list belongs to, and whether it is showing. */
  const [sortOpen, setSortOpen] = useState(false);
  const sortButtonRef = useRef<View>(null);
  /**
   * Whether the next close should hand focus back to the button — true when the list closed
   * *itself* (a choice, or Escape), false when something else closed it.
   *
   * The distinction is the point: pressing the sprout disc also shuts this list, and
   * grabbing focus back to the sort button at that moment would take it off the control the
   * reader just pressed.
   *
   * State and not a ref, which looks like the wrong tool for a one-shot flag and is not.
   * `react-hooks/refs` rejects handing a ref-touching function to something called during
   * render — `escapeToClose(closeSort)` is exactly that shape — and it is right to: it
   * cannot see that `onKeyDown` fires later, and the shape is the one that goes wrong. The
   * setState is batched with the `setSortOpen(false)` it travels with, so it costs no extra
   * render at all — which makes the argument for state stronger than it first looks.
   */
  const [refocusSort, setRefocusSort] = useState(false);
  /**
   * A place the reader named, and the other thing that can be the origin of a distance sort.
   *
   * Held separately from `location` rather than overwriting it: the device's position is a
   * fact the app was given and a typed place is a choice the reader made, and conflating them
   * means clearing one loses the other. `label` is what the geocoder matched, shown back in
   * the box so the sort says where it is sorting from without a caption having to.
   */
  const [place, setPlace] = useState<(LatLon & { label: string }) | null>(null);
  const [finding, setFinding] = useState(false);
  /** A failed lookup, which outranks the location warning while it stands. */
  const [noticeOverride, setNoticeOverride] = useState<string | null>(null);
  // Reanimated exposes the OS setting; every animation on this screen is skipped when it is
  // on, rather than merely shortened. The style guide's rule is respect, not taste.
  const reduceMotion = useReducedMotion();
  // Returning from a market lands at <body> otherwise, re-tabbing every control above the list.
  const headingRef = useFocusHeading();

  const { markets, isLoading, refreshFailed } = useMarkets();
  // Read once per render rather than per market, so every row is judged against the same
  // instant — otherwise a list spanning midnight could disagree with itself.
  const now = new Date();
  // Only in `name`. In `near` the text is a place and filtering by it would silently narrow
  // the list to markets whose names happen to contain a town — the exact ambiguity the mode
  // control exists to remove.
  const found = searchMarkets(markets, mode === 'name' ? query : '');
  const byTag = filterByTags(found, tags);
  const byClock = openNow ? byTag.filter((m) => isOpenNow(m, now)) : byTag;
  // Last of the four narrowings, so the radius is applied to what the others left rather than
  // to the whole dataset — the same order the counts below assume.
  const near = useNearMe(byClock);
  const shown = near.markets;
  // A named place wins over the device, because naming one is the more recent and more
  // deliberate statement of where you care about. Everything downstream — the sort, the
  // distance on each card — takes a point and does not care which of the two it was.
  const origin = place ?? location;
  // The four names come apart here and nowhere else. `sortByDistance` has taken an origin
  // and a direction since before this screen had a sort control, and passing null for the
  // origin is what alphabetical *is* — so a name order needs no second code path and cannot
  // strand a stale one.
  const byDistance = sort === 'closest' || sort === 'furthest';
  const descending = sort === 'furthest' || sort === 'name-za';
  const sorted = sortByDistance(shown, byDistance ? origin : null, descending);
  // Same question the map asks, answered once in a hook so the two tabs cannot disagree.
  const offer = useCountryOffer({ on: near.on, origin: near.origin, shown: sorted.length });

  // Counts are computed against everything else already applied, so a chip says
  // how many markets you would actually get — not how many exist in the abstract.
  // OPEN NOW is part of "everything else": leaving it out let a chip read two over an empty
  // list, which is the one thing a count on a filter must never do.
  const counts = Object.fromEntries(
    MARKET_TAGS.map((t) => {
      const withTag = filterByTags(found, [...tags.filter((x) => x !== t), t]);
      return [t, openNow ? withTag.filter((m) => isOpenNow(m, now)).length : withTag.length];
    }),
  ) as Record<MarketTag, number>;

  // Which chips exist at all, against the whole dataset rather than against this screen's
  // state — deliberately *not* narrowed by OPEN NOW the way `counts` is. A tag the data has
  // would otherwise disappear at 5pm and come back on Saturday morning.
  const available = useMemo(() => availableTags(markets, country), [markets, country]);

  /**
   * Warnings only. This line is not where the list narrates itself — every ordinary state
   * (alphabetical or by distance, either direction) is already said by the controls above
   * it, and a caption repeating them turns settings into commentary and trains the eye to
   * skip the one place something might actually be wrong.
   *
   * A refused location is the one thing here that qualifies: the sort will not stay
   * on, and nothing else on the screen explains why. That is a failure to report, not a
   * state to describe.
   *
   * Screen readers lose nothing by the rest going: choosing an order closes the list and
   * hands focus back to the sort button, whose accessible name has been rebuilt to carry the
   * new order, so the change arrives as a focus announcement. Pressing a switch flips the
   * button's
   * own accessible name and pressing the switch flips its `checked` state, both on the
   * focused control, which is how a change of state is meant to be announced. The region
   * stays mounted and blank regardless — a live region has to exist before its text changes
   * to be spoken at all.
   */
  const notice =
    noticeOverride ?? (denied && !place ? 'Location is off — showing markets alphabetically.' : '');

  /**
   * Turns the typed text into a point and sorts from it.
   *
   * Switching distance sort on is part of the action, not a second step: naming a place *is*
   * asking for markets near it, and leaving the list alphabetical afterwards would make the
   * press look like it did nothing. The box is then set to the label the geocoder matched —
   * which is how the screen says where it is sorting from without a caption having to, and
   * how a wrong hit becomes visible rather than silently reordering the list.
   */
  async function findPlace() {
    setFinding(true);
    setNoticeOverride(null);
    // Biased by where the reader is, which is a better tie-breaker for "20904" than any
    // country the build was compiled with. Deliberately `location` and not `origin`: a place
    // found earlier must not bias the search for the next one, or each lookup would drag the
    // one after it further from home.
    const result = await geocode(query, {
      near: location ?? undefined,
      // Only used when there is no location: a reader who declined permission and typed an
      // English town would otherwise be filtered to American results and told nothing matched.
      country,
    });
    setFinding(false);
    if (result.ok) {
      setPlace({ lat: result.lat, lon: result.lon, label: result.label });
      setQuery(result.label);
      // Finding a place is a statement about where you care about, so the list orders itself
      // from there without being asked twice. Nearest first and not furthest: nobody looks up
      // a town to find the market furthest from it.
      setSort('closest');
    } else {
      setNoticeOverride(PLACE_MESSAGES[result.reason]);
    }
  }

  /**
   * The two disclosures on this row open independently, and they did not always.
   *
   * Opening either used to close the other, on a height argument: both open on an iPhone SE is
   * a heading, a control row, four sort options and a filter panel before a single market. What
   * that argument missed is that they are not the same kind of thing. The filter panel is a
   * place you *work* — type a name, press two chips, read the count — and sorting is something
   * you do to the result while you are still working there. Closing the panel to answer a
   * question about it threw away what the reader was in the middle of, and they had to reopen
   * it to see what they had done.
   *
   * The height cost is smaller than it looks, too: the sort list floats over the panel rather
   * than pushing it down (see `sortList`), so both open is one panel's worth of page, not two.
   * What it costs instead is the corner of the panel the overlay sits on — the same trade the
   * overlay already makes against the market cards.
   */
  function openSort() {
    // Cleared on the way in, not on the way out: an effect that resets the flag it just
    // acted on is `react-hooks/set-state-in-effect`, and the rule is right that an effect
    // writing the state it depends on is a loop waiting to be written. Opening is the
    // natural place — nothing has asked for focus back yet.
    setRefocusSort(false);
    setSortOpen((open) => !open);
  }

  /**
   * Picking a distance order is the only thing here that needs to know where you are, and it
   * asks then — not on mount, and not for the two name orders, which need nothing.
   *
   * **A typed place counts as knowing.** `origin` is `place ?? location`, so somebody who
   * searched `NEAR` for a town already has an origin and the sort works from it; asking the
   * device for permission as well would be a prompt for something the screen does not need.
   * The old switch asked regardless, which is the one behaviour here that is not a
   * translation of what it did.
   */
  async function chooseSort(next: SortKey) {
    // Closed on the press, before anything is awaited. A chooser still standing open behind
    // a permission dialog reads as one that did not take the choice — and closing first also
    // removes the window this otherwise has: suspended at `await` with the list open,
    // anything else that closed it (the sprout disc does) would leave the resolved call
    // pulling focus off whatever the reader had moved to.
    closeSort();
    if ((next === 'closest' || next === 'furthest') && !place) {
      const here = location ?? (await request()).point;
      // A refusal leaves the order alone rather than half-applying it: the list really is
      // still in the order it was, and the line under the row says why.
      if (!here) return;
    }
    setSort(next);
  }

  /**
   * Focus goes back to the button that opened the list, and it has to be told to: the radio
   * the reader just pressed unmounts with the list, and a focused node that disappears drops
   * focus to `<body>`, so the next Tab restarts at the top of the document. The same hazard
   * §4 records for a control that unmounts on state change.
   *
   * The focus call itself is in an effect rather than here, for two reasons that are both
   * about timing rather than about focus. It has to happen after the commit that removes the
   * list, so there is something settled to move focus to. And keeping it out of here leaves
   * `closeSort` a plain pair of state setters, which is what lets it be handed to
   * `escapeToClose` during render without tripping `react-hooks/refs`.
   */
  const closeSort = useCallback(() => {
    setRefocusSort(true);
    setSortOpen(false);
  }, []);

  useEffect(() => {
    if (sortOpen || !refocusSort) return;
    const button = sortButtonRef.current;
    if (!button) return;
    // Two platforms, two things called "focus", and the earlier version of this comment got
    // both wrong. `focus()` is React Native's own — it is on `NativeMethods`, not a
    // react-native-web addition — but on iOS and Android it moves *input* focus and is a
    // no-op for anything but a TextInput while `enableImperativeFocus` is off, which it is
    // by default. So it does the job on the web and nothing at all on a device.
    //
    // What a device needs moving is the screen-reader cursor, and that is a different call:
    // `sendAccessibilityEvent(host, 'focus')`. Without it VoiceOver is left standing on a
    // radio that has just unmounted and drops wherever iOS decides — which on this screen
    // means never hearing the new order, since the only thing that states it is the button's
    // own name. Not `setAccessibilityFocus`, which is deprecated and routes through the
    // pre-Fabric path that RN 0.86 no longer has any nodes for.
    if (Platform.OS === 'web') button.focus();
    else AccessibilityInfo.sendAccessibilityEvent(button, 'focus');
  }, [sortOpen, refocusSort]);

  return (
    <SafeAreaView
      role="main"
      style={[styles.safe, { backgroundColor: theme.background }]}
      edges={['top']}
    >
      <PageTitle
        title="Markets — Fresh Food Map"
        description="Browse farmers markets, filter by what they are, and get directions."
      />
      <View style={styles.content}>
        {/* A masthead, and the band is the whole of it. No `aria-hidden` on this wrapper —
            it holds the heading, and hiding a wrapper takes its children with it, which is
            the lesson `filter-toggle.tsx` and the tag chips already paid for. A `View` with
            no role and no text of its own announces nothing anyway.

            It bleeds to the content column's edges by cancelling that column's padding and
            putting it back inside, so the tint runs gutter to gutter while the words stay on
            the same left margin as every card below them. On a wide screen the column is
            capped at `MaxContentWidth`, so the band is capped with it rather than running to
            the window — a masthead over the content, not a stripe across the browser. */}
        <View
          style={[
            styles.headerBand,
            {
              backgroundColor: theme.backgroundAccent,
              borderTopColor: theme.tint,
              borderBottomColor: theme.tint,
            },
          ]}
        >
        <ThemedText
          ref={headingRef}
          tabIndex={-1}
          style={[styles.heading, { color: theme.tint }]}
          accessibilityRole="header"
        >
          {/* One heading, always. It used to turn into "Fresh, near you." once location was
              granted, which made the screen's title a status read-out — and the title is the
              one thing on a page that should hold still. Whether the app knows where you are
              is already said by the two places that answer to it: the sort button and the
              line beneath it.

              **Two voices, and now two colours.** The heading has been a black phrase and an
              italic one since it was written; colouring them apart says the same thing the
              italic already said, in the register the rest of the screen is built out of.

              The green is on `Fresh,` and not on the italic, which is the way round it ended
              up after trying the other. Green on the trailing phrase tinted the part the eye
              arrives at last and left the first word — the one doing the work, at 40 and in
              Black — in the same ink as every market name below it. On the first word the
              colour lands where the reader starts, and the italic keeps the page's text
              colour, which is what it shares with the cards underneath.

              It is the one place green inks type without meaning "this filter is on" — safe
              precisely because a heading is not a control and cannot be mistaken for one
              (§2's rule binds what takes `backgroundSelected`, and this takes no fill).

              A stroke on the letters was the other idea and is not available: React Native's
              `Text` has no stroke, and `-webkit-text-stroke` would be the web half of a
              cross-platform component. Colouring the phrase is the honest version of the
              same intent. */}
          Fresh,{' '}
          <Text style={[styles.headingItalic, { color: theme.text }]}>from the land.</Text>
        </ThemedText>

        {/* One line, split to its two edges: the control that opens the filters at the left
            gutter, and against the right edge the pair that acts on the list already showing.
            They ran left to right from one gutter until this split and read as an
            undifferentiated rank. The count used to end the row and is now at the foot of the
            panel the first control opens; the direction arrows used to end it too, and are
            now paint inside the sort button.

            It was two rows for most of this screen's life — the switches above, the toggle
            and the count below — and the split spent a second line of a phone's height on
            four controls that fit on one. It also put the thing you press first at the
            bottom of the pair, which left the toggle reading as a footnote to the switches
            rather than the control that opens the rest of them.

            The one thing the merge gives up: the toggle is no longer the last thing before
            the panel it opens, so Tab from it now passes a switch and a button on the way in
            — two stops, or six while the sort list is open. `aria-expanded` says the panel is
            open, which is the half that is reliably announced; `aria-controls` names it,
            which several screen readers ignore. What actually keeps this usable is that the
            panel is those two stops away and in the same block rather than somewhere else on
            the page — the map's dock has
            made the same trade for the same reason since its panel started opening upward. */}
        <View style={styles.filterAnchor}>
          {/* The row and the overlay it hangs, held together so the drop-down has something
              to measure `top: '100%'` against — its own row, whatever height that row turns
              out to be, rather than a number copied out of the styles and left to drift. */}
          <View style={styles.rowAnchor}>
            <View
              style={[
                styles.controlRow,
                !filtersOpen && styles.controlRowClosed,
                { backgroundColor: theme.background, borderColor: theme.border },
              ]}
            >
              <FilterToggle
                // Named on this screen and not on the map, because the room is different: this
                // row is half empty and a bare sprout asks the reader to already know what the
                // mark means, where the map's dock is three controls stacked over the tiles the
                // screen exists to show.
                //
                // `Filter` and not `Search`, which it said until UAT. The panel holds both, so
                // either word is a half-truth; `Filter` is the better half, because the chips
                // are what the disc is most often opened for and the search box announces
                // itself once the panel is open. The spoken name stays `Search and filter` on
                // both screens, which still contains the visible word — WCAG 2.5.3 asks for
                // containment, and speech input is case-insensitive, so `FILTER` on screen
                // against `filter` in the name satisfies it. See `filter-toggle.tsx`.
                label="Filter"
                expanded={filtersOpen}
                activeCount={activeCount}
                controls={FILTER_PANEL_ID}
                // Leaves the sort list alone, the same way `openSort` now leaves this panel
                // alone: two independent disclosures, either order.
                onPress={() => setFiltersOpen((open) => !open)}
              />
              {/* Pushed to the right edge as a pair, opposite the disc. The three used to run
                  left to right from the gutter and read as one undifferentiated rank of
                  controls; split, the row says what it is — the thing that opens the filters on
                  one side, the two that act on the list already showing on the other. An auto
                  margin on the group rather than `justifyContent: 'space-between'` on the row,
                  so the two stay together when the line wraps instead of being flung apart. */}
              <View style={styles.rightControls}>
                {/* Four orders behind one button, and it took four tries to get here. It was a
                    button painted with the on-chip fill from the start, so it looked
                    already-enabled over an alphabetical list; then a switch, which was honest
                    but could only say "distance, or else name"; then a switch with an arrow
                    button beside it, which could reach all four orders but split one question
                    across two controls and left the arrows meaning "or the other way" with
                    nothing on screen saying what they were reversing.

                    Now it is a disclosure: press it and the four orders are written out, one of
                    them checked. A `button` with `expanded`, not a `switch` with `checked` —
                    what it does is reveal a choice, not carry one, which is exactly the
                    distinction the sprout disc at the other end of this row already draws. The
                    choosing is the `radiogroup` below, because four mutually exclusive answers
                    to one question is what a radio group is, and because a `menu` would owe the
                    reader the whole WAI-ARIA menu keyboard contract — arrows, Home, End, typeahead —
                    for a list of four that Tab already walks.

                    The fill now means "not the default order" rather than "distance": with the
                    arrows gone from the row there is otherwise nothing to see when the list is
                    in `Name Z to A`, and an order silently different from the one you last left
                    is the thing this control has got wrong twice already. Style guide §2's rule
                    holds — it has an off state that surrenders the fill, and `Name A to Z` is
                    it.

                    No pin. It carried "by distance" while the label was shortened and the
                    orders were unwritten — with the four spelled out inside, there is nothing
                    left for it to stand in for, and a location glyph on a control as often set
                    to a name order was announcing the wrong one of the four. The clock on
                    `🕒 OPEN NOW` stays: that one still qualifies a word that would otherwise be
                    ambiguous.

                    The spoken name carries the current order ("Sort, Closest first") because
                    the visible label cannot: four letters say what the button opens, not where
                    the list stands. Visible text is a substring of the spoken name, which is
                    what WCAG 2.5.3 asks.

                    **No `spaceToPress` here**, and the absence is deliberate twice over. This
                    is a `button`, and react-native-web's `isValidKeyPress` accepts Space for
                    exactly that (`role === 'button'` or a `<button>` tag), so the helper —
                    which exists for the `switch` beside it — would do nothing. It would also do
                    worse than nothing: both helpers spread an `onKeyDown`, the second spread
                    wins, and putting the two on one control drops the first without a word. */}
                <Pressable
                  ref={sortButtonRef}
                  accessibilityRole="button"
                  accessibilityLabel={`Sort, ${SORT_LABELS[sort]}`}
                  accessibilityState={{ expanded: sortOpen }}
                  aria-expanded={sortOpen}
                  {...(sortOpen ? { 'aria-controls': SORT_LIST_ID } : {})}
                  onPress={openSort}
                  {...escapeToClose(closeSort)}
                  /* **It does not change colour, and that is the fix rather than the loss.**
                     The fill, the border and the label all used to turn green on any order
                     but the default, which made this the one control on the row whose
                     appearance meant something — and meant it in colour alone, which §6
                     forbids outright. It reads as a button that is switched on, over a list
                     that has no on state; what it actually does is open a list of four
                     orders, and it does that identically whichever one is in force.

                     So it is drawn once: page-element fill, a `tint` edge at a full point
                     like every other filter on this row, and a `textSecondary` label — the
                     same treatment `FILTER` wears at the other end of the row, which is what
                     makes the pair read as a pair. The current order is carried by the
                     button's accessible name ("Sort, Closest first") and by the checked
                     radio in the list it opens. */
                  style={[
                    styles.chip,
                    styles.sortChip,
                    {
                      backgroundColor: theme.backgroundElement,
                      borderColor: theme.tint,
                      borderWidth: 1,
                    },
                  ]}
                >
                  <Text style={[styles.chipLabel, { color: theme.textSecondary }]}>SORT</Text>
                  {/* Paint, and paint is all they are now. They were a button, and as a button
                      they inked one arrow to show the direction in force — meaning carried by
                      colour, which §6 forbids, propped up by an accessible name saying it in
                      words. Inside the button they are an affordance and nothing else: both
                      drawn in one colour, saying "this opens something with an order in it",
                      with the order itself written out four ways below. */}
                  <Text
                    style={[styles.sortArrows, { color: theme.textSecondary }]}
                    aria-hidden={true}
                    accessibilityElementsHidden
                    importantForAccessibility="no-hide-descendants"
                  >
                    ↑↓
                  </Text>
                </Pressable>
              </View>
            </View>

            {/* Under the button that opened it and against the same edge, because a list
                that opens anywhere but under its trigger makes the reader find it.

                **An overlay, and the filter panel beside it is not** — the two look like the
                same kind of thing and are not. The panel is a section of the screen that
                unfolds: large, open while you work through it, and dropped over the list once
                it meant the markets you were filtering could not be read or scrolled to,
                which is why it sits in the flow now. This is four rows you are done with in a
                second, and pushing the whole list down to show them is a lurch that costs
                more than it saves. It floats instead, briefly.

                The trade, measured rather than guessed: at 375 it is a 124 pt strip down the
                right of a 343 pt column, overlapping two cards and covering about a third of
                each. The rest of both stays pressable, and both stay in the tab order and the
                accessibility tree throughout — nothing is taken away, a corner is covered.
                Three ways out besides (Escape, `SORT` again, choosing one), none of which need
                the covered corners.

                With the filter panel open it covers that instead, since the panel is what sits
                under this row — the top right of it, which is the end of the search field. The
                two no longer close each other (see `openSort`), so this is the cost of that:
                one corner of a panel, while a list somebody is about to dismiss is open. The
                sprout disc is no longer one of the ways out, because pressing it now opens and
                closes only its own panel.

                A `radiogroup` of four `radio`s. Four mutually exclusive answers to one question
                is the shape a radio group is for, `accessibilityState.checked` goes alongside
                `aria-checked` because react-native-web drops the first, and the group carries
                its own label so the four are heard as a set rather than as four loose controls.
                Escape closes it from anywhere inside, and choosing hands focus back to the
                button — the pressed radio unmounts, and focus with it, if nobody catches it. */}
            {sortOpen ? (
              <Animated.View
                id={SORT_LIST_ID}
                entering={reduceMotion ? undefined : FadeIn.duration(160)}
                style={[styles.sortList, { backgroundColor: theme.background, borderColor: theme.tint }]}
                role="radiogroup"
                aria-label="Sort the markets"
                {...escapeToClose(closeSort)}
              >
                {SORT_CHOICES.map(({ key, label }) => {
                  const on = sort === key;
                  const pick = () => chooseSort(key);
                  return (
                    <Pressable
                      key={key}
                      accessibilityRole="radio"
                      accessibilityState={{ checked: on }}
                      aria-checked={on}
                      accessibilityLabel={label}
                      onPress={pick}
                      {...spaceToPress(pick)}
                      style={[
                        styles.sortOption,
                        on && { backgroundColor: theme.backgroundSelected },
                      ]}
                    >
                      {/* The tick is not the signal, the ink is not the only signal either, and
                          the accessible name is neither: `checked` says it in the tree. A mark
                          is drawn because a sighted reader scanning four rows should not have to
                          judge which background is warmer, and a space is held for it on the
                          rows without one so the labels start on the same vertical. */}
                      <Text
                        style={[styles.sortTick, { color: theme.tint }]}
                        aria-hidden={true}
                        accessibilityElementsHidden
                        importantForAccessibility="no-hide-descendants"
                      >
                        {on ? '✓' : ' '}
                      </Text>
                      <Text
                        style={[
                          styles.sortOptionLabel,
                          { color: on ? theme.tint : theme.text },
                        ]}
                      >
                        {label}
                      </Text>
                    </Pressable>
                  );
                })}
              </Animated.View>
            ) : null}
          </View>

          {/* `wrap`, and one rule covers both shapes people asked for. The chips run across
            in a row and break to the next line only when they have to, so a wide screen puts
            the whole vocabulary on one line and a phone falls to roughly two per line — one
            per line was a column of four on a 768 pt page, which is a lot of height for four
            words, and a long ladder on a phone.

            Not the default `scroll` rail: a horizontal ScrollView needs a height it does not
            get inside a collapsed panel, and a row that scrolls sideways hides its own
            contents, which is a poor thing for a control that was just revealed. `wrap`
            keeps everything visible at every width.

            The chips size to their labels and wrap where they fall, which is what the map's
            panel does — one arrangement in both places rather than a grid here and word-width
            pills there. They were pinned to two equal columns below 768 and one below 360, to
            stop a four-chip row falling three-then-one and to stop `Producer-owned` wrapping
            inside a chip too narrow for it; word-width chips solve the second outright and
            make the first a ragged row rather than a broken one, which is the trade UAT
            asked for.

            Chips size to their own labels, so they stay ragged
            rather than uniform: equal-width chips gave equal-width hit targets and these do
            not. The narrowest measures about 90x31, comfortably clear of the 24x24 floor,
            but a one-word tag would be the first to test that.

            An accordion, in the flow, and it was an overlay before. Dropping it over the
            list meant the rows it covered were unreachable while it was open — you could not
            read the markets you were filtering, which is the thing the filter is for. In
            flow it displaces them instead, so everything stays scrollable and nothing is
            hidden behind anything. That reverses the earlier reason for the overlay, which
            was that pushing rows down moved the thing you were about to choose from; the
            answer to that is the panel being the same size every time, which it now is, so
            what moves is predictable. `LinearTransition` on the list carries the reflow so
            the rows slide rather than jump. */}
          {filtersOpen ? (
            <Animated.View
              id={FILTER_PANEL_ID}
              // Entering only. A matching `exiting` fade was tried and removed: on the web
              // Reanimated ignores the duration and keeps the node mounted for ~1.3s after
              // the press, which leaves four filter chips sitting in the tab order behind a
              // panel that has visibly closed. Unmounting at once costs a fade nobody asked
              // for; the list's own `LinearTransition` still carries the reflow, so the rows
              // slide up rather than snapping.
              entering={reduceMotion ? undefined : FadeIn.duration(160)}
              style={[
                styles.filterPanel,
                { backgroundColor: theme.background, borderColor: theme.border },
              ]}
            >
              {/* First thing in the card, because it is the widest net: typing a name gets
                  you to one market faster than any combination of chips, and a reader who
                  knows what they are looking for should not have to read four facets first.
                  Shared with the map, so neither view can find something the other cannot. */}
              <MarketSearch
                value={query}
                onChange={(next) => {
                  setQuery(next);
                  setNoticeOverride(null);
                  // Editing the text abandons the place it produced. Keeping the old origin
                  // while the box shows something else would sort from somewhere the screen
                  // no longer names, which is the one way this can lie.
                  if (place) setPlace(null);
                }}
                nativeID="market-search"
                mode={mode}
                onModeChange={(next) => {
                  setMode(next);
                  setNoticeOverride(null);
                  if (next === 'name') setPlace(null);
                }}
                onSubmit={findPlace}
                busy={finding}
              />

              {/* An edge around the chips rather than a rule above them. A line between two
                  blocks says "these are apart"; an edge around one says "this is a group",
                  and it is the second that was missing — four chips under a search field are
                  a set, and the panel drew nothing to say so.

                  Square corners on purpose: everything round in this panel is something you
                  press, so a rounded box this size would read as the largest button on the
                  screen. This is the first chrome the panel has carried since it stopped
                  being an overlay, and the exception is narrow — it draws a group, not a
                  surface. No fill, no radius, no shadow, and the panel around it still draws
                  nothing at all.

                  **No `aria-hidden` on this box** — see the long note in `index.tsx`. It is
                  a wrapper, not a leaf, and hiding a wrapper hides everything inside it: the
                  four chips went missing from the accessibility tree while staying in the
                  DOM, and a violations-only axe run said nothing, because what axe raises for
                  it is an incomplete. A `View` with no role and no text announces nothing
                  anyway. */}
              <View style={[styles.filterBox, { borderColor: theme.tint }]}>
                {/* `🕒 OPEN NOW` is in the row with the tags, and always the first thing in it
                    (`leading`). It narrows the list exactly as a tag does, so it belongs in
                    the same set — it sat in the control row beside `SORT` first, which put the
                    two kinds of narrowing in two places with a control that only reorders
                    between them, and then on a line of its own above the box, which made a set
                    of one. First rather than sorted among them because it answers a question
                    about the whole list — is it trading today — where each tag answers one
                    about a kind of market, and because a control that moved as the vocabulary
                    grew would stop being findable.

                    **Every border in this row is identity, never state.** The tags wear `tint`
                    on and off alike and this switch wears `highlight`, the neon — so a green
                    edge here says "this narrows the list", and which green says whether it
                    narrows by the clock or by a kind of market. What carries the on state is
                    what carries it on every chip: the fill, the label colour, and `checked` on
                    a `switch`. Nothing rests on a border, which is what keeps the row inside
                    the never-colour-alone rule while it spends the one ink §2 reserved for
                    "on". */}
                <TagFilter
                  selected={tags}
                  onChange={setTags}
                  counts={counts}
                  available={available}
                  layout="wrap"
                  leading={[
                    <OpenNowToggle key="open-now" value={openNow} onChange={setOpenNow} />,
                    <NearMeToggle
                      key="near-me"
                      value={near.on}
                      onChange={near.toggle}
                      radiusInForce={near.radius}
                  unit={near.unit}
                    />,
                  ]}
                />
              </View>
            </Animated.View>
          ) : null}
        </View>


        {/* The band closes here, just above the count.

            It was a separate 16 pt rule under the controls for a while, and before that a
            hairline: a divider marking where the chrome ended. Widening it to a buffer and
            then putting the same green down the panel's sides made the actual intent obvious —
            the whole header is one surface, and a rule was a seam drawn inside it. So the tint
            now runs unbroken from the top of the page to here, holding the heading, the
            controls and the filter panel together, and the list starts where it stops.

            The hairline survives as this band's bottom edge, in the market cards' own
            `border`: the green ends against the same line every card below is drawn with. */}
        </View>

        {/* Between the controls and the thing they narrow, centred under the rule that closes
            them. It spent a while at the foot of the filter panel, which put it in the one
            place it could not be read from — shut, which the panel is most of the time. Out
            here it is a caption on the list rather than a footnote to the controls, and it is
            visible without opening anything.

            Its own row and not a line appended to the control row above: that row is a rank
            of things you press, and a number sitting among them invites being pressed. A
            `View` around one `Text` earns its place by saying the number is not one of them.

            Paint, as it was in the panel — the sentence is spoken by the region below. */}
        <View style={styles.countRow}>
          <ThemedText
            type="small"
            themeColor="textSecondary"
            aria-hidden={true}
            accessibilityElementsHidden
            importantForAccessibility="no-hide-descendants"
          >
            {/* The figure in the heading's own face, the word beside it left in the body
                font. It is the one number on this screen anybody reads as a number rather
                than as a label, and Fraunces at 15 gives it the weight to be found without
                making it loud. A nested `Text` rather than two siblings, so the two share a
                baseline and wrap as one phrase. */}
            <Text style={styles.cardCountFigure}>{sorted.length}</Text>{' '}
            {sorted.length === 1 ? 'market' : 'markets'}
          </ThemedText>
        </View>

        {/* Under the count for the same reason it is under the map's: the figure states the
            emptiness and this explains it. On this screen the count is always visible, so
            unlike the map's copy the offer is not hidden behind an open panel. */}
        {offer ? (
          <View style={styles.offerRow}>
            <CountryOffer country={offer.country} count={offer.count} onSwitch={setCountry} />
          </View>
        ) : null}

        {/* The count, spoken, and still a separate node from the one drawn above it. The
            drawn figure is `aria-hidden` paint; this carries the fuller sentence and is the
            only thing that announces when filtering changes what the list holds. Mounted
            unconditionally, which is what a live region needs in order to be announced at
            all: one inserted along with its text is not reliably spoken.

            Off-screen rather than hidden — display:none or aria-hidden would take it out of
            the accessibility tree along with the pixels. */}
        <ThemedText
          type="small"
          style={styles.srOnly}
          role="status"
          aria-live="polite"
          accessibilityLiveRegion="polite"
        >
          {`${sorted.length} of ${markets.length} ${markets.length === 1 ? 'market' : 'markets'} shown`}
        </ThemedText>

        {/* Silent unless something is wrong, and sitting with the other warning rather than
            between the two control rows. Blank it still has zero height, but a zero-height
            child of a `gap` column still costs a gap on each side — 16 pt of air between the
            switches and the filter row, for a line that was saying nothing. Down here it
            costs that only when it speaks, and the two notices read as one place to look. */}
        <ThemedText
          type="small"
          themeColor="textSecondary"
          style={notice ? undefined : styles.statusLine}
          role="status"
          aria-live="polite"
          accessibilityLiveRegion="polite"
        >
          {notice}
        </ThemedText>

        {/* The dataset is refetched at runtime so a merged market reaches people without a
            rebuild. When that refresh fails these markets are still real — they are the
            copy compiled into the app — they are just possibly behind the file a reviewer
            last merged, and saying nothing would present stale data as current. Silent when
            merely offline: React Query pauses rather than errors with no connection, so this
            only appears when the server answered and the answer was wrong. */}
        {refreshFailed ? (
          <ThemedText type="small" themeColor="textSecondary" role="status" aria-live="polite">
            Showing the built-in list — couldn&apos;t load the latest markets.
          </ThemedText>
        ) : null}

        {/* Carries the reflow. Without a layout transition the whole list jumps the height
            of the panel the instant it opens, which is the same visual event as the content
            changing under you — the animation is what says "this moved" rather than "this is
            different now". Skipped outright under reduced motion: the rows still land in the
            right place, they simply arrive there without the slide. */}
        <Animated.View
          style={styles.listWrap}
          layout={reduceMotion ? undefined : LinearTransition.duration(200)}
        >
          <FlatList
            data={sorted}
            keyExtractor={(m) => m.id}
            contentContainerStyle={styles.listContent}
            renderItem={({ item, index }) => (
              <MarketCard
                market={item}
                from={byDistance ? origin : location}
                index={index}
                onPress={() => router.push(`/market/${item.id}`)}
              />
            )}
            ListEmptyComponent={
              <ThemedText themeColor="textSecondary">
                {/* Three states, and the order matters. A search that found nothing has to
                    be named first: it is the narrowest thing the reader did, the one most
                    likely to be a typo, and it is the only one where "no markets here yet"
                    would be a lie about the dataset rather than a fact about it. Adding
                    search without adding this branch is exactly how that lie gets told. */}
                {isLoading
                  ? 'Loading markets…'
                  : mode === 'name' && query.trim()
                    ? 'No markets match that search. Try fewer words, or check the spelling.'
                    : tags.length > 0 || openNow
                      ? 'No markets match those filters. Try removing one.'
                      : 'No markets here yet — know one? Add it.'}
              </ThemedText>
            }
            ListFooterComponent={<Attribution />}
          />
        </Animated.View>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  content: {
    flex: 1,
    alignSelf: 'center',
    width: '100%',
    maxWidth: MaxContentWidth,
    paddingHorizontal: Spacing.three,
    gap: Spacing.two,
    paddingTop: Spacing.three,
  },
  // One surface from the top of the page to just above the market count: the heading, the
  // control row and the filter panel all sit on the same tint, and the list begins where it
  // ends.
  //
  // It grew into this. The tint was the masthead's alone, then a matching rule closed the
  // controls, then the rule became a 16 pt buffer, then the same green ran down the panel's
  // sides — at which point the rule was a seam drawn inside a shape that was already one
  // shape. Removing it is what the last three changes were each approximating.
  //
  // Negative margins out to the column's edges and the same padding back in: the tint runs
  // gutter to gutter, the words stay on the left margin every card below shares. `marginTop`
  // cancels `content`'s `paddingTop` as well, so the band starts flush under the safe-area
  // inset instead of floating below a stripe of page colour. On a wide screen the column is
  // capped at `MaxContentWidth`, so the band is capped with it rather than running to the
  // window — a masthead over the content, not a stripe across the browser.
  //
  // `gap` replaces the one `content` used to put between the heading and the controls, which
  // no longer applies now that both are inside this box. The bottom padding is the buffer the
  // old rule became, and the hairline below it is the market cards' own `border` — set at the
  // call site, being a theme value.
  headerBand: {
    /**
     * Above the market list, which is its next sibling — and this is the level that decides
     * it, not `filterAnchor` inside.
     *
     * react-native-web gives every `View` `z-index: 0`, so every View is a stacking context
     * and a lift is sealed inside whatever wraps it. This band was added with the header
     * redesign and quietly became that wrapper: `filterAnchor`'s lift now ordered the row
     * against the panel and could not reach past the band, so the band and the card list sat
     * as two `z-index: 0` siblings and the later one won.
     *
     * Measured, with `prefers-reduced-motion: reduce` so the sort list is actually painted:
     * without this line, three of the four sort options report a market card as the topmost
     * element at their own centre and refuse every press. With it, all four are clickable.
     * **Check it that way or not at all** — a Reanimated `entering` holds its subtree at
     * `visibility: hidden` until the animation runs, and a hidden element is not hit-testable,
     * so an occluded tab reports all four blocked either way and the measurement means
     * nothing (CLAUDE.md).
     */
    zIndex: 1,
    marginHorizontal: -Spacing.three,
    marginTop: -Spacing.three,
    paddingHorizontal: Spacing.three,
    paddingTop: Spacing.three,
    paddingBottom: Spacing.three,
    gap: Spacing.two,
    /**
     * Both edges in `tint`, both a full point: the band is ruled off top and bottom in the
     * green everything inside it wears.
     *
     * The bottom was a kraft hairline — the market cards' own border drawn across, so the
     * band handed off to the column rather than fencing it out. Matching the top wins
     * something better: the band reads as one bounded object, the way the control row and
     * the panel inside it already do, rather than as a stripe that fades into the list.
     * The full point is not decoration — a hairline in `tint` reads as grey at arm's length,
     * which is the defect that took the chips, the filter box and the sort list off
     * hairlines too.
     */
    borderTopWidth: 1,
    borderBottomWidth: 1,
  },
  heading: {
    fontFamily: Display.black,
    fontSize: 40,
    lineHeight: 46,
  },
  // Both colours live on the elements rather than here, because they come from the theme and
  // this sheet is static. On the masthead's tint: `Fresh,` at 7.10:1 and the italic at
  // 13.86:1, both past AA for body text let alone the 3:1 that display type has to clear.
  headingItalic: { fontFamily: Display.italic, fontSize: 30 },
  // Holds the control row and the panel together as one block, and carries a `zIndex` that
  // lifts it above the filter panel beside it.
  //
  // **It is not enough on its own, and that is the trap.** A z-index orders an element among
  // its own siblings, and react-native-web gives *every* `View` `z-index: 0` — so every View
  // is a stacking context and a lift is sealed inside whatever View wraps it. This one sorts
  // the row against the panel; `headerBand` carries the one that sorts the whole block
  // against the market list, which is a later sibling of the *band* and not of this. Both
  // levels are load-bearing and neither substitutes for the other — see the note there for
  // the measurement, and for how to take it without fooling yourself.
  // **No gap between the row and the panel it opens.** There was 8 pt here, and because the
  // band behind is tint, that gap drew a green line across the middle of the control block
  // every time the panel opened — which read as a third thing appearing rather than as the row
  // extending itself, and fought the accordion outright: the panel is meant to look like the
  // row sliding down to make more of itself.
  //
  // The two boxes are the same fill and the same 2 pt edges, so with nothing between them they
  // meet as one surface, and the only tint left in the header is above the row and below the
  // panel — which is where it was asked to be.
  filterAnchor: { zIndex: 1 },
  // One layout on every platform, and two children where there were four: the sprout disc at
  // the left gutter the rows below already use, and the `rightControls` group held against
  // the opposite edge. The arrangement was split by platform once — centred as a pair on a
  // phone, because the column there is barely wider than the two of them — and two
  // arrangements of the same controls is a thing to keep true twice.
  //
  // There is an auto margin on this row again — `rightControls` carries one — and still no
  // `alignSelf: 'stretch'`, which is the right answer for the reason it always was: a bare
  // View is a column with `alignItems: 'stretch'` on both Yoga and react-native-web, so the
  // row already spans the column, and saying so again would only look load-bearing.
  //
  // `flexWrap` is the concession, not the plan. Two children hold one line comfortably from
  // 320 up; the wrap is what keeps a large text scale from overflowing the gutter, and a
  // wrapped row is a worse layout where an overflowing one is a broken screen. It only works
  // because `rightControls` can be squeezed — see the note there.
  // `alignItems: 'center'` is what keeps the 40 pt disc and the 33 pt pills on a shared
  // centreline rather than a shared top edge.
  // Page colour and green sides, the same as the panel it opens — `SEARCH` and `SORT` are
  // things you work with, so they stand on the working surface rather than on the tint. What
  // is left green is the heading above them, the 8 pt gap between this row and the panel, and
  // the buffer that closes the header.
  //
  // The bleed is on this row and **not** on `rowAnchor` around it, which looks like the
  // tidier place and is not: the sort overlay is absolutely positioned against `rowAnchor`,
  // and an absolutely positioned box measures from its ancestor's *padding* box — so padding
  // there would push `right: 0` out to the screen edge and hang the sort list 16 pt past the
  // button that opens it. Bleeding the inner row leaves that geometry untouched.
  controlRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: Spacing.one,
    paddingVertical: Spacing.two,
    // Out toward the column's edges until `PANEL_GUTTER` of band is left showing each side.
    marginHorizontal: PANEL_GUTTER - Spacing.three,
    paddingHorizontal: PANEL_INSET - PANEL_EDGE,
    // Top, left and right. The bottom belongs to the panel while it is open and to this row
    // when it is not (`controlRowClosed`), so between them the two elements draw one unbroken
    // ring rather than two bars down the sides — which is what a 5 pt left-and-right-only
    // edge actually looked like: a pair of smudges, not a border.
    borderTopWidth: PANEL_EDGE,
    borderLeftWidth: PANEL_EDGE,
    borderRightWidth: PANEL_EDGE,
    // The top of the brown shape, always: green above, page colour below, so the corner is a
    // transition and gets the market cards' own radius.
    borderTopLeftRadius: Radii.card,
    borderTopRightRadius: Radii.card,
  },
  // Closed, this row *is* the bottom of the shape, so it rounds there too. Open, the panel
  // below is the bottom and this edge is mid-shape — rounding it then would draw a waist
  // across a surface that is meant to read as continuous.
  controlRowClosed: {
    borderBottomWidth: PANEL_EDGE,
    borderBottomLeftRadius: Radii.card,
    borderBottomRightRadius: Radii.card,
  },
  // Square, and spanning what the panel spans. `borderRadius: 0` is spelled out rather than
  // left to the default because in this file the default is the thing to argue with —
  // everything else bordered here is a pill, and a reader skimming for a missing radius
  // should find a decision rather than an omission. The same declaration is in
  // `index.tsx`; it is four lines, and sharing it would mean a styles module that exists to
  // hold one box.
  // A full border rather than the hairline the tag chips wear. At a hairline the `tint` edge
  // is a grey suggestion at arm's length — the colour that distinguishes this control from
  // the tags beside it has to actually be visible for the distinction to do any work.
  openNowChip: { borderWidth: 1 },
  filterBox: {
    alignSelf: 'stretch',
    borderWidth: 1,
    borderRadius: 0,
    padding: Spacing.two,
    // On top of the panel's own `gap`, so the search block and its radios end and the chips
    // begin with a clear beat between them rather than the same 8 pt that separates a field
    // from the pills belonging to it. The map's card carries the same.
    //
    // Written as the 4 it started at plus the 10 it grew by, rather than collapsed to 14:
    // this is the gap that closed the search and opened the filters, and it was widened
    // deliberately after living at 12 for a while. 8 from the panel and 14 from here is 22.
    marginTop: Spacing.one + Spacing.two + Spacing.half,
  },
  // Centred. It sat on the left gutter first, which put it in line with the cards and reading
  // as the first of them; centred under the band's full-width edge, it reads as a caption on
  // everything below instead. Which puts it back where the map's is, so the two
  // screens agree on how the number looks even though they still differ on where it sits.
  //
  // The two margins are one move, not two: `content`'s own `gap` left it 8 under the band and
  // 24 above the first card, floating between them and belonging to neither. Eight down and
  // eight off the bottom sits it dead centre at 16 and 16 — `Spacing.three` either side, so
  // the line it ended on is one the scale already had a name for, which is usually the sign
  // of the right answer rather than a coincidence.
  //
  // The pair cancels, so the list below does not shift by a pixel — which is why it is a
  // matched `+`/`-` and not a single margin: a lone `marginTop` would have pushed the whole
  // column down instead of moving one line within it.
  countRow: {
    alignSelf: 'center',
    marginTop: Spacing.two,
    marginBottom: -Spacing.two,
  },
  // `Display.black` is the face "Fresh," is set in (§3's `display` row), at 15 against the 14
  // of the `small` text beside it — one point up, because Fraunces runs smaller than the
  // system face at a shared nominal size. Nowhere near the heading's 40: the point is the
  // figure reading as a figure, not a second heading at the foot of a panel.
  cardCountFigure: { fontFamily: Display.black, fontSize: 15 },
  // In the flow, displacing the list rather than covering it: rows hidden under an overlay
  // could not be read or scrolled to while the panel was open, which is the wrong trade for
  // a control whose whole job is deciding which of those rows you see.
  //
  // `alignSelf: flex-start` is what stops it taking the whole column now that it is no
  // longer absolute — a stretched flex child would. With `wrap` inside, that means it
  // measures to the row rather than to a single chip: as wide as the chips that fit on one
  // line, and no wider. `maxWidth` is what forces the wrap on a narrow screen; without it
  // the row would size to all four chips and overflow the gutter.
  //
  // No elevation. A shadow said "this is above the page", and it is now part of it.
  // No border, no fill, no radius, no padding — the panel draws nothing at all now. Every
  // one of those was chrome for a card floating over the list, and an accordion in the flow
  // is not a card: it is a gap the rows make. The horizontal padding went with them, because
  // without an edge to sit inside, a 16 pt inset just held the chips off the gutter that the
  // Filter button above and every market card below already share.
  //
  // What is left is the two rules that decide its width: take no more room than the chips
  // on a line need, and never exceed the column.
  // Stretched to the column, not measured to its contents.
  //
  // It was `alignSelf: 'flex-start'` with a 280 pt floor, which sized the panel to the widest
  // thing inside it and then stopped — 299 pt wide on a 390 pt phone, with 75 pt of empty
  // column beside it. The chips paid for that: two columns of a 299 pt box leave about 112 pt
  // of label width, and `Producer-owned` at 11/1.2 needs a shade more, so the longest label in
  // the vocabulary wrapped to two lines inside a chip sized for one.
  //
  // Stretch makes it as wide as the page it sits on: the full width on a phone, and
  // `MaxContentWidth` in a desktop window, which is what the market cards below already
  // measure. Deliberately not wider than that — filters broader than the list they filter
  // would read as a different screen's furniture.
  //
  // `minWidth` went with the reason for it. A stretched panel is never narrower than its
  // column, so the search field cannot collapse into a slot; a 280 floor under a stretched box
  // does nothing except overflow the gutter below 312.
  // The panel is page colour, not tint — it is a place you work, and working surfaces in this
  // app are `background`. What encloses it is a 1 pt kraft border, the market cards' own, which
  // the control row above it starts and this finishes: one ring around the pair of them.
  //
  // So the header reads as a green field with a brown block standing on it: tint above the
  // block and below it, and `PANEL_GUTTER` of tint left showing down either side, so the band
  // frames the controls instead of being covered by them. That last part reversed — the block
  // used to bleed to the column's edges precisely so no tint showed beside it — and the
  // reversal is in the style guide, because a tinted band nothing is allowed to sit inside is
  // just a stripe.
  //
  // That bleed is what makes the 1 pt work: the box is pulled out to the column's edges and
  // puts the gutter back as padding, so the search field and the chips keep the left margin
  // every card below shares while the panel's own fill runs past them. Sixteen-point green
  // sides were the previous attempt at this and were the same idea an order of magnitude too
  // loud.
  //
  // `backgroundColor` and `borderColor` are both set at the call site, being theme values.
  filterPanel: {
    alignSelf: 'stretch',
    gap: Spacing.two,
    // Matching the row above — the two are one shape and have to measure the same.
    marginHorizontal: PANEL_GUTTER - Spacing.three,
    paddingHorizontal: PANEL_INSET - PANEL_EDGE,
    // The chips' box ended flush against the panel's bottom edge, so the surface changed from
    // page colour to tint on the same pixel the last control ended on — no room to read the
    // box as finished before the band starts. 16 gives it the same clearance it has at the
    // sides, so the content sits inside the panel rather than up against it.
    //
    // Only at the bottom: the top is where the panel meets the control row, and padding there
    // would reopen the seam the accordion was closed to hide.
    paddingBottom: Spacing.three,
    // No top edge: the row above already drew that line, and two abutting borders read as a
    // double-weight seam across a block meant to be one shape.
    borderBottomWidth: PANEL_EDGE,
    borderLeftWidth: PANEL_EDGE,
    borderRightWidth: PANEL_EDGE,
    // The bottom of the brown shape while it is open. Square at the top, where it meets the
    // control row and there is no colour change to mark.
    borderBottomLeftRadius: Radii.card,
    borderBottomRightRadius: Radii.card,
  },
  // The pair that acts on the list already showing, held against the right edge by an auto
  // margin. A group rather than two auto-margined children, so a wrapped line keeps them
  // beside each other instead of pushing only the last one over.
  //
  // `flexShrink` and `flexWrap` are the part that is easy to leave out and expensive to
  // leave out. A View defaults to `flexShrink: 0` and `nowrap` on Yoga and on the web alike,
  // so without these the group sizes to max-content and cannot be squeezed — which takes
  // `controlRow`'s own `flexWrap` with it, since the only break left would be between the
  // disc and a group too wide for the line. At a large OS text scale that is a row running
  // off the gutter. With them the group gives way first and then breaks inside itself,
  // `justifyContent: 'flex-end'` keeping both chips against the right edge as it does.
  rightControls: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'flex-end',
    alignItems: 'center',
    flexShrink: 1,
    gap: Spacing.one,
    marginLeft: 'auto',
  },
  // The label and its arrows on one line inside the chip's own padding, 10 apart. At the 2
  // this started on the pair read as one crowded glyph-and-word; the arrows are an affordance
  // hanging off the label rather than part of it, and they need the air to say so. 10 and not
  // 8 because `SORT` is four letters against two arrows — a smaller gap between a short word
  // and a mark that abuts it closes up faster than the scale suggests.
  sortChip: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two + Spacing.half },
  // Sized to sit on the label's baseline rather than to be read: these are an affordance,
  // and an arrow pair drawn at the label's own weight would compete with the word.
  sortArrows: { fontSize: 11, lineHeight: 14 },
  // A positioning context, and nothing else: `top: '100%'` on the overlay needs a box whose
  // height is the row's height alone, which `filterAnchor` is not once the filter panel opens
  // inside it. The stacking order lives one level up, on `filterAnchor` — see the note there
  // for why putting it here instead does not work.
  // Lifted above the filter panel, which is its *next* sibling and would otherwise paint over
  // the overlay hanging off this row: later siblings win when nothing says otherwise, so with
  // both disclosures open the sort list was drawn behind the panel — present, focusable, and
  // invisible. One z-index here rather than on the panel, because it is this row's overlay that
  // has to escape, and the panel is ordinary content in the flow.
  //
  // Not on `filterAnchor`, which already carries a z-index for a different reason: that one
  // lifts this whole block above the market cards below it, and a z-index only orders an
  // element among its own siblings. The two are independent.
  rowAnchor: { zIndex: 1 },
  // Hung off the bottom of the row rather than placed after it. `top: '100%'` is the row's
  // own height, so the list follows if that row ever grows a line, and `right: 0` puts it
  // under the button that opens it. No wider than its longest label needs.
  //
  // It draws a border, a fill and a lift where the filter panel draws nothing, and the
  // difference is what each one is: the panel is a section of the page that unfolds into it,
  // this is a choice floating over it. `Elevation.floating` is the shadow the map's dock uses
  // for the same reason — a surface over content has to say that it is over it, or the rows
  // showing around its edges read as a rendering fault.
  sortList: {
    position: 'absolute',
    top: '100%',
    /**
     * Flush with the **outer edge of the filter block**, not with the button that opens it —
     * the same expression the block's own `marginHorizontal` uses, so the two cannot drift.
     *
     * It was pinned to the button's right edge, which put this overlay's border exactly on
     * top of the line the control row draws directly beneath it: two 1 pt edges in the same
     * column of pixels, one floating and one not, which reads as a rendering seam rather than
     * as two objects. Running it out to the block's edge means the overlay finishes where the
     * surface behind it finishes, and the button it belongs to sits inset from both.
     *
     * Negative because `rowAnchor` measures the content column and the block reaches back out
     * past it by the gutter.
     */
    right: PANEL_GUTTER - Spacing.three,
    /**
     * Pulled back up over the row's bottom padding and border, so the list hangs off the
     * *controls* rather than off the outer edge of the block.
     *
     * `top: '100%'` measures the row including its padding, which put the list's top edge 3 pt
     * below the top of the search field in the panel underneath — two horizontal rules a few
     * pixels apart, which reads as a misalignment rather than as two separate things. Starting
     * it level with the bottom of the controls clears the field entirely and makes the list
     * look attached to the `SORT` button that opened it.
     */
    marginTop: -(Spacing.two + PANEL_EDGE),
    // A full point, not a hairline, now that the edge is `tint`: a sub-pixel green reads as
    // grey at arm's length, which is the defect that took the chips off hairlines too.
    borderWidth: 1,
    borderRadius: Radii.card,
    overflow: 'hidden',
    ...Elevation.floating,
  },
  // 44 tall, and it is the box that makes it so — `hitSlop` never arrives on the web (§6).
  // Full width of the list so the whole row is the target, not just the words.
  sortOption: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.one,
    minHeight: 44,
    paddingHorizontal: Spacing.two,
    paddingVertical: Spacing.one,
  },
  // A floor, not a fixed width: the labels start on the same vertical either way, and a
  // hard 14 would clip the glyph once an OS text scale multiplied the 13 it is drawn at.
  sortTick: { minWidth: 14, fontSize: 13, textAlign: 'center' },
  sortOptionLabel: { fontSize: 15 },
  chip: {
    borderRadius: Radii.pill,
    // 8 and not 16. With 16 the row wanted 363 against the 343 an iPhone SE gives and the
    // arrows wrapped off the end — and that was before the sprout disc joined the line.
    // These labels also measure wider in SF Pro than in the browser's fallback stack, so a
    // browser number that only just fits is a device number that does not.
    paddingHorizontal: Spacing.two,
    paddingVertical: Spacing.two,
  },
  chipLabel: { fontSize: 11, fontWeight: '700', letterSpacing: 1.2 },
  // Empty, a Text still occupies a line. Zero height keeps the region in the tree and out
  // of the layout, which is what lets it be blank without leaving a hole where it sits.
  // The offer sits in the column's gutter like the cards below it, so its edge lines up
  // with theirs rather than with the centred count above.
  offerRow: { paddingHorizontal: Spacing.three, paddingBottom: Spacing.three },
  statusLine: { height: 0 },
  // Available to a screen reader, absent from the layout. Not display:none and not
  // aria-hidden — either would take it out of the accessibility tree along with the pixels.
  srOnly: { position: 'absolute', left: -9999, width: 1, height: 1, overflow: 'hidden' },
  listWrap: { flex: 1 },
  listContent: {
    gap: Spacing.three,
    paddingBottom: Spacing.six,
    paddingTop: Spacing.two,
  },
});
