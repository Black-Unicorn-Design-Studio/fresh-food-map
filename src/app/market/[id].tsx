import { useState } from 'react';
import { useLocalSearchParams } from 'expo-router';
import { Linking, Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import Animated, { FadeInDown } from 'react-native-reanimated';

import { ExternalLink } from '@/components/external-link';
import { PageTitle } from '@/components/page-title';
import { ThemedText } from '@/components/themed-text';
import { TagInfoButton, TagInfoPanel } from '@/components/tag-info';
import { WeekStrip } from '@/components/week-strip';
import { reportUrl } from '@/constants/source';
import { TAG_LABELS, type MarketTag } from '@/constants/tags';
import { Display, MaxContentWidth, Radii, Spacing } from '@/constants/theme';
import { useFocusHeading } from '@/hooks/use-focus-heading';
import { useTheme } from '@/hooks/use-theme';
import { bundledMarketIds, formatSeason, useMarkets, type Market } from '@/lib/markets';

/**
 * Pre-renders one page per market instead of a single `market/[id].html` shell.
 *
 * Without this Expo exports the route once with the segment unsubstituted, so every deep
 * link served that file and rendered the *not found* branch on the server: `useLocalSearchParams`
 * returned the literal string `[id]`, nothing matched, and the pre-hydration page said
 * "Couldn't find that market" under the title "Market not found". The client then resolved
 * the real id from `window.location` and rendered something different, which is React
 * hydration error #418 on every detail page — and which is what a crawler, a link preview,
 * or anyone without JavaScript actually got.
 *
 * The Caddyfile is already written for this: `try_files` runs before the `[id].html`
 * rewrite, so real files win with no server change.
 */
export function generateStaticParams(): { id: string }[] {
  return bundledMarketIds().map((id) => ({ id }));
}

const DAY_LABELS: Record<string, string> = {
  mon: 'Monday', tue: 'Tuesday', wed: 'Wednesday', thu: 'Thursday',
  fri: 'Friday', sat: 'Saturday', sun: 'Sunday',
};

function directionsUrl(m: Market): string {
  const label = encodeURIComponent(m.name);
  if (Platform.OS === 'ios') return `maps:?q=${label}&ll=${m.lat},${m.lon}`;
  if (Platform.OS === 'android') return `geo:${m.lat},${m.lon}?q=${m.lat},${m.lon}(${label})`;
  return `https://www.openstreetmap.org/?mlat=${m.lat}&mlon=${m.lon}#map=17/${m.lat}/${m.lon}`;
}

export default function MarketDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const theme = useTheme();
  const { markets, isLoading } = useMarkets();
  const headingRef = useFocusHeading();
  /**
   * Which tag's explanation is open. One at a time, as in the filter panel: a market with
   * four tags could otherwise open four paragraphs above its own address.
   */
  const [explaining, setExplaining] = useState<MarketTag | null>(null);
  const market = markets.find((m) => m.id === id);

  if (!market) {
    return (
      <View style={[styles.missing, { backgroundColor: theme.background }]}>
        {/* This branch is what a shared /market/<id> link renders first, so it needs a
            title of its own rather than inheriting whatever was in the tab before. */}
        <PageTitle
          title={isLoading ? 'Loading… — Fresh Food Map' : 'Market not found — Fresh Food Map'}
          description="A farmers market listing on Fresh Food Map."
        />
        <ThemedText themeColor="textSecondary">
          {isLoading ? 'Loading…' : "Couldn't find that market."}
        </ThemedText>
      </View>
    );
  }

  return (
    <ScrollView
      role="main"
      style={{ backgroundColor: theme.background }}
      contentContainerStyle={styles.content}>
      {/* No `Stack.Screen` here. The navigation bar's title is a constant and lives in
          `src/app/_layout.tsx` with the rest of the stack — setting it here as well would
          be a second copy, and the not-found branch above would not get it.

          The *document* title does keep the market's name, and that is not the duplication
          it looks like: it is never on screen beside the heading. `PageTitle` renders
          nothing off the web, and on the web it names the browser tab, the bookmark, the
          history entry and what a screen reader announces on arrival — exactly the places
          where sixty-one pages all called "Fresh Food Map" would be sixty-one
          indistinguishable entries (WCAG 2.4.2, which is the reason `PageTitle` exists at
          all; see its docstring). So the chrome loses the name and the document keeps it. */}
      <PageTitle
        title={`${market.name} — Fresh Food Map`}
        description={`Opening days, season and location for ${market.name}.`}
      />

      <Animated.View entering={FadeInDown.duration(360)} style={styles.header}>
        <ThemedText
          ref={headingRef}
          tabIndex={-1}
          style={styles.name}
          accessibilityRole="header"
          aria-level={2}>
          {market.name}
        </ThemedText>
        {/* Each tag with its explanation an `ⓘ` away, rather than printed under it.
            The gloss used to sit beside every chip, which made the block as tall as the
            number of tags times two lines and pushed the address — the thing most readers
            open this screen for — below the fold on a phone. What it costs is that the
            meaning is now a press away instead of simply there, which is why the affordance
            is drawn per tag and not hidden behind a hover: see `tag-info.tsx`. */}
        {market.tags.length > 0 && (
          <View style={styles.tags}>
            {market.tags.map((tag) => (
              <View key={tag}>
                <View style={styles.tagRow}>
                  {/* The `ⓘ` sits *inside* the pill, as it does on the filter chips — a
                      control that explains a tag belongs to the tag, and hanging it off the
                      outside reads as a second, unrelated thing beside it.

                      Safe to nest here in a way it is not there: this chip is a plain `View`,
                      not a `Pressable`, so there is no outer press for the inner one to
                      bubble into. The filter chips have to keep the two as siblings under a
                      wrapper for exactly that reason. */}
                  <View
                    style={[
                      styles.tagChip,
                      { backgroundColor: theme.backgroundSelected, borderColor: theme.tint },
                    ]}>
                    <Text style={[styles.tagChipText, { color: theme.tint }]}>
                      {TAG_LABELS[tag]}
                    </Text>
                    <TagInfoButton
                      tag={tag}
                      open={explaining === tag}
                      panelId={`about-${tag}`}
                      onPress={() => setExplaining((cur) => (cur === tag ? null : tag))}
                    />
                  </View>
                </View>
                {explaining === tag ? (
                  <TagInfoPanel
                    tag={tag}
                    panelId={`about-${tag}`}
                    onClose={() => setExplaining(null)}
                  />
                ) : null}
              </View>
            ))}
          </View>
        )}
      </Animated.View>

      <Animated.View entering={FadeInDown.duration(360).delay(90)} style={styles.addressBlock}>
        <ThemedText type="smallBold" themeColor="textSecondary" style={styles.addressLabel}>
          FIND THE STAND
        </ThemedText>
        {/* The address opens the same map as `GET DIRECTIONS` below it. An address is the
            thing people press on every other listing they have ever used, and the button was
            two screens' worth of scrolling away on a long record.

            **Not `ExternalLink`**, which refuses anything that is not `https?://` — a
            security boundary rather than validation theatre, since it takes URLs from the
            dataset. `directionsUrl` builds a `maps:` or `geo:` scheme on native, so it could
            never pass that gate; what makes it safe here is that the URL is *constructed*
            from the record's own numbers rather than taken from a field. Same split as that
            component: `href` on the web, where the URL is an https OpenStreetMap link and the
            press responder would otherwise navigate twice, and `Linking.openURL` on native.

            Underlined, because link identity cannot rest on hue alone (WCAG 1.4.1). */}
        <Pressable
          accessibilityRole="link"
          accessibilityLabel={`${market.address} — open in maps`}
          {...(Platform.OS === 'web'
            ? ({
                href: directionsUrl(market),
                hrefAttrs: { target: '_blank', rel: 'noreferrer noopener' },
              } as object)
            : {})}
          onPress={
            Platform.OS === 'web' ? undefined : () => Linking.openURL(directionsUrl(market))
          }>
          <ThemedText themeColor="link" style={styles.addressLink}>
            {market.address}
          </ThemedText>
        </Pressable>
      </Animated.View>

      <Animated.View
        entering={FadeInDown.duration(360).delay(180)}
        style={[styles.card, { backgroundColor: theme.backgroundElement, borderColor: theme.border }]}>
        <WeekStrip schedule={market.schedule} size={30} />
        {market.schedule.length > 0 ? (
          market.schedule.map((s) => (
            <View key={`${s.day}-${s.open}`} style={styles.hoursRow}>
              <ThemedText type="smallBold">{DAY_LABELS[s.day]}</ThemedText>
              <ThemedText style={styles.hours}>
                {s.open}–{s.close}
              </ThemedText>
            </View>
          ))
        ) : (
          <ThemedText type="small" themeColor="textSecondary">
            Hours not listed yet.
          </ThemedText>
        )}
        <Text style={[styles.season, { color: theme.textSecondary }]}>
          {formatSeason(market)}
        </Text>
      </Animated.View>

      {/* `GET DIRECTIONS` used to lead this block and is gone. The address above it is a link
          to the same map, and an address is what people press on every other listing they
          have used — so the button was a second control to one destination, taking the
          strongest styling on the screen for a job already done a scroll higher.

          What remains is the website, which now wears the filled `tint` the directions button
          had. It is the only action left, and an outlined lone button reads as the secondary
          half of a pair whose other half is missing. */}
      <Animated.View entering={FadeInDown.duration(360).delay(260)} style={styles.actions}>
        {/* The scheme is checked before the control exists at all, not just before `href` is
            set. Gating only `href` left the native branch handing whatever the record held
            straight to `Linking.openURL`, which — contrary to what this comment used to
            claim — does not refuse unknown schemes: it asks the OS to dispatch them, so a
            `tel:`, `sms:` or `intent://` value in the dataset became a one-tap app launch.
            Failing the check now renders nothing, rather than a button that looks live and
            does nothing on web while doing something on a phone.

            `https:` only, matching the schema (`website` is `.startsWith('https://')`), so
            this is the same rule CI and the intake service already enforce rather than a
            second, looser one. */}
        {market.website && /^https:\/\//i.test(market.website) && (
          <Pressable
            accessibilityRole="link"
            accessibilityLabel="Visit website (opens in a new tab)"
            {...({
              href: market.website,
              hrefAttrs: { target: '_blank', rel: 'noreferrer noopener' },
            } as object)}
            onPress={Platform.OS === 'web' ? undefined : () => Linking.openURL(market.website!)}
            style={[styles.button, { backgroundColor: theme.tint }]}>
            <Text style={[styles.buttonLabel, { color: theme.background }]}>VISIT WEBSITE</Text>
          </Pressable>
        )}
      </Animated.View>

      {/* Last on the screen, and quiet on purpose.

          Every listing here is a fact somebody typed and somebody else merged, and the only
          repair mechanism this design has is a person editing `data/markets.json` — so the
          screen that shows a market has to say where to go when it is wrong. Before this, a
          reader who spotted bad hours had nowhere at all to put that.

          A link and not a button: it leaves the app, it wants a GitHub account, and it is not
          competing with the one filled button on the screen for the same press. `reportUrl` explains why a report
          goes to an issue rather than back through the intake service. */}
      <Animated.View entering={FadeInDown.duration(360).delay(340)} style={styles.report}>
        <ExternalLink url={reportUrl(market)} label="Flag or update this listing" />
      </Animated.View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  content: {
    alignSelf: 'center',
    width: '100%',
    maxWidth: MaxContentWidth,
    padding: Spacing.three,
    gap: Spacing.four,
  },
  missing: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  header: { gap: Spacing.two },
  name: {
    fontFamily: Display.black,
    fontSize: 36,
    lineHeight: 42,
  },
  card: {
    borderRadius: Radii.card,
    borderWidth: StyleSheet.hairlineWidth,
    padding: Spacing.three,
    gap: Spacing.two + Spacing.one,
  },
  hoursRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'baseline',
  },
  hours: { fontVariant: ['tabular-nums'] },
  season: {
    fontFamily: Display.italic,
    fontSize: 16,
  },
  addressBlock: { gap: Spacing.one },
  addressLink: { textDecorationLine: 'underline' },
  tags: { gap: Spacing.two, paddingTop: Spacing.one },
  tagRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two, flexWrap: 'wrap' },
  tagChip: {
    // A row, because it holds the label and the `ⓘ` that explains it.
    flexDirection: 'row',
    alignItems: 'center',
    // Wide enough not to crowd the label, and short enough on the right that the `ⓘ`'s own
    // 24 pt box does not push the pill out — the glyph carries its target with it.
    alignSelf: 'flex-start',
    borderRadius: Radii.pill,
    borderWidth: StyleSheet.hairlineWidth,
    paddingLeft: Spacing.two + Spacing.half,
    paddingRight: Spacing.one,
    paddingVertical: Spacing.one,
  },
  tagChipText: { fontSize: 11, fontWeight: '700', letterSpacing: 1.2 },
  addressLabel: { letterSpacing: 1.5, fontSize: 11 },
  actions: { flexDirection: 'row', gap: Spacing.two, flexWrap: 'wrap' },
  button: {
    borderRadius: Radii.button,
    paddingVertical: Spacing.three,
    paddingHorizontal: Spacing.four,
    alignItems: 'center',
    minHeight: 44,
  },
  // Its own row rather than trailing the buttons: at the end of a flex-wrap row of buttons it
  // sat on the baseline of whatever fitted beside it and read as a third action.
  report: { paddingTop: Spacing.one },
  buttonLabel: { fontSize: 13, fontWeight: '800', letterSpacing: 1.5 },
});
