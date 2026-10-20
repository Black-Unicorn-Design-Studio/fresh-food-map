import { Pressable, StyleSheet, Text, type StyleProp, type ViewStyle } from 'react-native';

import { Radii, Spacing } from '@/constants/theme';
import { radiiFor } from '@/lib/geo';
import { type DistanceUnit } from '@/constants/countries';
import { spaceToPress } from '@/lib/a11y';
import { useTheme } from '@/hooks/use-theme';

/**
 * `📍 NEAR ME` — the second filter that asks about the reader rather than about a kind of
 * market, and the reason `OpenNowToggle` is no longer alone in that.
 *
 * **It used to move the camera, not filter.** It sat in the map's dock and framed the reader
 * with the single closest market, which answered "where is the nearest one" and left the list
 * alone — so the two screens disagreed about what the question was. It narrows now, on both
 * screens, through the same `useFilters` state `🕒 OPEN NOW` uses.
 *
 * **The border is `locator`, the orange-red of the `📍` the chip already carries.** The glyph
 * and the edge around it now agree; before, a green border sat around a red pin and the chip
 * was two colours arguing.
 *
 * It used to wear the neon, shared with `🕒 OPEN NOW`, on the argument that the two of them
 * filter by something about *you* where the tags filter by something about the market — two
 * chips with one edge colour being the row saying so. That is a real observation and the wrong
 * way to draw it: two chips sharing a colour beside four sharing another reads as two *groups*,
 * which invites the question of what the grouping means, where three distinct edges simply
 * read as three kinds of filter. It also freed the neon back to one consumer, which is the
 * state `theme.ts` prefers it in.
 *
 * Deliberately not `danger`: a filter is not an error, and error ink on a chip would be the
 * only false sentence in the row.
 *
 * State is carried where every chip carries it — the fill, the label colour, and `checked` on
 * a `switch`. Nothing rests on the border, which is what keeps a 1.36:1 neon edge acceptable.
 */
export function NearMeToggle({
  value,
  onChange,
  style,
  /**
   * The radius actually in force, when it is not the first one tried. Drawn into the label so
   * the chip cannot claim 25 miles while the filter used 100 — `geo.ts` explains why widening
   * is only acceptable announced, and this is where it gets announced.
   */
  radiusInForce,
  /**
   * Which unit that radius is stated in. Defaulted so the component stays usable on its own,
   * and supplied by both screens from the reader's country.
   */
  unit = 'mi',
}: {
  value: boolean;
  onChange: (next: boolean) => void;
  style?: StyleProp<ViewStyle>;
  radiusInForce?: number | null;
  unit?: DistanceUnit;
}) {
  const theme = useTheme();
  const toggle = () => onChange(!value);
  const [first] = radiiFor(unit);
  const widened = value && radiusInForce != null && radiusInForce !== first;
  // `MI` and `KM` are the drawn forms; the spoken name below says the word, because a screen
  // reader announcing "em eye" is not a distance anyone recognises.
  const label = widened ? `📍 WITHIN ${radiusInForce} ${unit.toUpperCase()}` : '📍 NEAR ME';
  const spokenUnit = unit === 'km' ? 'kilometres' : 'miles';

  return (
    <Pressable
      accessibilityRole="switch"
      accessibilityState={{ checked: value }}
      aria-checked={value}
      // The radius is in the spoken name whether or not it is drawn, because "near me" is not
      // a distance and somebody deciding whether to trust the list needs the number.
      accessibilityLabel={`Near me, within ${radiusInForce ?? first} ${spokenUnit}`}
      onPress={toggle}
      {...spaceToPress(toggle)}
      style={[
        styles.chip,
        {
          backgroundColor: value ? theme.backgroundSelected : theme.backgroundElement,
          borderColor: theme.locator,
        },
        style,
      ]}>
      <Text style={[styles.label, { color: value ? theme.tint : theme.textSecondary }]}>
        {label}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  // The tag chips' and `OpenNowToggle`'s metrics to the number: these stand in one row and a
  // pill a pixel taller than its neighbours reads as a mistake.
  chip: {
    borderRadius: Radii.pill,
    borderWidth: 1,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
  },
  label: { fontSize: 11, fontWeight: '700', letterSpacing: 1.2 },
});
