import { Pressable, StyleSheet } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { COUNTRY_LABELS, type CountryCode } from '@/constants/countries';
import { Radii, Spacing } from '@/constants/theme';
import { spaceToPress } from '@/lib/a11y';
import { useTheme } from '@/hooks/use-theme';

/**
 * `📍 NEAR ME` found nothing here, and the dataset holds markets near you in another country.
 *
 * **The problem it solves is a silence.** Turning the filter on frames the radius it searched
 * and shows no pins, which is the honest result and tells the reader nothing about *why* —
 * and the why is a setting two taps away that they very likely set by accident, or that the
 * device region set for them. Field-tested on the real thing: `📍 NEAR ME` from a US position
 * with the country on Jamaica zooms neatly to an empty map.
 *
 * **It offers rather than acts.** The country decides address grammar, units, which filters
 * are worth showing and what the map frames — so switching it silently, on a press that asked
 * about distance, would be the app overruling a stated preference on a guess about intent.
 * The offer names the exact consequence ("Jamaica · 5 nearby") and the press is the consent.
 *
 * What it must never become is a thing that appears while somebody is reading. It is rendered
 * beside the count, which is already the number it is explaining, and only when `nearbyInOtherCountry`
 * has an answer — so it cannot flicker on an empty dataset or while a position is still being
 * obtained.
 */
export function CountryOffer({
  country,
  count,
  onSwitch,
}: {
  country: CountryCode;
  count: number;
  onSwitch: (next: CountryCode) => void;
}) {
  const theme = useTheme();
  const label = COUNTRY_LABELS[country];
  const press = () => onSwitch(country);

  return (
    <Pressable
      accessibilityRole="button"
      /**
       * Spelled out rather than left to the visible words, which are deliberately terse and
       * would otherwise be read as "Jamaica, 5 nearby" — a fragment that says neither what
       * pressing does nor that this is the country setting. §6: a control whose visible label
       * is abbreviated speaks its own full form.
       */
      accessibilityLabel={`Switch country to ${label} — ${count} ${count === 1 ? 'market' : 'markets'} near you`}
      onPress={press}
      {...spaceToPress(press)}
      style={({ pressed }) => [
        styles.offer,
        {
          backgroundColor: pressed ? theme.backgroundSelected : theme.backgroundElement,
          borderColor: theme.tint,
        },
      ]}>
      {/* Two facts and no persuasion: where the markets are, and how many. The arrow is the
          only decoration and is `aria-hidden` paint — the accessible name above already says
          the press switches something, so announcing "right arrow" would add a shape to a
          sentence that is already complete. */}
      <ThemedText type="small" themeColor="text">
        {`${count} nearby in ${label}`}
      </ThemedText>
      <ThemedText type="smallBold" themeColor="tint" aria-hidden accessibilityElementsHidden>
        {'SWITCH  →'}
      </ThemedText>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  /**
   * The treatment every other control on these screens wears (§2): `backgroundElement`, a
   * `tint` edge at a full point, and no fill that could read as "on". It is not a filter and
   * has no state to be in — it is an action that removes itself by succeeding — so it must
   * not take `backgroundSelected`, which is reserved for things with an off state to surrender.
   *
   * 44 tall because it is a real control and `hitSlop` does not reach the web.
   */
  offer: {
    minHeight: 44,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Spacing.two,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
    borderWidth: 1,
    borderRadius: Radii.card,
  },
});
