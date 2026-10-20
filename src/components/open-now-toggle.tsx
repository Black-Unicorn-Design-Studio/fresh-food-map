import { Pressable, StyleSheet, Text, type StyleProp, type ViewStyle } from 'react-native';

import { Radii, Spacing } from '@/constants/theme';
import { spaceToPress } from '@/lib/a11y';
import { useTheme } from '@/hooks/use-theme';

/**
 * `🕒 OPEN NOW` — the one filter that asks about the clock rather than about a kind of market.
 *
 * One component because both screens carry it now, and a chip that is a hairline kraft pill on
 * one surface and a bordered green one on the other is two controls wearing one name. It is
 * handed to `TagFilter` through its `leading` slot, so it sits first in the same wrapping row
 * as the tags and shares their sizing.
 *
 * **The border is `highlight` whether it is on or off** — neon purple, not the app's own
 * `tint`. **An edge in this row is identity and never state**: every chip keeps its own colour
 * on and off alike, so the border says *what kind of filter this is* and never whether it is
 * running. What sets this one apart is simply that its colour is nobody else's.
 *
 * It was neon *green* until the row grew a third edge colour and the green stopped doing its
 * job. The old arrangement had this chip and `📍 NEAR ME` sharing the neon to say "we both
 * filter by something about you" — a fair argument that cost more than it bought, because two
 * chips wearing one colour beside four wearing another reads as two groups rather than as two
 * questions. Each of the three now has its own: `tint` for the tags, `locator` for the pin,
 * this for the clock. Nothing else in the app wears this colour.
 *
 * State is carried where every chip carries it — the fill and the label colour, plus `checked`
 * on a `switch` — so nothing rests on this border. That matters more than usual here: neon on
 * the white chip fill measures 1.36:1, which is a colour you can see and not an edge you could
 * rely on.
 *
 * A full border at 1, which the tag chips now match — they were a hairline until this switch
 * joined the row and made them look disabled beside it. What distinguishes this chip is the
 * colour alone, and it needs the full weight to carry: at a hairline this green is a grey
 * suggestion at arm's length.
 */
export function OpenNowToggle({
  value,
  onChange,
  style,
}: {
  value: boolean;
  onChange: (next: boolean) => void;
  /** Sizing from `TagFilter` when it lays the row out as a grid. */
  style?: StyleProp<ViewStyle>;
}) {
  const theme = useTheme();
  const toggle = () => onChange(!value);
  return (
    <Pressable
      accessibilityRole="switch"
      accessibilityState={{ checked: value }}
      aria-checked={value}
      accessibilityLabel="Open now"
      onPress={toggle}
      // Space is an activation key on a switch per ARIA, and react-native-web only honours it
      // for buttons — see `spaceToPress`.
      {...spaceToPress(toggle)}
      style={[
        styles.chip,
        {
          backgroundColor: value ? theme.backgroundSelected : theme.backgroundElement,
          borderColor: theme.highlight,
        },
        style,
      ]}>
      <Text style={[styles.label, { color: value ? theme.tint : theme.textSecondary }]}>
        🕒 OPEN NOW
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  // The tag chips' metrics to the number (`tag-filter.tsx`), because this stands in a row with
  // them and a pill a pixel taller than its neighbours reads as a mistake. Identical now,
  // border weight included — the tags moved to 1 when they took their own `tint` edge, so the
  // only thing setting this chip apart is the colour.
  chip: {
    borderRadius: Radii.pill,
    borderWidth: 1,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
  },
  label: { fontSize: 11, fontWeight: '700', letterSpacing: 1.2 },
});
