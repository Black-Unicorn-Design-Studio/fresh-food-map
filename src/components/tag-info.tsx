import { Pressable, StyleSheet, Text, View } from 'react-native';

import { TAG_DESCRIPTIONS, TAG_LABELS, type MarketTag } from '@/constants/tags';
import { Radii, Spacing } from '@/constants/theme';
import { spaceToPress } from '@/lib/a11y';
import { useTheme } from '@/hooks/use-theme';

/**
 * What a tag means, on demand: an `ⓘ` beside the tag's name, and a panel that says the line
 * from `TAG_DESCRIPTIONS`.
 *
 * **It is a disclosure and not a tooltip, and that is the whole design.** A tooltip is
 * hover-or-focus triggered, and this app is touch-first on three platforms: there is no hover
 * on a phone, React Native has no tooltip primitive, and the web's own `title` attribute never
 * arrives — react-native-web 0.21.2 forwards props through an explicit allowlist and `title`
 * is not on it, so `title="…"` here would typecheck, render nothing, and look like it worked.
 *
 * Press-triggered content is also the cheapest way past WCAG 1.4.13, which governs anything
 * that appears on hover or focus and demands it be dismissable, hoverable and persistent. A
 * panel that opens on a press, stays until it is closed, and closes on its own button or on
 * Escape does not engage that criterion at all rather than trying to satisfy three clauses of
 * it. The cost is a visible affordance per tag, which is the thing being bought: a hover
 * tooltip is invisible to the majority of this app's readers.
 *
 * The two consumers hold the open tag themselves — `TagFilter` shows one panel under the whole
 * wrapping row, because a panel between two chips would reflow the row under a thumb, while
 * the detail screen draws one under each tag, its tags being a column already.
 */

/** The `ⓘ`. A sibling of the control it explains, never a child of it. */
export function TagInfoButton({
  tag,
  open,
  onPress,
  panelId,
}: {
  tag: MarketTag;
  open: boolean;
  onPress: () => void;
  /** The panel this opens, so the two are associated while it is open. */
  panelId: string;
}) {
  const theme = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      // Not "info" or "ⓘ": a screen reader reading a row of six chips would announce six
      // identical buttons, and which tag each explains is the only thing worth saying.
      accessibilityLabel={`What ${TAG_LABELS[tag].toLowerCase()} means`}
      accessibilityState={{ expanded: open }}
      aria-expanded={open}
      aria-controls={open ? panelId : undefined}
      onPress={onPress}
      {...spaceToPress(onPress)}
      style={styles.infoButton}>
      {/* Paint. The button's own name says what it does; the glyph announced beside it would
          only add "circled latin small letter i" to it. */}
      <Text
        style={[styles.infoGlyph, { color: open ? theme.tint : theme.textSecondary }]}
        aria-hidden={true}
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants">
        ⓘ
      </Text>
    </Pressable>
  );
}

/** The panel. Rendered only while open; its trigger carries `aria-expanded` either way. */
export function TagInfoPanel({
  tag,
  onClose,
  panelId,
}: {
  tag: MarketTag;
  onClose: () => void;
  panelId: string;
}) {
  const theme = useTheme();
  return (
    <View
      nativeID={panelId}
      // `region` and not `status`: this is content somebody asked for by pressing a button,
      // not something that changed on its own, and a live region would announce it twice —
      // once as the region and once as the newly focused content.
      role="region"
      accessibilityRole="summary"
      accessibilityLabel={TAG_LABELS[tag]}
      style={[
        styles.panel,
        { backgroundColor: theme.backgroundElement, borderColor: theme.border },
      ]}>
      <Text style={[styles.panelText, { color: theme.text }]}>
        <Text style={[styles.panelTerm, { color: theme.tint }]}>{TAG_LABELS[tag]}</Text>
        {' — '}
        {TAG_DESCRIPTIONS[tag]}
      </Text>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`Close ${TAG_LABELS[tag].toLowerCase()} explanation`}
        onPress={onClose}
        {...spaceToPress(onClose)}
        style={styles.close}>
        <Text
          style={[styles.closeGlyph, { color: theme.textSecondary }]}
          aria-hidden={true}
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants">
          ✕
        </Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  // 24 square is WCAG 2.5.8's floor, and it is a floor rather than a target here: this sits
  // inside a chip that is already only as tall as its label, so the glyph is drawn small and
  // the box around it is what the finger gets. `hitSlop` is not an option — react-native-web
  // drops it, so a target that relied on it would be 24 on a phone and 13 in a browser.
  infoButton: {
    minWidth: 24,
    minHeight: 24,
    alignItems: 'center',
    justifyContent: 'center',
    // 2, halved from 4, with the chip's right padding halved to match — see `tag-filter.tsx`.
    // The 24 pt floor above is what holds the target, so trimming this padding narrows the
    // gap without narrowing what a finger has to hit (WCAG 2.5.8).
    paddingLeft: Spacing.half,
  },
  infoGlyph: { fontSize: 13 },
  panel: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: Spacing.two,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: Radii.card,
    paddingVertical: Spacing.two,
    paddingHorizontal: Spacing.three,
    marginTop: Spacing.two,
  },
  // 14, not the chips' 11: this is a sentence to read rather than a label to scan, and the
  // overline metrics the chips wear are unreadable at sentence length.
  panelText: { flex: 1, fontSize: 14, lineHeight: 20 },
  panelTerm: { fontWeight: '700' },
  close: { minWidth: 24, minHeight: 24, alignItems: 'center', justifyContent: 'center' },
  closeGlyph: { fontSize: 13 },
});
