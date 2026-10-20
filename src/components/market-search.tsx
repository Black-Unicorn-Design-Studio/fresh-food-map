import { useRef, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import { ClearButton } from '@/components/clear-button';
import { POSTAL_CODE_LABELS } from '@/constants/countries';
import { Radii, Spacing } from '@/constants/theme';
import { useSettings } from '@/hooks/use-settings';
import { useTheme } from '@/hooks/use-theme';
import { spaceToPress } from '@/lib/a11y';

/** What the text in the box is taken to mean. */
export type SearchMode = 'name' | 'near';

/**
 * The search box's border weight, at rest and focused.
 *
 * Focus is carried by the weight because the colour is no longer free to carry it: the box is
 * `tint` at rest now, the same edge the filter chips wear, so a `tint`-on-focus rule would be
 * a state change of exactly zero pixels. Two points against one is a change WCAG 2.4.11 can
 * measure, and the point it gains comes out of the horizontal padding so nothing reflows.
 */
const RESTING_BORDER = 1;
const FOCUS_BORDER = 2;

/**
 * The search field both filter panels open with — one component for the same reason
 * `TagFilter` is one: a narrowing the map can do and the list cannot, or the other way
 * about, is two views disagreeing about what the app can find.
 *
 * It owns nothing but its focus. The query lives on the screen, next to the tag selection
 * the counts are computed against, and the matching lives in `searchMarkets`
 * (`src/lib/markets.ts`) where it can be tested without rendering anything.
 *
 * The `near` half is opt-in: pass `mode` and the mode control appears, omit it and this is a
 * plain filter box. Both screens pass it, and they spend the result differently — the list
 * sorts from the place it finds, the map frames it — which is the one thing about this
 * component that is not shared.
 */
export function MarketSearch({
  value,
  onChange,
  nativeID,
  mode,
  onModeChange,
  onSubmit,
  busy = false,
}: {
  value: string;
  onChange: (next: string) => void;
  /**
   * Unique per screen, because both panels can exist in one tree on the web and an id that
   * repeats makes `global.css`'s focus rule ambiguous and any `aria-describedby` wrong.
   */
  nativeID: string;
  /** Omit to get a filter box with no mode control and no submit. */
  mode?: SearchMode;
  onModeChange?: (next: SearchMode) => void;
  /** Runs the place lookup. Only reachable in `near` mode. */
  onSubmit?: () => void;
  busy?: boolean;
}) {
  const theme = useTheme();
  const [focused, setFocused] = useState(false);
  const near = mode === 'near';
  /**
   * The `NEAR` placeholder names the postal part of an address in the reader's own country's
   * word for it, and drops the clause where there is no such thing (Jamaica). Built here
   * rather than inline so the ternary below stays one line and readable.
   */
  const { country } = useSettings();
  const postalWord = POSTAL_CODE_LABELS[country];
  const nearPlaceholder = postalWord
    ? `Search markets by town, address or ${postalWord}`
    : 'Search markets by town or address';
  // Cleared text has to leave the cursor somewhere, and the button it was cleared from is
  // about to unmount — see the clear control below.
  const inputRef = useRef<TextInput>(null);

  return (
    <View style={styles.wrap}>
      <View
        style={[
          styles.box,
          // `tint` at rest and on focus alike — the same argument the filter chips make one
          // panel away (§2): a green edge here says "this narrows the list", not "this is
          // focused". What carries focus is the *weight*, below.
          { borderColor: theme.tint, borderWidth: focused ? FOCUS_BORDER : RESTING_BORDER },
          focused && styles.boxFocused,
        ]}>
        {/* Paint. The field carries the whole accessible name, and a lone glyph announced on
            its own would only add noise. */}
        <Text
          style={styles.icon}
          aria-hidden={true}
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
        >
          {near ? '📍' : '🔎'}
        </Text>
        <TextInput
          // The browser paints its own focus ring here and it is the wrong blue for the page.
          // It is not simply removed — a field that gives no sign of being focused is a
          // keyboard user's cursor going missing (WCAG 2.4.7) — the box's border takes the
          // job instead. `global.css` drops the UA outline for these ids alone, and only
          // because there is something in their place.
          //
          // **What it takes is the weight, not the colour.** The border used to be kraft at
          // rest and `tint` on focus; it is `tint` at both now, so the hue says what the
          // control is and the thickness says where the cursor is. That matters for WCAG
          // 2.4.11 as well as 2.4.7: the criterion asks for 3:1 between the focused and
          // unfocused states of the indicator area, and tint-against-tint would have been
          // 1:1 — literally no change in the pixels. The second pixel ring goes from page
          // colour to `tint` instead, which is 7.49:1.
          ref={inputRef}
          nativeID={nativeID}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          value={value}
          onChangeText={onChange}
          // "Search markets" left it to the reader to guess what it searched *by*, which
          // is the question the mode control below answers — so the placeholder answers it
          // too rather than making them look down to find out.
          // Both halves open the same way on purpose — "Search markets by …" — so the two
          // modes read as one box answering to a switch rather than as two different boxes.
          // The last word follows the reader's country. It was `zipcode` for everybody, which
          // is correct in one of the three and reads, in the other two, as the app admitting
          // it was built somewhere else — in the first control anybody touches. Jamaica takes
          // the clause away rather than naming a thing it abolished.
          placeholder={near ? nearPlaceholder : 'Search markets by name'}
          placeholderTextColor={theme.textSecondary}
          // Spelled out because the visible label is a glyph and a placeholder: neither is a
          // word, and a placeholder is gone the moment you type. It names the mode too, so a
          // screen reader hears what the box currently means without hunting for the radios.
          accessibilityLabel={
            near ? 'Find markets near a town or address' : 'Search markets by name or town'
          }
          // In `near` the keyboard's search key runs the lookup, and since `FIND` went it is
          // the only thing that does. That is still an explicit press, which is what
          // Nominatim's ban on client-side autocomplete actually requires — the policy is
          // about not firing a request per keystroke, not about owning a button. But it is
          // now the *only* trigger, so `returnKeyType="search"` below is load-bearing rather
          // than a nicety: it is what labels the key somebody has to find.
          onSubmitEditing={near ? onSubmit : undefined}
          inputMode="search"
          returnKeyType="search"
          autoCorrect={false}
          autoCapitalize="none"
          style={[styles.input, { color: theme.text }]}
        />
        {/* One slot at the right end, two things in it, and never both. `FIND` used to live
            here and was doing two jobs at once — running the lookup and being the only thing
            on screen that said one was in flight. Losing the button lost the second job with
            it, so the spinner takes this slot whenever a lookup is running: the feedback
            stays, it just stops being a word.

            Otherwise it is the clear, and only when there is something to clear — a `✕` over
            an empty box is a control that does nothing, which §4 calls a dead end.

            **Clearing moves focus back into the field, and has to.** This button unmounts the
            moment the text goes, and a focused node that disappears drops focus to `<body>`;
            the next Tab would restart at the top of the document. `TextInput.focus()` is the
            one imperative focus call that works on a device as well as the web — the
            `enableImperativeFocus` flag that makes it a no-op elsewhere does not gate text
            inputs — so this needs no platform split. It is also just what a clear button
            should do: you cleared the box to type in it. */}
        {busy ? (
          <ActivityIndicator
            size="small"
            color={theme.tint}
            accessibilityLabel="Finding this place"
          />
        ) : value.length > 0 ? (
          // The shared control, which holds the 24 pt floor itself — the submit form's every
          // field wears the same one, so a `✕` means one thing everywhere in the app.
          <ClearButton
            label="Clear search"
            onPress={() => {
              onChange('');
              inputRef.current?.focus();
            }}
          />
        ) : null}
      </View>
      {/* Beneath the box, not above it. The field is what somebody came to use; the mode is
          a qualifier on it, and a qualifier that arrives before the thing it qualifies asks
          you to make a choice about a box you have not seen yet.

          Two mutually exclusive readings of one box, declared rather than guessed. "Portland"
          is both a market name and a city, so any rule that inferred which you meant would be
          wrong sometimes and unfixable when it was — the whole point of this control is that
          the reader says which, and can change their mind without retyping.

          A `radiogroup` of `radio`s, not two switches: switches are independent and these are
          one choice with two answers. `accessibilityState.checked` goes alongside
          `aria-checked` because react-native-web drops the first. */}
      {mode !== undefined && (
        <View style={styles.modes} role="radiogroup" aria-label="What to search">
          {(['name', 'near'] as const).map((m) => {
            const on = mode === m;
            const pick = () => onModeChange?.(m);
            return (
              <Pressable
                key={m}
                accessibilityRole="radio"
                accessibilityState={{ checked: on }}
                aria-checked={on}
                accessibilityLabel={m === 'name' ? 'Search by market name' : 'Search near a place'}
                onPress={pick}
                {...spaceToPress(pick)}
                style={[
                  styles.mode,
                  {
                    backgroundColor: on ? theme.backgroundSelected : 'transparent',
                    borderColor: on ? theme.tint : theme.border,
                  },
                ]}
              >
                <Text style={[styles.modeLabel, { color: on ? theme.tint : theme.textSecondary }]}>
                  {m === 'name' ? 'NAME' : 'NEAR'}
                </Text>
              </Pressable>
            );
          })}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: Spacing.one },
  // Right-aligned under the field. Left, the two pills started on the same vertical as the
  // magnifier above them and read as a second row of the box — three things stacked at one
  // margin, one of which was a text input and two of which were not. Against the right edge
  // they are plainly a modifier hanging off the field rather than part of it, and the
  // left margin is left to the box alone.
  //
  // `justifyContent`, not `alignSelf`: the row still spans the panel, so the pills keep
  // their own widths and only their position moves. Reading order is untouched — this is
  // paint, and NAME is still the first of the two in the tree and in the tab order.
  modes: { flexDirection: 'row', justifyContent: 'flex-end', gap: Spacing.one },
  // `minHeight`, not `hitSlop`, and the distinction is the whole point: **react-native-web's
  // Pressable drops hitSlop entirely** — the prop appears nowhere in
  // `react-native-web/dist/exports/Pressable/`, only in the legacy `Touchable` these do not
  // use. So an 11 pt label in 4 pt of padding measured 19 on the web where the project holds
  // itself to 44, and the slop that was supposed to cover it never arrived. Native was fine,
  // which is exactly what made it invisible.
  //
  // 19 was not a WCAG 2.5.8 failure, and it is worth being exact about why not: the pills
  // are 56 and 54 wide with 4 between them, so 24 pt circles centred on each bounding box
  // are 59 apart and cannot intersect, and the 4 pt above clears the 2.5 those circles
  // overhang. The spacing exception carried them. But it carried them on an arithmetic that
  // a shorter label or a wider gap would quietly break, and nothing in the file said it was
  // load-bearing. Passing by size instead costs 5 pt on one row and stops depending on the
  // geometry holding still.
  mode: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: Radii.pill,
    paddingHorizontal: Spacing.two,
    paddingVertical: Spacing.half,
    minHeight: 24,
    justifyContent: 'center',
  },
  modeLabel: { fontSize: 11, fontWeight: '700', letterSpacing: 1.2 },
  // A hairline box would be wrong twice over: this takes text, so a pill that accepts a
  // cursor reads as a chip that will not toggle — and the border is also the focus
  // indicator, and a sub-pixel line that changes colour is not something you can rely on
  // being seen.
  box: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    borderRadius: Radii.button,
    paddingHorizontal: Spacing.two,
  },
  // The extra point of border is paid for out of the padding, so the box is the same size
  // focused as at rest and the row beside it does not jump a pixel when somebody tabs in.
  boxFocused: { paddingHorizontal: Spacing.two - (FOCUS_BORDER - RESTING_BORDER) },
  icon: { fontSize: 13 },
  // 16, never smaller: iOS zooms the page when a focused input is under 16 and does not zoom
  // back out on blur (style guide §3 — never below 16 for body text).
  input: { flex: 1, fontSize: 16, paddingVertical: Spacing.two },
});
