import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useMemo, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { FilterToggle } from '@/components/filter-toggle';
import { MarketMap } from '@/components/market-map';
import { MarketSearch } from '@/components/market-search';
import { NearMeToggle } from '@/components/near-me-toggle';
import { OpenNowToggle } from '@/components/open-now-toggle';
import { useFilters } from '@/hooks/use-filters';
import { CountryOffer } from '@/components/country-offer';
import { useCountryOffer } from '@/hooks/use-country-offer';
import { useNearMe } from '@/hooks/use-near-me';
import { TagFilter } from '@/components/tag-filter';
import { SettingsButton } from '@/components/settings-button';
import { SettingsDialog } from '@/components/settings-dialog';
import { Wordmark } from '@/components/wordmark';
import { ThemedText } from '@/components/themed-text';
import { PageTitle } from '@/components/page-title';
import { MARKET_TAGS, type MarketTag } from '@/constants/tags';
import { Display, Elevation, Radii, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useUserLocation } from '@/hooks/use-location';
import { useSettings } from '@/hooks/use-settings';
import {
  boundsAround,
  boundsForRadius,
  boundsForCountry,
  defaultCenterFor,
  type Bounds,
  type LatLon,
} from '@/lib/geo';
import {
  availableTags,
  filterByTags,
  isOpenNow,
  searchMarkets,
  sortByDistance,
  useMarkets,
} from '@/lib/markets';
import { PLACE_MESSAGES, geocode } from '@/lib/geocode';

/** Ties the toggle to the panel it opens, via aria-controls. */
const FILTER_PANEL_ID = 'market-filters';

/** Long enough that it is plainly a hint and not a loading state, short enough to still be
 *  about this visit. Three seconds is what the review asked for and it holds up: under two
 *  reads as a flicker on arrival, over five and the reader has already decided there is
 *  nothing to press. Measured from arriving on this screen, not from launching the app —
 *  see the focus effect below for why that distinction was the whole bug. */
const HINT_AFTER_MS = 3000;

export default function MapScreen() {
  const router = useRouter();
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const { location } = useUserLocation();
  // The country decides where the map opens before it knows anything, and which country a
  // typed place is looked up in when there is no location to bias by.
  const { country, setCountry } = useSettings();

  // Shared with the list. See `use-filters.tsx`.
  const { tags, setTags, query, setQuery, mode, setMode, openNow, setOpenNow, activeCount } =
    useFilters();
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [finding, setFinding] = useState(false);
  /** A failed place lookup. The map has no other line to put a warning on. */
  const [notice, setNotice] = useState<string | null>(null);
  /**
   * Whether the sprout disc has been pointed at yet, and whether it still should be.
   *
   * A UX review found the disc was not reading as the place to start: it is a bare mark over
   * tiles, and the labelled `📍 NEAR ME` sitting under it only sharpens the contrast. The
   * list solved the same complaint with the word `SEARCH`; the map is deliberately not taking
   * that fix, because the dock is three controls deep over the one thing this screen exists
   * to show and a second label there costs more than it returns. A brief pulse is the trade:
   * it points, where a word would have told.
   *
   * **A pulse points and does not explain**, which is the honest limit of it. Somebody who
   * looks at a pulsing sprout still has to press it to learn what it does — the hint buys
   * attention, not comprehension, and if the review comes back saying people looked and
   * still did not press, the answer is the word and not a louder pulse.
   */
  const [hintShown, setHintShown] = useState(false);
  const [hintSpent, setHintSpent] = useState(false);
  /**
   * The pin somebody pressed, if it is still on the map.
   *
   * Held as an id and resolved against `shown` on every render rather than kept as a market
   * object: filter a summarised market out and its card has to go with it, and deriving that
   * costs nothing where an effect would cost a second render pass. Undo the filter and the
   * card comes back, which is the same answer the pin gives.
   */
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const { markets, refreshFailed } = useMarkets();

  // Memoised for its identity, not its cost. `filterByTags` returns the caller's own array
  // when nothing is selected, but a fresh one for every other input — and the web map keys
  // its marker effect on this prop, tearing down and rebuilding every pin when it changes.
  // Unmemoised, any render at all (a theme change, a resize, the two state updates locating
  // performs) rebuilt the markers while a filter was active and dropped keyboard focus to
  // <body>, defeating the guards market-map.web.tsx already carries against exactly that.
  //
  // Search narrows before the tags, and both feed the camera below — a pin the search has
  // excluded must not be framed, or NEAR ME would fly to a market the map is not drawing.
  // Memoised for the same identity reason as `shown`: a fresh array on every render rebuilds
  // every marker on the web map.
  // Only in `name`. In `near` the text is a place, and filtering pins by it would hide the
  // markets the reader is asking to be shown near.
  const found = useMemo(
    () => searchMarkets(markets, mode === 'name' ? query : ''),
    [markets, query, mode]
  );
  /**
   * The clock the `🕒 OPEN NOW` switch reads, taken fresh on every render.
   *
   * Not state and not a timer: this screen re-renders on any press, and a market's open/shut
   * state changing under a still finger is not worth a re-render of the map. What this hands
   * over is the *instant*; which clock that instant is read on belongs to `isOpenNow`, which
   * resolves it in the market's own timezone rather than the device's.
   */
  const now = new Date();
  const byTag = useMemo(() => filterByTags(found, tags), [found, tags]);
  // Memoised with the others because the web map keys its markers on this array's identity: a
  // fresh array every render would rebuild every pin and drop keyboard focus.
  const byClock = useMemo(
    () => (openNow ? byTag.filter((m) => isOpenNow(m, now)) : byTag),
    // `now` is deliberately absent: it changes on every render by construction, and depending
    // on it would defeat the memo entirely. The switch and the dataset are what change the
    // answer in practice; a market opening while somebody stares at the map redraws on their
    // next press, which is soon enough for a question about today.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [byTag, openNow]
  );

  // Last of the four narrowings, so the radius applies to what the others left.
  const near = useNearMe(byClock);
  const shown = near.markets;
  // Offered only when the radius filter found nothing and another country holds markets
  // inside the same radius — see the hook for why all four conditions matter.
  const offer = useCountryOffer({ on: near.on, origin: near.origin, shown: shown.length });
  const selected = shown.find((m) => m.id === selectedId) ?? null;

  // Counts are computed with each tag applied on top of the others, so a chip says how many
  // markets you would actually get rather than how many exist in the abstract.
  const counts = Object.fromEntries(
    MARKET_TAGS.map((t) => {
      const withTag = filterByTags(found, [...tags.filter((x) => x !== t), t]);
      // `🕒 OPEN NOW` is part of "everything else already applied", exactly as it is on the
      // list: leaving it out lets a chip read two over a map showing nothing, which is the one
      // thing a count on a filter must never do.
      return [t, openNow ? withTag.filter((m) => isOpenNow(m, now)).length : withTag.length];
    })
  ) as Record<MarketTag, number>;

  // Which chips exist at all — measured against the whole loaded dataset, never against the
  // current view. See `availableTags`; the distinction is the entire design of this.
  const available = useMemo(() => availableTags(markets, country), [markets, country]);

  // Where the shopper last said they were, and the only camera state there is. Held past the
  // press that produced it because the frame it justifies has to survive a filter change.
  const [here, setHere] = useState<LatLon | null>(null);

  // Locating and then zooming to a fixed level answered "where am I" and left the question the
  // screen exists for — where do I go — off the edge of the map, because the nearest market is
  // however far away it is. So frame an area instead, and let it choose the zoom.
  /**
   * The camera, in state because both map files ask for exactly that: "the caller must hold
   * `bounds` in state and hand over a new array per fit", since they re-fit on the array's
   * *identity* rather than on the four numbers inside it. That identity is also the only way
   * to say **"leave the camera alone"** — holding still means handing back the same object,
   * not an equal one, which a value recomputed each render cannot do.
   */
  const [camera, setCamera] = useState<{
    center: LatLon;
    zoom: number;
    bounds: Bounds | undefined;
  }>({
    center: defaultCenterFor(country),
    zoom: 3.5,
    // Fitted to the country, not parked in the middle of it. `bounds` outranks `center`/`zoom`
    // on both map files, so the centre below is only what a map without a box would use.
    bounds: boundsForCountry(country),
  });

  /**
   * Refitted by comparing against the last inputs *during* render — React's documented way to
   * adjust state when its inputs change, and the only shape the two lint rules here leave
   * open. Both rules are right, which is why this is not a workaround for them:
   *
   * - A ref holding the last frame is forbidden by `react-hooks/refs`. A ref read during
   *   render is a value React is free not to re-render for, so the map could keep a frame the
   *   filters had already moved past.
   * - `setCamera` inside an effect is forbidden by `react-hooks/set-state-in-effect`. It would
   *   fit the camera a render late — the map paints the old frame, then jumps.
   *
   * Setting state during render on a changed input is neither. React re-runs this component
   * immediately, before committing or painting, so no stale frame ever reaches the map.
   *
   * It was previously derived with `useMemo`, which was nearly right and wrong in one place:
   * a memo has no way to return the previous frame, so it could not hold still.
   */
  const [lastInputs, setLastInputs] = useState({
    shown,
    here,
    on: near.on,
    miles: near.radius,
    origin: near.origin,
    country,
  });
  // The origin by value and not by identity: `useNearMe` hands back `location ?? fix`, and the
  // located half is a fresh object on a re-render even when the reader has not moved a step.
  const nearChanged =
    lastInputs.on !== near.on ||
    lastInputs.miles !== near.radius ||
    lastInputs.origin?.lat !== near.origin?.lat ||
    lastInputs.origin?.lon !== near.origin?.lon;
  const countryChanged = lastInputs.country !== country;
  if (nearChanged || countryChanged || lastInputs.shown !== shown || lastInputs.here !== here) {
    setLastInputs({ shown, here, on: near.on, miles: near.radius, origin: near.origin, country });

    /**
     * Four rules, in order, and the order is the specification.
     *
     * **1. `📍 NEAR ME` frames the radius it searched**, not the markets it found — framing the
     * results would zoom to whatever happens to be nearby, so two markets a street apart
     * would fill the screen and hide that the filter looked twenty-five miles out. First
     * because the reader asked about distance from themselves, and the answer is the area
     * rather than its contents.
     *
     * **2. Nothing matched: do not move.** Falling through without setting the camera leaves
     * `bounds` and `center` identical, so neither map effect fires — both re-fit on the
     * `bounds` array's identity. A filter that empties the list must not also throw the camera
     * somewhere: the reader's next act is to undo it, and they need the map still showing
     * where they were.
     *
     * **3. A *new* place brings the reader and the nearest market on together.** `NEAR` mode
     * geocodes a town and uses it as an origin without narrowing anything, so the shown set is
     * whatever it already was — fitting that would answer "Portland" with a box round every
     * market in the country. What somebody who typed a place wants to see is the place and the
     * closest thing to it, which is the frame this screen has always drawn for that gesture.
     * Only on the press that changes `here`: afterwards the filters take over, or a tag would
     * drag the camera back to the town each time.
     *
     * **4. Otherwise fit what is shown**, which is every filter interaction. The bug this
     * fixes: the bounds were only ever computed when `here` was set, so with no location and
     * no place search the camera never re-fitted at all. Selecting `producer-owned` narrowed
     * the list to two markets in Athens, Georgia while the map sat wherever it had last been
     * panned, showing an empty patch of country beside a panel claiming two results.
     *
     * This one fits the **markets** and not the markets plus the reader — that is the whole
     * difference between it and rule 3. A filter asks "where are these"; including the reader's
     * own point would zoom out to span the distance to them and shrink two adjacent markets to
     * a speck to make room for somewhere they already know they are.
     */
    if (near.on && near.origin && near.radius) {
      // Only when the radius filter itself changed. With it on, a tag press must not re-assert
      // the frame: the values would be identical but the array would be new, so the map would
      // ease back to the radius and undo any panning the reader had done inside it — the
      // "fights the user for the camera" failure the map conventions name.
      if (nearChanged) {
        setCamera({
          center: near.origin,
          zoom: 11,
          bounds: boundsForRadius(near.origin, near.radius, near.unit),
        });
      }
    } else if (countryChanged) {
      /**
       * Saying which country you are in is an explicit act, like typing a place, so it reframes
       * — and it has to, because the dataset now spans an ocean. Without this the reader
       * switched to the United Kingdom and kept looking at Kansas, and their next filter press
       * would have fitted all sixty-nine markets: a box from California to Oldham, which shows
       * the Atlantic and neither country.
       */
      setCamera({
        center: defaultCenterFor(country),
        zoom: 3.5,
        bounds: boundsForCountry(country),
      });
    } else if (shown.length === 0) {
      // Rule 2: hold still. Explicit rather than a fall-through, so that adding a rule below
      // cannot accidentally move the camera on an empty result.
    } else if (here && lastInputs.here !== here) {
      const nearest = sortByDistance(shown, here)[0];
      setCamera({
        center: here,
        zoom: 11,
        bounds: nearest
          ? (boundsAround([here, { lat: nearest.lat, lon: nearest.lon }]) ?? undefined)
          : undefined,
      });
    } else {
      setCamera({
        center: here ?? defaultCenterFor(country),
        zoom: 11,
        bounds: boundsAround(shown.map((m) => ({ lat: m.lat, lon: m.lon }))) ?? undefined,
      });
    }
  }


  /**
   * Place search, and it is small because the camera was already built for it: `here` is
   * simply the point the map frames from, and nothing in `camera` cares whether the device
   * supplied it or somebody typed it. Framing the place together with the nearest market is
   * the same answer `📍 NEAR ME` gives — "where do I go", not just "where is this".
   *
   * A fresh object every press, because the camera re-fits on this value's identity: asking
   * for the same town twice should re-frame rather than sit still.
   */
  /**
   * Three seconds after you arrive on this screen, and then for as long as you stay without
   * touching anything in the dock.
   *
   * **`useFocusEffect` and not `useEffect`**, which is the fix for the way this failed
   * before. Both tabs stay mounted, so a plain effect started its timer the moment the app
   * did: the hint fired three seconds into the session whether or not the map was the screen
   * you were looking at, and being one burst, that was the only time it ever fired. Open the
   * app, glance at the list first, come back — and there had never been anything to see.
   * Tied to focus, the three seconds start when the map does, and leaving the screen stops
   * the pulse rather than letting it run unseen on another tab.
   *
   * "Inactivity" is read narrowly and on purpose: the timer is cancelled by a press on
   * anything in the dock — the disc, `📍 NEAR ME`, a marker — and **not** by panning or
   * zooming the map. Those gestures live inside MapLibre on both platforms and surfacing
   * them would mean threading a callback through both halves of the platform-split map
   * component, which is a large change to make a hint slightly politer.
   *
   * It is `setTimeout` and not an animation delay because the decision is "has anything
   * happened yet", which is a question about the screen rather than about the control. The
   * control is told to pulse; it is not left to work out when.
   */
  useFocusEffect(
    useCallback(() => {
      if (hintSpent) return;
      const timer = setTimeout(() => setHintShown(true), HINT_AFTER_MS);
      return () => {
        clearTimeout(timer);
        setHintShown(false);
      };
    }, [hintSpent])
  );

  async function findPlace() {
    setFinding(true);
    setNotice(null);
    const result = await geocode(query, {
      near: location ?? undefined,
      // Only used when there is no location: a reader who declined permission and typed an
      // English town would otherwise be filtered to American results and told nothing matched.
      country,
    });
    setFinding(false);
    if (result.ok) {
      setHere({ lat: result.lat, lon: result.lon });
      setQuery(result.label);
    } else {
      setNotice(PLACE_MESSAGES[result.reason]);
    }
  }

  return (
    <View role="main" style={styles.container}>
      <PageTitle title="Fresh Food Map" description="Find farmers markets near you on a map." />

      {/* The screen's plaque and its live region. Before the map in source order, along with
          the dock below, so neither sits behind the canvas, every marker and three
          NavigationControl buttons. zIndex is required rather than defensive:
          react-native-web gives View position:relative;zIndex:0 and .maplibregl-map is
          itself positioned, so the map would otherwise paint straight over these. */}
      <View style={[styles.controls, { top: insets.top + Spacing.three }]}>
        {/* The band is a row now: the plaque at one end, the gear at the other. The gear is
            a *sibling* of the wordmark and never the wordmark itself — the plaque is this
            screen's only heading, and a heading that is also a button is neither. */}
        <View style={styles.topRow} pointerEvents="box-none">
          <Wordmark asHeading floating />
          <SettingsButton onPress={() => setSettingsOpen(true)} expanded={settingsOpen} />
        </View>
        <SettingsDialog open={settingsOpen} onClose={() => setSettingsOpen(false)} />

        {/* Two things with nowhere visible to live on a map, and deliberately **two** regions
            rather than one node holding both strings. `role="status"` carries an implicit
            `aria-atomic="true"`, so a region is re-read whole on any change to it — put the
            staleness note in with the count and it is spoken again on every chip press, for
            as long as the refresh stays broken. Two regions change independently. (Setting
            `aria-atomic` to false is not the escape: react-native-web 0.21.2 drops the
            attribute entirely, so the implicit value is the only one there is.)

            The count first, and it cannot live in the card that draws it: a live region has
            to be mounted before its text changes to be announced at all, and that card is
            unmounted whenever it is shut. The number moves while it is shut, too — the
            runtime refetch changes `markets`, and the tags and query are shared with the list.
            The staleness note has no visible surface at all — the map has no text and no room
            for any.

            Off-screen rather than hidden: display:none or aria-hidden would take them out of
            the accessibility tree along with the pixels. Both mounted unconditionally,
            because a live region inserted along with its text does not reliably announce. */}
        <ThemedText
          type="small"
          style={styles.srOnly}
          role="status"
          aria-live="polite"
          accessibilityLiveRegion="polite">
          {`${shown.length} of ${markets.length} ${markets.length === 1 ? 'market' : 'markets'} shown`}
        </ThemedText>
        <ThemedText
          type="small"
          style={styles.srOnly}
          role="status"
          aria-live="polite"
          accessibilityLiveRegion="polite">
          {refreshFailed ? 'Showing the built-in list — could not load the latest markets.' : ''}
        </ThemedText>
        {/* A third region, for the summary card. Mounted here with the other two and for the
            same reason — a live region inserted along with its text does not reliably announce,
            and this one's text arrives exactly when the card does.

            It says only that a card opened and which market it is about; the card itself takes
            focus on the web, so repeating its contents here would be read twice. On native,
            where nothing moves focus, this line is the whole announcement. */}
        <ThemedText
          type="small"
          style={styles.srOnly}
          role="status"
          aria-live="polite"
          accessibilityLiveRegion="polite">
          {selected ? `Showing a summary of ${selected.name}` : ''}
        </ThemedText>
      </View>

      {/* Docked bottom centre, over the List tab, where a thumb reaches the screen's controls
          without crossing it. It follows the wordmark in source order so the keyboard and
          screen-reader order match what the eye sees (WCAG 1.3.2), and still precedes the
          map, which contributes the canvas, every marker and three NavigationControl buttons.
          The dock spans the full width to centre its contents, so it must not eat the pans
          and pinches underneath: box-none lets the map have every touch except its own. */}
      <View style={styles.dock}>
        {/* The same tags the list carries, so neither view can filter to something the other
            cannot reach. On its own surface because the chips would otherwise sit directly on
            map tiles, where their contrast is not knowable.

            Closed to start: four chips and their counts were the first thing over the map,
            and the map is what the screen is for.

            It opens upward, above its button, so the dock grows away from the thumb and the
            button stays under the finger that just pressed it. Source order follows suit and
            puts the panel first, matching what the eye sees top to bottom (WCAG 1.3.2). The
            cost is the tab order: from the button, Tab continues to NEAR ME and the chips sit
            behind it, on Shift+Tab. aria-expanded and aria-controls still tie the two, so the
            relationship is announced even though the panel is not next. */}
        {filtersOpen ? (
          <View
            id={FILTER_PANEL_ID}
            style={[
              styles.filterCard,
              { backgroundColor: theme.background, borderColor: theme.border },
            ]}>
            {/* First in the card, as on the list — the same control in the same place on
                both screens. The card sits above the disc here rather than below it, so
                first-in-source is the card's top edge and furthest from the thumb; that is
                the cost of one habit over two, and the chips it pushes down are the things
                you reach for less. */}
            <MarketSearch
              value={query}
              onChange={(next) => {
                setQuery(next);
                setNotice(null);
              }}
              nativeID="map-search"
              mode={mode}
              onModeChange={(next) => {
                setMode(next);
                setNotice(null);
              }}
              onSubmit={findPlace}
              busy={finding}
            />
            {/* The map has no status line of its own, so a failed lookup says so here, under
                the field that failed. Mounted only when there is something to say: unlike the
                list's line this is not a live region doing double duty, and an empty node
                inside a card that sizes to its content would add a gap for nothing. */}
            {notice && (
              <ThemedText type="small" role="status" aria-live="polite" style={{ color: theme.danger }}>
                {notice}
              </ThemedText>
            )}
            {/* Two jobs in one card, and the card had nothing saying where one ended. The
                search box and its NAME/NEAR control answer "which market"; the chips answer
                "what kind" — reading straight down, the mode radios and the tag chips are
                both small bordered words in a row, and the eye grouped them.

                A rule was the first answer and drew only the boundary. The box draws the
                thing: a line between two blocks says "these are apart", an edge around one
                says "this is a group", and it is the second that was actually missing —
                four chips in a panel with a search field are a set, and nothing said so.
                Square corners on purpose. Every rounded thing in this card is something you
                press — the pills, the chips, the field — so a rounded box would read as the
                largest button on the screen. Corners are the cheapest way to say "this is a
                container, not a control".

                **Not `aria-hidden`, and the rule it replaced was.** That difference is the
                whole reason this comment is long. A divider is a leaf: hiding it hides one
                meaningless node. This is a *wrapper*, and `aria-hidden` on a wrapper hides
                everything inside it — carried over from the rule, it took all four tag chips
                out of the accessibility tree while leaving them in the DOM, on both screens.
                It survived an axe run, but only because the run printed violations: hiding
                content is not one, and what axe actually returns for this is an **incomplete**
                — `aria-hidden-focus`, raised because the chips are focusable — which a
                violations-only report drops on the floor. The role engine shows it outright.
                A bare `View` with no role and no text of its own already contributes nothing
                to announce, so there was never anything here to hide. */}
            <View style={[styles.filterBox, { borderColor: theme.tint }]}>
              {/* `wrap`, not `stack`: stack stretched every chip to the card, which since the
                  card gained a search field means a short word in a 260 pt banner. Word-width
                  chips that break to the next line also spend less height, and height is what
                  a dock over a map is actually short of. */}
              {/* `🕒 OPEN NOW` first in the row, the same control the list carries and now
                  reading the same shared state — turn it on here and the list agrees, which is
                  the whole premise of `useFilters`. It was list-only until the map had a panel
                  to put it in; the reason it stayed behind was that a pin filtered by
                  something with no control on this screen is a filter nobody can see or
                  unset. */}
              <TagFilter
                selected={tags}
                onChange={setTags}
                counts={counts}
                available={available}
                leading={[
                  <OpenNowToggle key="open-now" value={openNow} onChange={setOpenNow} />,
                  <NearMeToggle
                    key="near-me"
                    value={near.on}
                    /**
                     * Turning it on puts the card away, which no other chip in this row does.
                     *
                     * The difference is what the press is *about*. A tag narrows the set you
                     * are already looking at, so the panel stays open for the next one — the
                     * reader is still choosing. `📍 NEAR ME` re-frames the camera on the
                     * radius it searched, and that is an answer rather than a refinement: the
                     * card sits over the middle of the map, so holding it open leaves the
                     * reader looking at a panel instead of the thing the press just drew.
                     *
                     * Only on the way *on*. Switching it off restores the wider set without
                     * moving the camera, so there is nothing new to look at and closing the
                     * panel would just be a control that vanishes when you use it.
                     */
                    onChange={async (next) => {
                      await near.toggle(next);
                      if (next) setFiltersOpen(false);
                    }}
                    radiusInForce={near.radius}
                    unit={near.unit}
                  />,
                ]}
                layout="wrap"
              />
            </View>

            {/* Last in the card, under the chips, because it reports on everything above it —
                the search and every chip. A pin vanishing from a map is silent in a way a row
                leaving a list is not, so this is the only place the map says how much of the
                dataset you are actually looking at.

                Centred, and in words. `15` alone needed the card around it to mean anything;
                `15 markets` is a sentence fragment that survives being read on its own, which
                is what lets it sit under a box rather than beside the thing it describes.

                Paint. The spoken form is the live region at the top of the screen, and the
                reason it is up there rather than in here is not the list's reason — this
                screen has no `🕒 OPEN NOW`, and every control that narrows the map sits
                inside this card. It is the mounting rule: a live region inserted at the same
                moment as its text is not reliably announced, so it has to exist before the
                card does. The number also moves while the card is shut — `markets` changes
                when the runtime refetch lands, and the tags and query are shared with the
                list through `useFilters`, so a chip pressed on the other tab has already
                changed this figure by the time anybody opens the card to read it. */}
            <ThemedText
              type="small"
              themeColor="textSecondary"
              style={styles.cardCount}
              aria-hidden={true}
              accessibilityElementsHidden
              importantForAccessibility="no-hide-descendants">
              {/* The figure in the face the list's heading uses, the word beside it left in
                  the body font — the same pair the list's panel draws, so the two counts read
                  alike. Not the wordmark's face, which is Fraunces *Italic* at 16: this
                  screen has no display heading of its own, which is exactly why it borrows
                  the other screen's. */}
              <Text style={styles.cardCountFigure}>{shown.length}</Text>{' '}
              {shown.length === 1 ? 'market' : 'markets'}
            </ThemedText>
            {/* Directly under the count, because the count is the thing it explains: the
                figure says nothing is here and this says where something is. Inside the card
                rather than floating over the map, since `📍 NEAR ME` is in this card too —
                the offer sits where the press that provoked it was made. */}
            {offer ? (
              <CountryOffer country={offer.country} count={offer.count} onSwitch={setCountry} />
            ) : null}
          </View>
        ) : null}

        <FilterToggle
          floating
          expanded={filtersOpen}
          activeCount={activeCount}
          controls={FILTER_PANEL_ID}
          // `hintSpent` gates as well as `hintShown` so the ring stops the instant the disc
          // is pressed, rather than pulsing on over a panel somebody has already opened.
          highlight={hintShown && !hintSpent}
          onPress={() => {
            setHintSpent(true);
            // Opening the filters puts the summary away. The two answer different questions —
            // "which markets" and "what is this one" — and the second is about a pin that may
            // not survive the first.
            setSelectedId(null);
            setFiltersOpen((open) => !open);
          }}
        />
      </View>

      <MarketMap
        markets={shown}
        center={camera.center}
        zoom={camera.zoom}
        bounds={camera.bounds}
        // A press summarises rather than navigates. The map is the expensive thing on this
        // screen to get back to — a camera somebody framed, a filter somebody set — and
        // leaving it to read a name and three opening days was a poor trade. `VIEW DETAILS` in
        // the card is the same push this used to do.
        //
        // Pressing the same pin again puts the card away. A pin is the only handle the card
        // has on the map, so the thing that opened it is the thing a reader reaches for to
        // close it — and the alternative, a press that re-opens what is already open, does
        // nothing visible and reads as an unresponsive control.
        onSelectMarket={(id) => {
          setHintSpent(true);
          setFiltersOpen(false);
          setSelectedId((current) => (current === id ? null : id));
        }}
        // The card is drawn by the map, anchored to the pin it describes — but *which* market
        // is selected stays here, because it has to survive a filter change and the map's own
        // state does not. `selected` is resolved against `shown` above, so a market the filters
        // exclude takes its card with it.
        selected={selected}
        onCloseSelected={() => setSelectedId(null)}
        onOpenDetails={(id) => router.push(`/market/${id}`)}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  // A row, so the plaque and the gear sit at opposite ends of the band.
  topRow: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between' },
  controls: {
    position: 'absolute',
    zIndex: 1,
    left: Spacing.three,
    right: Spacing.three,
    gap: Spacing.two,
    // Same reason as the dock: this container is as wide as the screen but only the wordmark
    // inside it is meant to be touchable, and without box-none it swallowed every pan and
    // pinch in a full-width band across the top of the map.
    pointerEvents: 'box-none',
  },
  // The scene is laid out above the tab bar, which already carries the bottom safe-area
  // inset, so this offset is measured from the tab bar's top edge and needs no inset of
  // its own.
  /**
   * The dock: the filter disc and the panel it opens, anchored bottom centre.
   *
   * It was `nearMeDock` and held two controls — the disc and a `📍 NEAR ME` button that moved
   * the camera. That button is a filter chip now, sitting with `🕒 OPEN NOW` inside the panel,
   * so the dock is one control deep and the name no longer describes it.
   */
  dock: {
    position: 'absolute',
    zIndex: 1,
    left: Spacing.three,
    right: Spacing.three,
    bottom: Spacing.three,
    alignItems: 'center',
    gap: Spacing.two,
    pointerEvents: 'box-none',
  },
  chip: {
    borderRadius: Radii.pill,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two + Spacing.half,
    ...Elevation.floating,
  },
  chipLabel: { fontSize: 11, fontWeight: '700', letterSpacing: 1.2 },
  filterCard: {
    borderRadius: Radii.card,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: Spacing.two,
    paddingVertical: Spacing.two,
    gap: Spacing.two,
    // Sized to its chips once; a search field needs more than the widest of them, so it has
    // a floor now and still shrinks before it overflows the dock.
    alignSelf: 'center',
    minWidth: 260,
    maxWidth: '100%',
    flexShrink: 1,
    ...Elevation.floating,
  },
  // `alignSelf: 'stretch'` so the box spans exactly what the rule it replaces did: the
  // card's content width, inside the card's own padding rather than bleeding to its edge.
  //
  // `borderRadius: 0` is written out rather than left to the default, because in this file
  // the default is the thing to argue with: every other bordered box here is round, and a
  // reader skimming for a missing radius should find the decision instead of an omission.
  //
  // Not hairline. On a card that already draws a hairline border, a sub-pixel edge inside it
  // reads as a rendering artefact rather than a drawn box; at 1 it is deliberate.
  filterBox: {
    alignSelf: 'stretch',
    borderWidth: 1,
    borderRadius: 0,
    padding: Spacing.two,
    // On top of the card's own `gap`, so the search block and its radios end and the chips
    // begin with a clear beat between them rather than the same 8 pt that separates a field
    // from the pills belonging to it. The list's panel carries the same.
    //
    // Written as the 4 it started at plus the 10 it grew by, rather than collapsed to 14:
    // this is the gap that closed the search and opened the filters, and it was widened
    // deliberately after living at 12 for a while. 8 from the card and 14 from here is 22.
    marginTop: Spacing.one + Spacing.two + Spacing.half,
  },
  // Centred under a box that is itself the width of the card. Left-aligned it hung off the
  // corner of the box above it and read as a caption on the chips rather than a total for
  // everything in the card.
  cardCount: { alignSelf: 'center' },
  // `Display.black` is the face the list's heading is set in (§3's `display` row) — not the
  // wordmark's, which is `Display.italic`. 15 against the 14 of the `small` text beside it:
  // one point up, because Fraunces runs smaller than the system face at a shared nominal
  // size and matching the number exactly reads as a figure slightly too quiet.
  cardCountFigure: { fontFamily: Display.black, fontSize: 15 },
  // Available to a screen reader, absent from the layout. Not display:none and not
  // aria-hidden — either would remove it from the accessibility tree along with the pixels.
  srOnly: { position: 'absolute', left: -9999, width: 1, height: 1, overflow: 'hidden' },
});
