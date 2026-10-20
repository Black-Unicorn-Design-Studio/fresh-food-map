import { useEffect, useRef, useState } from 'react';
import { Modal, Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { PrivacyLink } from '@/components/privacy-link';
import { COUNTRIES, COUNTRY_LABELS, type CountryCode } from '@/constants/countries';
import { Display, Radii, Spacing } from '@/constants/theme';
import { spaceToPress } from '@/lib/a11y';
import { useSettings, type ThemeChoice } from '@/hooks/use-settings';
import { useTheme } from '@/hooks/use-theme';

/**
 * What the app is, and the two things about it a reader may change.
 *
 * **A modal, where every other disclosure in this app is inline.** The filter panel and the tag
 * explanations sit in the page because they are *about* what is on it — narrowing the list you
 * are looking at, explaining a chip you can see. Settings are not about this screen; they
 * change how every screen behaves, and a surface that dims what is behind it is the honest
 * shape for that. It is also the only thing here worth the cost of a modal, which is why there
 * was no dialog primitive before this one.
 *
 * `Modal` from react-native rather than an absolutely-positioned `View`: on iOS it takes the
 * window rather than sitting inside the map's own stacking context, and on the web
 * react-native-web renders it into a portal at the document root — which is what stops the
 * map's pan handlers and the dock's `box-none` band from competing with the panel's controls.
 */
export function SettingsDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const theme = useTheme();
  const { country, setCountry, theme: choice, setTheme } = useSettings();
  const headingRef = useRef<Text>(null);

  /**
   * Move focus into the dialog when it opens.
   *
   * Without it the keyboard stays wherever it was — behind the dim, on a control the reader can
   * no longer see — and the first Tab walks the map rather than the panel. The heading takes it
   * rather than the first control, so a screen reader announces what this *is* before offering
   * anything to change.
   */
  useEffect(() => {
    if (!open) return;
    const id = setTimeout(() => headingRef.current?.focus(), 50);
    return () => clearTimeout(id);
  }, [open]);

  return (
    <Modal
      visible={open}
      transparent
      animationType="fade"
      // Android's hardware back, and the web's Escape through RNW's own handler.
      onRequestClose={onClose}
      // `dialog` and `aria-modal` are what tell a screen reader the rest of the page is inert
      // while this is up. RNW does not infer either from `Modal`.
      accessibilityViewIsModal
      aria-modal={true}
      role={Platform.OS === 'web' ? 'dialog' : undefined}
      aria-labelledby="settings-title">
      {/* The scrim. Pressing it closes, which is the gesture people try first — but it is
          `aria-hidden` and carries no role, because a screen reader offering "dismiss" twice
          is noise when the panel has its own Done button. */}
      <Pressable
        style={[styles.scrim, { backgroundColor: theme.text }]}
        onPress={onClose}
        aria-hidden={true}
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
      />
      <View style={styles.centre} pointerEvents="box-none">
        <View style={[styles.panel, { backgroundColor: theme.background, borderColor: theme.border }]}>
          {/* A child of the panel rather than of the scrolling content, and out of the flow, so
              it adds no height above the title. In the flow it was a 44 pt row and pushed the
              heading a target's worth down the panel; level with the heading it competed with
              it. Floated into the corner it sits above the title and costs it nothing. */}
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Close settings"
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
          <ScrollView contentContainerStyle={styles.content}>
            <View style={styles.intro}>
              <Text
                ref={headingRef}
                nativeID="settings-title"
                accessibilityRole="header"
                tabIndex={-1}
                style={[styles.title, { color: theme.tint }]}>
                Fresh Food Map
              </Text>
              <Text style={[styles.about, { color: theme.textSecondary }]}>
                A map of farmers markets, kept as open data that anyone can contribute to.
              </Text>
              <PrivacyLink onNavigate={onClose} />
            </View>

            <Dropdown
              label="Country"
              hint="Decides how addresses are written, which units distances use, and where the map opens."
              /**
               * Sorted by the **label**, which is the only ordering that looks alphabetical
               * to the person reading it. Sorting the codes gives `GB, JM, US` and therefore
               * "United Kingdom, Jamaica, United States" — alphabetical by a string the
               * reader cannot see, and wrong by the one they can. `localeCompare` rather than
               * `<`, because the list is a list of country names and will not stay ASCII.
               *
               * The sort lives here and not in `COUNTRIES`: that array is a vocabulary the
               * schema validates against, and nothing about it is a display order.
               */
              options={COUNTRIES.map((c) => ({ value: c, label: COUNTRY_LABELS[c] })).sort((a, b) =>
                a.label.localeCompare(b.label),
              )}
              value={country}
              onChange={(v) => setCountry(v as CountryCode)}
            />

            <Choice
              label="Appearance"
              options={[
                { value: 'system', label: 'System' },
                { value: 'light', label: 'Light' },
                { value: 'dark', label: 'Dark' },
              ]}
              value={choice}
              onChange={(v) => setTheme(v as ThemeChoice)}
            />

          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

/**
 * A hairline between the panel's parts.
 *
 * Its own component with the hiding props baked in, which is the lesson this repo paid for on
 * the map card: divider markup was once pasted onto the `View` that *wrapped* the tag chips
 * and took all four out of the accessibility tree while leaving them in the DOM. A childless
 * component cannot be pasted onto something with content.
 */
function Rule() {
  const theme = useTheme();
  return (
    <View
      style={[styles.rule, { backgroundColor: theme.textSecondary }]}
      aria-hidden={true}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
    />
  );
}

/**
 * One setting, as a button that opens a list of named options.
 *
 * The same shape the list's `SORT` control uses, deliberately: a `button` carrying `expanded`
 * that reveals `radio`s, rather than a native `<select>` that exists on one platform and is
 * imitated on the other. Two dropdowns in one app should open the same way.
 *
 * The button's accessible name carries the current value — `Country, United Kingdom` — because
 * a control named only `Country` makes a screen-reader user open it to find out what it says.
 */
function Dropdown({
  label,
  hint,
  options,
  value,
  onChange,
}: {
  label: string;
  hint: string;
  options: { value: string; label: string }[];
  value: string;
  onChange: (next: string) => void;
}) {
  const theme = useTheme();
  const [open, setOpen] = useState(false);
  const id = `settings-${label.toLowerCase()}`;
  const current = options.find((o) => o.value === value);

  return (
    <View style={styles.group}>
      <Rule />
      <Text nativeID={id} style={[styles.groupLabel, { color: theme.text }]}>
        {label.toUpperCase()}
      </Text>
      <Text style={[styles.hint, { color: theme.textSecondary }]}>{hint}</Text>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${label}, ${current?.label ?? ''}`}
        accessibilityState={{ expanded: open }}
        aria-expanded={open}
        onPress={() => setOpen((v) => !v)}
        {...spaceToPress(() => setOpen((v) => !v))}
        style={[styles.field, { borderColor: theme.tint }]}>
        <Text style={[styles.fieldText, { color: theme.text }]}>{current?.label}</Text>
        {/* Paint: the button's own name already says what it is and what it holds. */}
        <Text
          style={[styles.caret, { color: theme.tint }]}
          aria-hidden={true}
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants">
          {open ? '▲' : '▼'}
        </Text>
      </Pressable>
      {open ? (
        <View style={styles.menu} role="radiogroup" aria-labelledby={id} accessibilityLabel={label}>
          {options.map((o) => {
            const on = o.value === value;
            const pick = () => {
              onChange(o.value);
              setOpen(false);
            };
            return (
              <Pressable
                key={o.value}
                accessibilityRole="radio"
                accessibilityState={{ checked: on }}
                aria-checked={on}
                accessibilityLabel={o.label}
                onPress={pick}
                {...spaceToPress(pick)}
                style={[styles.menuItem, on && { backgroundColor: theme.backgroundSelected }]}>
                <Text style={[styles.menuText, { color: on ? theme.tint : theme.text }]}>
                  {o.label}
                </Text>
              </Pressable>
            );
          })}
        </View>
      ) : null}
    </View>
  );
}

/**
 * One setting, as a named group of radios.
 *
 * `radiogroup` rather than a row of buttons, because these are mutually exclusive answers to
 * one question and that is exactly what the role means — it also gives arrow-key navigation for
 * free on both platforms, where a row of buttons would need Tab through every option.
 */
function Choice({
  label,
  hint,
  options,
  value,
  onChange,
}: {
  label: string;
  /** Optional: three named buttons you can read at a glance explain themselves. */
  hint?: string;
  options: { value: string; label: string }[];
  value: string;
  onChange: (next: string) => void;
}) {
  const theme = useTheme();
  const id = `settings-${label.toLowerCase()}`;
  return (
    <View style={styles.group}>
      <Rule />
      <Text nativeID={id} style={[styles.groupLabel, { color: theme.text }]}>
        {label.toUpperCase()}
      </Text>
      {hint ? <Text style={[styles.hint, { color: theme.textSecondary }]}>{hint}</Text> : null}
      <View style={styles.options} role="radiogroup" aria-labelledby={id} accessibilityLabel={label}>
        {options.map((o) => {
          const on = o.value === value;
          const pick = () => onChange(o.value);
          return (
            <Pressable
              key={o.value}
              accessibilityRole="radio"
              accessibilityState={{ checked: on }}
              aria-checked={on}
              accessibilityLabel={o.label}
              onPress={pick}
              {...spaceToPress(pick)}
              style={[
                styles.option,
                {
                  borderColor: theme.tint,
                  backgroundColor: on ? theme.tint : 'transparent',
                },
              ]}>
              <Text style={[styles.optionText, { color: on ? theme.background : theme.tint }]}>
                {o.label}
              </Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  scrim: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, opacity: 0.45 },
  centre: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: Spacing.four },
  panel: {
    width: '100%',
    maxWidth: 420,
    maxHeight: '85%',
    borderRadius: Radii.card,
    borderWidth: StyleSheet.hairlineWidth,
  },
  content: { padding: Spacing.four, gap: Spacing.three },
  /**
   * Fraunces Black, the face the `ffm` plaque and the splash both set the app's name in.
   *
   * It was italic for an afternoon, on the argument that a panel introducing the app is the
   * handwritten-aside voice rather than a mark. That reads well in isolation and put the name
   * in two faces in one app, which is the thing the splash was moved to Black to stop. One
   * name, one face, wherever it is written out; italic stays the season lines' alone.
   */
  title: { fontFamily: Display.black, fontSize: 28 },
  about: { fontSize: 14, lineHeight: 20 },
  group: { gap: Spacing.one },
  // The overline treatment the rest of the app uses for a label above a control row (§3).
  groupLabel: { fontSize: 11, letterSpacing: 1.2, fontWeight: '700' },
  hint: { fontSize: 13, lineHeight: 18 },
  options: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.two, paddingTop: Spacing.one },
  option: {
    minHeight: 44,
    justifyContent: 'center',
    paddingHorizontal: Spacing.three,
    borderRadius: Radii.pill,
    borderWidth: 1,
  },
  optionText: { fontSize: 13, fontWeight: '600' },
  /**
   * Cornered and out of the flow, so the title starts where it would have without it.
   *
   * Two earlier shapes were wrong in opposite directions. Sharing a line with the heading, a
   * 44 pt target set the row's height and sat level with a 28 pt title it is not as important
   * as. Given a row of its own, it pushed the heading a full target down the panel and left a
   * band of nothing above the name. Absolute in the corner is neither: the heading keeps the
   * top of the panel, and the ✕ sits above it where the eye looks for a way out.
   */
  close: {
    position: 'absolute',
    top: Spacing.one,
    right: Spacing.one,
    zIndex: 1,
    minWidth: 44,
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  closeGlyph: { fontSize: 18 },
  /**
   * Title and paragraph as one block — a sentence and its explanation, not two items in a list.
   *
   * The paragraph used to sit *outside* this wrapper, so it took the 16 pt gap that separates
   * the panel's sections and stood as far from its own heading as the settings stand from each
   * other. Inside, at 8, it belongs to the title.
   */
  intro: { gap: Spacing.two },
  // `textSecondary`, the dark brown, rather than the pale kraft `border`. These separate
  // *sections* of a panel — what the app is, where you are, how it looks — which is a heavier
  // boundary than two lines of text, the same argument that rules the filter row's control
  // pair off in this colour instead of the map card's kraft.
  rule: { height: StyleSheet.hairlineWidth, marginBottom: Spacing.two },
  // The closed state of the dropdown: a field, so it reads as something with a value rather
  // than as a button that does something.
  field: {
    minHeight: 44,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: Spacing.three,
    borderRadius: Radii.button,
    borderWidth: 1,
    marginTop: Spacing.one,
  },
  fieldText: { fontSize: 15 },
  caret: { fontSize: 10 },
  menu: { marginTop: Spacing.one, borderRadius: Radii.button, overflow: 'hidden' },
  menuItem: { minHeight: 44, justifyContent: 'center', paddingHorizontal: Spacing.three },
  menuText: { fontSize: 15 },
});
