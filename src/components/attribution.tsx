import { StyleSheet, View } from 'react-native';

import { ExternalLink } from '@/components/external-link';
import { ThemedText } from '@/components/themed-text';
import { SOURCE_URL } from '@/constants/source';
import { Spacing } from '@/constants/theme';

/**
 * Two obligations met in one line, both of which were previously unmet.
 *
 * AGPL §6(d): a browser that loads the web build has *received a copy* of the
 * program — that is conveying, not mere network interaction — so directions to
 * the source have to travel with it. A link in the README does not, because the
 * README is not what got conveyed.
 *
 * ODbL §4.3: the bundled dataset ships inside the app (`markets.ts` requires it
 * directly), so every client receives a copy of the database too. OpenStreetMap
 * Foundation guidance is explicit that attribution "should not require
 * individuals to interact with the map or produced work to see" it. This sits on the list
 * itself, and since the detail screen stopped rendering a per-record source it is now the
 * only place the database is credited at all — so removing it removes the attribution. Note the map's own attribution control credits the *tiles*
 * and discharges a different obligation; these are not interchangeable.
 */
export function Attribution() {
  return (
    <View style={styles.wrap}>
      <ThemedText type="small" themeColor="textSecondary" style={styles.line}>
        Market data © OpenStreetMap contributors and public open data, ODbL.
      </ThemedText>
      <ExternalLink url={SOURCE_URL} label="Free software, AGPL-3.0 — source code" />
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    paddingTop: Spacing.three,
    paddingBottom: Spacing.four,
    gap: Spacing.half,
  },
  line: { fontSize: 12, lineHeight: 17 },
});
