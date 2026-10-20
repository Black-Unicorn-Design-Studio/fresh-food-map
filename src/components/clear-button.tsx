import { Pressable, StyleSheet, Text } from 'react-native';

import { useTheme } from '@/hooks/use-theme';

/**
 * The `✕` that empties a text field.
 *
 * One definition because there are now two kinds of caller — the search box on both discovery
 * screens, and every input on the submit form — and a clear control that behaves differently
 * depending on which screen you are on is worse than none.
 *
 * **24 square as a floor, not as slop.** `hitSlop` is dropped by react-native-web, so a target
 * padded out with it is 24 on a phone and about 13 in a browser, which is the size of the
 * glyph. `minWidth`/`minHeight` hold the floor on both. 24 rather than 44 is deliberate: this
 * sits inside a field whose own row is 44 or more, and a 44 square control there would crowd
 * the text it is attached to — WCAG 2.5.8 asks for 24, and the field itself is the large
 * target.
 *
 * **Clearing puts focus back in the field, and has to.** This button unmounts the moment the
 * value is empty — there is nothing left to clear — and a focused node that disappears drops
 * focus to the document, so the next Tab restarts from the top of the page. Handing focus back
 * to the input is also just what a clear button should do: you emptied the box to type in it.
 *
 * `textSecondary` and never `tint`: green means a thing is on in this app, and this is the
 * quietest control in the box. The reader is looking at the field, not at this.
 */
export function ClearButton({
  label,
  onPress,
}: {
  /** What it clears, for the spoken name — "Clear market name", not four identical "Clear"s. */
  label: string;
  onPress: () => void;
}) {
  const theme = useTheme();
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={label} onPress={onPress} style={styles.target}>
      <Text style={[styles.mark, { color: theme.textSecondary }]}>✕</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  target: { minWidth: 24, minHeight: 24, alignItems: 'center', justifyContent: 'center' },
  mark: { fontSize: 13 },
});
