import { Pressable, StyleSheet } from 'react-native';
import Animated, { FadeInDown } from 'react-native-reanimated';

import { ThemedText } from '@/components/themed-text';
import { WeekStrip } from '@/components/week-strip';
import { Display, Radii, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { formatDistance, haversineKm, type LatLon } from '@/lib/geo';
import { COUNTRY_UNITS } from '@/constants/countries';
import { useSettings } from '@/hooks/use-settings';
import { type Market } from '@/lib/markets';

interface Props {
  market: Market;
  /** When set, a distance line is shown. */
  from?: LatLon | null;
  /** Position in the list — drives the staggered entrance. */
  index?: number;
  onPress: () => void;
}

export function MarketCard({ market, from, index = 0, onPress }: Props) {
  const theme = useTheme();
  const { country } = useSettings();
  // The overline's distance is in the reader's own unit, like the `📍 NEAR ME` chip's radius:
  // a list that said `3.1 mi` beside a chip saying `WITHIN 40 KM` would be two answers to one
  // question.
  const distance = from ? formatDistance(haversineKm(from, market), COUNTRY_UNITS[country]) : null;
  const town = market.address.split(',').slice(1, 2).join('').trim();

  return (
    <Animated.View entering={FadeInDown.duration(380).delay(Math.min(index * 70, 560))}>
      <Pressable
        onPress={onPress}
        accessibilityRole="button"
        accessibilityLabel={`${market.name}${distance ? `, ${distance} away` : ''}`}
        style={({ pressed }) => [
          styles.card,
          {
            backgroundColor: pressed ? theme.backgroundSelected : theme.backgroundElement,
            borderColor: theme.border,
          },
        ]}>
        <ThemedText type="small" themeColor="textSecondary" style={styles.overline}>
          {distance ? distance.toUpperCase() : town.toUpperCase() || 'FARMERS MARKET'}
        </ThemedText>
        <ThemedText style={styles.name}>{market.name}</ThemedText>
        <WeekStrip schedule={market.schedule} />
      </Pressable>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: Radii.card,
    borderWidth: StyleSheet.hairlineWidth,
    padding: Spacing.three,
    gap: Spacing.two + Spacing.one,
  },
  overline: { letterSpacing: 1.2, fontSize: 11 },
  name: {
    fontFamily: Display.semi,
    fontSize: 22,
    lineHeight: 28,
  },
});
