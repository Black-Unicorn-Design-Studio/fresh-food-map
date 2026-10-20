import { useEffect, useRef, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ClearButton } from '@/components/clear-button';
import { ExternalLink } from '@/components/external-link';
import { ThemedText } from '@/components/themed-text';
import { PageTitle } from '@/components/page-title';
import { ORDERED_TAGS } from '@/components/tag-filter';
import { TAG_LABELS } from '@/constants/tags';
import { Display, MaxContentWidth, Radii, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useUserLocation } from '@/hooks/use-location';
import { COUNTRY_EXAMPLES } from '@/constants/countries';
import { useSettings } from '@/hooks/use-settings';
import { deviceTimezone } from '@/lib/market-clock';
import { spaceToPress } from '@/lib/a11y';
import { GEOCODE_MESSAGES, addressDetail, geocode, reverseGeocode } from '@/lib/geocode';
import { INTAKE_URL, hoursFor, submitMarket, type SubmitForm, type Weekday } from '@/lib/submit';
import { normalizeAddress } from '@/lib/address-format';
import { parseTimeInput } from '@/lib/time-input';

const DAYS = [
  ['mon', 'M', 'Monday'], ['tue', 'T', 'Tuesday'], ['wed', 'W', 'Wednesday'], ['thu', 'T', 'Thursday'],
  ['fri', 'F', 'Friday'], ['sat', 'S', 'Saturday'], ['sun', 'S', 'Sunday'],
] as const;


const EMPTY: SubmitForm = {
  name: '', address: '', lat: '', lon: '', website: '',
  days: [], open: '', close: '', perDayHours: false, dayHours: {}, tags: [], note: '',
};

/** Ties the switch to the region it reveals. */
const PER_DAY_ID = 'per-day-hours';

/**
 * Written once and pointed at by all sixteen time inputs.
 *
 * That the fields read `7` and `3pm` is invisible otherwise — the placeholder shows `08:00`
 * and disappears on the first keystroke anyway — so WCAG 3.3.2 wants it said before somebody
 * types, not discovered after. Drawn once above the shared pair and referenced by the rest
 * through `describes`, which is the prop for copy that lives elsewhere on the screen: a
 * sentence repeated under fourteen per-day inputs would be noise on the page and a paragraph
 * in a screen reader.
 */
const TIME_HINT = 'Times are read loosely — 7, 3pm and 19:30 all work.';
const TIME_HINT_ID = 'time-format-hint';

/**
 * Adding a market. No account, by design — the service takes submissions from
 * anyone, checks them mechanically, and a human reviews the pull request it
 * opens (docs/trd.md §4).
 *
 * Everything here is optional except a name, an address and a location, because
 * a market with the wrong hours is worse than a market with no hours: the
 * reviewer can find opening times, but they cannot find a market that was never
 * submitted for want of a field somebody did not know.
 */
/**
 * The form's opening line, and the only place it is written. The note field points at it
 * too — it is the one field whose text `server/batch.ts` quotes verbatim into a public
 * pull request, so the ask has to reach someone who tabbed straight to it as well as
 * someone who read down the page.
 */
const INTRO_COPY =
  'No account needed. The market is reviewed by a human and published as open data anyone can reuse — please leave out personal details.';
const INTRO_ID = 'submit-intro';

export default function SubmitScreen() {
  const theme = useTheme();
  const { location, request } = useUserLocation();
  // Which country's address grammar this submission is written in. Defaulted from the device's
  // region and overridable in settings, so a Briton's market is not filed as an American one.
  const { country } = useSettings();
  // The example market whose name, address and coordinates fill this form's placeholders.
  const example = COUNTRY_EXAMPLES[country];
  const [form, setForm] = useState<SubmitForm>(EMPTY);
  /**
   * Every text input on the form, by the key that renders it.
   *
   * Only so a cleared field can take its focus back: the `✕` unmounts the moment the value is
   * empty, and a focused node that disappears drops focus to the top of the document.
   */
  const fieldRefs = useRef<Record<string, TextInput | null>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [notice, setNotice] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  /** What the last location lookup said, in either direction. Reported next to the fields
      it fills, not at the foot of the form, because it is about the address and the
      coordinate pair and nothing else. */
  const [lookup, setLookup] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);
  const [finding, setFinding] = useState(false);
  /**
   * What a self-tidying field just rewrote itself to, for anyone who cannot see it happen.
   *
   * Two fields do this now: the time pairs read `7` as `07:00` (`parseTimeInput`) and the
   * address is reshaped to the dataset's `<street>, <city>, <ST> <zip>`
   * (`normalizeAddress`). Either way it is a change to text the person did not type, made in
   * a field their focus has already left — on a phone, blur happens by tapping somewhere
   * else entirely — which is silent to a screen reader and easy to miss by eye.
   *
   * WCAG 4.1.3 asks for exactly that to be programmatically determinable without moving
   * focus, so this region says "Opens: read 7 as 07:00" and is mounted from the first
   * render: a region inserted along with its text is not reliably announced.
   */
  const [rewritten, setRewritten] = useState('');

  // Anti-spam signals. The honeypot must stay empty; the timer measures how long
  // the form was open. Neither involves a third party or any tracking.
  const honeypot = useRef('');
  // Stamped in an effect, not during render: Date.now() is impure and a
  // re-render would silently move the clock the anti-spam timer reads from.
  const openedAt = useRef(0);
  useEffect(() => {
    openedAt.current = Date.now();
  }, []);

  const set = <K extends keyof SubmitForm>(k: K, v: SubmitForm[K]) =>
    setForm((f) => ({ ...f, [k]: v }));

  const ready = form.name.trim().length >= 3 && form.address.trim().length >= 5 && form.lat && form.lon;

  /**
   * Both fillers land here. Six decimals is about 10 cm, far past what a market stand needs
   * and short enough to read back. Clearing the two field errors matters: a failed submit
   * leaves "Latitude is required" under the input, and filling it from anywhere has to take
   * that away, or the form reads as still broken while holding a perfectly good number.
   */
  function setCoords(lat: number, lon: number) {
    setForm((f) => ({ ...f, lat: lat.toFixed(6), lon: lon.toFixed(6) }));
    setErrors(({ lat: _lat, lon: _lon, ...rest }) => rest);
  }

  /**
   * Fills all three location fields, not two. It used to leave the address blank, so
   * somebody standing in the market still had to type where they were standing — the same
   * "you already told us, now tell us again" the address lookup exists to remove.
   *
   * The coordinates land first and the address follows, because the pair is what the
   * permission actually returned and the address is a second round trip that may not
   * arrive. A failed reverse lookup is therefore not an error: two of three fields are
   * filled and the third is a normal input.
   *
   * A typed address is never overwritten. The device knows where you are and not what you
   * meant to write, and clobbering a market's own name for its location — "west car park,
   * behind the church" — with a postal address would lose the better of the two.
   */
  async function useMyLocation() {
    // `precise`: this coordinate is written into a committed record and reverse geocoded to a
    // street address, so the ~100 m default is not good enough — at that radius the answer can
    // be the wrong side of a block, and it lands in the dataset looking as confident as a
    // right one.
    const { point: here, fix } = await request({ precise: true });
    if (!here) {
      setNotice({ kind: 'error', text: 'Location unavailable — type the coordinates instead.' });
      return;
    }
    setCoords(here.lat, here.lon);
    setLookup(null);

    if (form.address.trim() !== '') {
      setLookup({ kind: 'ok', text: 'Filled the coordinates. Kept the address you typed.' });
      return;
    }

    setFinding(true);
    const named = await reverseGeocode(here.lat, here.lon);
    setFinding(false);
    if (named.ok) {
      set('address', named.label);
      /**
       * What came back is said plainly, including when it is not a street address.
       *
       * The lookup asks at building zoom, so where a house number is mapped this is
       * "1573 W Broad St, Athens, GA 30606" and there is nothing to add. Where one is not —
       * a car park, the middle of a long kerb, a park — the honest answer is the street or
       * the area, and the form says which rather than presenting it as an address somebody
       * can walk to. Inventing a number from a nearby building would be worse than a vague
       * answer a person can correct: it would be a wrong answer that looks right in a file
       * that gets committed.
       */
      const note =
        named.precision === 'building'
          ? `Found via OpenStreetMap: ${named.label}`
          : named.precision === 'street'
            ? `Nearest street: ${named.label} — add the number if you know it.`
            : `Closest match: ${named.label} — a street address would be better if you know one.`;
      /**
       * An area-level answer has two completely different causes and the reader cannot tell
       * them apart from the address alone: either the point genuinely has no street mapped, or
       * the point is not where they are standing. **Precise Location: Off** is the second, and
       * it is invisible — permission is granted, a coordinate arrives, and it is fuzzed to a
       * several-kilometre region, which is far enough that Nominatim has no road to name. So
       * when the fix itself is the likely culprit, say so and name the setting, because no
       * amount of retrying the lookup will fix a position that is kilometres out.
       *
       * Only on `area`: a coarse fix that still produced a street is not worth a warning, and
       * the threshold is generous for the same reason — 200 m routinely still names a road, so
       * anything under it is not what went wrong here.
       */
      const vague =
        named.precision === 'area' && fix
          ? fix.reduced
            ? ' Precise Location is off for this app — turn it on in Settings › Privacy & Security › Location Services to get a street.'
            : fix.metres !== null && fix.metres > 200
              ? ` Your position is only known to about ${Math.round(fix.metres)} m, which is too vague to name a street.`
              : ''
          : '';
      setLookup({ kind: 'ok', text: note + vague });
    } else {
      /**
       * Still `kind: 'ok'`, and deliberately: nothing failed that the person asked for. They
       * pressed a button to fill the coordinates and the coordinates are filled.
       *
       * **But it says which thing went wrong**, where it used to collapse all four reasons
       * into one sentence. "Couldn't name the address" reads as *there is no address here* —
       * so a service that was unreachable, or rate-limiting us, looked exactly like open
       * water, and there was no way to tell from the screen which had happened. That is the
       * whole difference between "type it in yourself" and "press it again in a moment", and
       * only one of them is worth the reader's time.
       */
      const why =
        named.reason === 'unreachable'
          ? "couldn't reach the address service — type the address, or try again"
          : named.reason === 'throttled'
            ? 'the address service is busy — try again in a moment, or type it'
            : "no address is mapped here — type it";
      setLookup({ kind: 'ok', text: `Filled the coordinates. ${why[0].toUpperCase()}${why.slice(1)}.` });
    }
  }

  /**
   * The coordinate pair is still required — the feature schema needs a Point geometry — but
   * nobody knows their latitude, and asking for one was costing markets. So it is looked up
   * from the address that is already typed rather than typed a second time.
   *
   * Deliberately never disabled for a short address: pressing it says what to do instead,
   * which is the whole reason the control exists. A greyed-out button with no explanation is
   * the dead end this replaces.
   *
   * What comes back is shown and left editable rather than filled silently. A wrong geocode
   * that nobody saw would ride into a pull request looking exactly like a right one — and a
   * complete-looking record is precisely what survives a reviewer's skim.
   */
  async function findFromAddress() {
    setFinding(true);
    setLookup(null);
    // Same tie-break as the list: if the device has already told us where it is, prefer
    // matches near it. Somebody adding a market is almost always near it.
    /**
     * The country goes with the query, not just onto the record.
     *
     * `geocode` already ranks the three answers to "where is this address" — the device's
     * position beats the reader's setting, which beats the compiled-in default — but the
     * middle term only exists if it is handed over, and this call was the one place that
     * did not hand it over. The effect was invisible in the United States and silent
     * everywhere else: with location declined or unavailable, the lookup fell straight to
     * `GEOCODE_COUNTRIES` (`us`) as a hard filter, so a British submitter got "not found"
     * and a Jamaican one is offered Kingston, New York — a confident, plausible, wrong
     * answer, which is the failure this file works hardest to avoid writing into a file.
     */
    const result = await geocode(form.address, { near: location ?? undefined, country });
    setFinding(false);
    if (!result.ok) {
      setLookup({ kind: 'error', text: GEOCODE_MESSAGES[result.reason] });
      return;
    }

    setCoords(result.lat, result.lon);

    /**
     * The found address replaces what was typed **only when it is richer**, measured by
     * `addressDetail` on both strings.
     *
     * This screen used to hold the line that a typed address is never overwritten, and the
     * reason was a good one: "west car park, behind the church" is better than the postal
     * address that would replace it. What UAT found is that the rule also kept "1573 w broad"
     * when the lookup knew "1573 W Broad St, Athens, GA 30606" — a market going into a
     * committed file with half an address, because the app was being careful about the wrong
     * half. So the rule is now about which string carries more, and a tie leaves the reader's
     * own words alone.
     *
     * It is still only ever on an explicit press, and the result is still visible and still
     * editable before anything is submitted.
     */
    const found = result.address;
    const richer = found !== undefined && addressDetail(found) > addressDetail(form.address);
    if (richer) set('address', found);
    setLookup({
      kind: 'ok',
      text: richer
        ? `Found via OpenStreetMap, and filled in the fuller address: ${found}`
        : `Found via OpenStreetMap: ${result.label}`,
    });
  }

  /**
   * Turning the mode on seeds every selected day from the shared pair, so nobody starts
   * from seven blank boxes having just said "most days are 8 to 1". Turning it off keeps
   * `dayHours` rather than clearing it: an accidental tap must not silently delete times
   * somebody typed, and `hoursFor` ignores the map while the mode is off, so nothing
   * unwanted can reach the payload from it.
   */
  function togglePerDay() {
    setForm((f) => {
      if (f.perDayHours) return { ...f, perDayHours: false };
      const seeded = { ...f.dayHours };
      for (const day of f.days as Weekday[]) {
        seeded[day] ??= { open: f.open, close: f.close };
      }
      return { ...f, perDayHours: true, dayHours: seeded };
    });
  }

  function setDayHours(day: Weekday, which: 'open' | 'close', value: string) {
    setForm((f) => {
      const current = f.dayHours[day] ?? { open: f.open, close: f.close };
      return { ...f, dayHours: { ...f.dayHours, [day]: { ...current, [which]: value } } };
    });
    setErrors(({ [`${which}_${day}`]: _dropped, ...rest }) => rest);
  }

  async function send() {
    setBusy(true);
    setErrors({});
    setNotice(null);
    const result = await submitMarket(form, {
      honeypot: honeypot.current,
      openedAt: openedAt.current,
      country,
      // Read at submit time rather than held in state: the device knows, it cannot be wrong
      // about where the person filling this in is standing, and nobody should have to type it.
      timezone: deviceTimezone(),
    });
    setBusy(false);
    if (result.ok) {
      setForm(EMPTY);
      openedAt.current = Date.now();
      setNotice({
        kind: 'ok',
        text: 'Thanks — it is queued for review. A person reads every submission before it appears.',
      });
    } else {
      if (result.fields) setErrors(result.fields);
      setNotice({ kind: 'error', text: result.message });
    }
  }

  const field = (
    key: string,
    label: string,
    placeholder: string,
    {
      extra = {},
      caption,
      required = false,
      describes,
      value,
      onChange,
      normalize,
    }: {
      extra?: React.ComponentProps<typeof TextInput>;
      caption?: string;
      required?: boolean;
    /**
     * Copy that already exists elsewhere on the screen and describes this field too.
     * `caption` renders its own text under the input; this points at text that is
     * somewhere else, so the two are not interchangeable and both are needed.
     *
     * `id` feeds `aria-describedby` for the web. `text` feeds `accessibilityHint` for
     * native, which has no idref equivalent — and react-native-web drops
     * `accessibilityHint` anyway, so each platform is served by exactly one of the two.
     */
      describes?: { id: string; text: string };
      /**
       * A value the caller owns, for an input that is not a top-level key on the form —
       * the per-day time pairs live in `dayHours`, keyed by day. Without both of these the
       * input falls back to `form[key]`, which is every other field on this screen.
       */
      value?: string;
      onChange?: (next: string) => void;
      /**
       * Rewrites the field's own text when it loses focus — for the time pairs, which read
       * `7` as `07:00` rather than refusing it (`parseTimeInput`).
       *
       * **On blur and never while typing.** Normalising on every keystroke fights the
       * person: `7` becomes `07:00` the moment it is typed, and the next character lands
       * after the minutes. Waiting until they have finished means the guess is applied to
       * something somebody meant to leave.
       *
       * Returning `null` means "no reading" and leaves the text exactly as typed, so the
       * schema produces the error on submit and the message lands under this field. The
       * normaliser's job is to widen what is accepted, never to decide what is rejected.
       */
      normalize?: (raw: string) => string | null;
    } = {},
  ) => {
    const error = errors[key];
    const shown = value ?? (form[key as keyof SubmitForm] as string);
    /**
     * Writing a field clears that field's error, which `setDayHours` and `setCoords` already
     * do for the inputs they own and this path did not — so a failed submit left "Times look
     * like 08:30" under a field somebody had since corrected, and the form read as broken
     * while holding a perfectly good value. Same argument `setCoords` makes above.
     */
    const write =
      onChange ??
      ((t: string) => {
        set(key as keyof SubmitForm, t as never);
        setErrors(({ [key]: _dropped, ...rest }) => rest);
      });
    // A placeholder is not a label: it disappears on the first keystroke, so anyone
    // tabbing back through a filled form has nothing left to read. That bites hardest
    // on the two adjacent identically-shaped pairs — latitude/longitude and
    // opens/closes — where a swap becomes a data error in a file that gets committed.
    const describedBy = [describes?.id, caption && `${key}-caption`, error && `${key}-error`]
      .filter(Boolean)
      .join(' ');
    return (
      <View style={styles.fieldWrap}>
        <ThemedText nativeID={`${key}-label`} type="smallBold" style={styles.fieldLabel}>
          {label}
          {/* Drawn from the same `required` flag that sets `aria-required`, so the mark a
              sighted person sees and the state a screen reader hears cannot disagree —
              which is the usual way an asterisk goes wrong.

              Hidden from assistive tech rather than spoken. This node is what
              `aria-labelledby` points at, and a hidden descendant is left out of the name
              it computes, so the field is still announced "Market name" and not "Market
              name star". `aria-required` on the input already carries the requirement, and
              carries it as a state rather than as a character.

              `textSecondary` and not `danger`: red is reserved for errors and destructive
              actions (§2), and a field you have not filled in yet is neither. */}
          {required && (
            <Text
              style={{ color: theme.textSecondary }}
              aria-hidden={true}
              accessibilityElementsHidden
              importantForAccessibility="no-hide-descendants"
            >
              {' *'}
            </Text>
          )}
        </ThemedText>
        {/* The field and its clear share one box, so the `✕` sits inside the input's own
            border rather than beside it. `position: 'relative'` on the wrapper is what the
            absolutely-placed button measures against — without it the button would hang off
            the screen's top-left corner on the web and off the form on native.

            The input keeps its own border and fill; only the right padding changes, and it
            changes unconditionally rather than while the button is mounted. Padding that
            appeared and vanished with the text would shift the caret a character to the left
            on the first keystroke and back again on the last, which reads as a rendering
            fault while you type. */}
        <View style={styles.inputWrap}>
        <TextInput
          ref={(node) => {
            fieldRefs.current[key] = node;
          }}
          value={shown}
          onChangeText={write}
          placeholder={placeholder}
          placeholderTextColor={theme.textSecondary}
          style={[
            styles.input,
            {
              backgroundColor: theme.backgroundElement,
              // `border` is 1.32:1 against the input fill — no perceivable boundary.
              borderColor: error ? theme.danger : theme.textSecondary,
              color: theme.text,
            },
          ]}
          accessibilityLabel={label}
          aria-labelledby={`${key}-label`}
          accessibilityHint={[describes?.text, caption, error].filter(Boolean).join(' ') || undefined}
          aria-describedby={describedBy || undefined}
          // undefined rather than false: createDOMProps only omits a null-ish value.
          aria-invalid={error ? true : undefined}
          aria-errormessage={error ? `${key}-error` : undefined}
          aria-required={required || undefined}
          {...extra}
          // After the spread, deliberately: a caller's own `onBlur` is still called, but a
          // spread placed after this one would replace the normaliser outright and the
          // field would silently stop reading `7` as `07:00`.
          onBlur={(e) => {
            if (normalize) {
              const next = normalize(shown);
              // Only when it actually changed, or every blur on a clean field queues a
              // state update that renders the identical string.
              if (next !== null && next !== shown) {
                write(next);
                // Said, not just done — see `rewritten`. The field's own label is in it
                // because seven pairs of these are indistinguishable otherwise.
                setRewritten(`${label}: read ${shown.trim()} as ${next}.`);
              }
            }
            extra.onBlur?.(e);
          }}
        />
        {/* Only when there is something to clear: a `✕` over an empty box is a control that
            does nothing. The name carries the field's own label, because a form with nine
            inputs otherwise offers a screen reader nine controls all called "Clear". */}
        {shown.length > 0 ? (
          <View style={styles.clearSlot}>
            <ClearButton
              label={`Clear ${label.toLowerCase()}`}
              onPress={() => {
                write('');
                fieldRefs.current[key]?.focus();
              }}
            />
          </View>
        ) : null}
        </View>
        {caption && (
          <ThemedText nativeID={`${key}-caption`} type="small" themeColor="textSecondary">
            {caption}
          </ThemedText>
        )}
        {error && (
          <ThemedText
            nativeID={`${key}-error`}
            type="small"
            role="alert"
            style={{ color: theme.danger }}>
            {error}
          </ThemedText>
        )}
      </View>
    );
  };

  return (
    <SafeAreaView role="main" style={[styles.safe, { backgroundColor: theme.background }]} edges={['top']}>
      <PageTitle title="Add a market — Fresh Food Map" description="Tell us about a farmers market we are missing. No account needed." />
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <ThemedText type="small" themeColor="tint" style={styles.overline}>
          KNOW A MARKET WE DON&apos;T?
        </ThemedText>
        <ThemedText style={styles.heading} accessibilityRole="header">
          Add a market
        </ThemedText>

        {!INTAKE_URL ? (
          <View style={[styles.card, { backgroundColor: theme.backgroundElement, borderColor: theme.border }]}>
            <ThemedText>Submissions aren&apos;t set up on this build</ThemedText>
            <ThemedText type="small" themeColor="textSecondary">
              You can still add a market directly — edit `data/markets.json` and open a pull
              request. That is the same route every submission ends up taking anyway.
            </ThemedText>
            <ExternalLink
              url="https://github.com/Black-Unicorn-Design-Studio/fresh-food-map"
              label="Open the repository"
            />
          </View>
        ) : (
          <>
            <ThemedText nativeID={INTRO_ID} type="small" themeColor="textSecondary">
              {INTRO_COPY}
            </ThemedText>

            {/* The examples follow the reader's country. They were four San Francisco
                literals, which showed a Mancunian a state code their address does not have
                and no postcode where theirs goes — a placeholder teaching the wrong shape
                is worse than none, because it is read as instruction. */}
            {field('name', 'Market name', example.name, { required: true })}
            {field('address', 'Street address', example.address, {
              required: true,
              // Tidied on blur the way the time fields are, and for the same reason: the
              // dataset has a shape (`<street>, <city>, <ST> <zip>`) and typing does not
              // respect it. Unlike `parseTimeInput` this never refuses — an address is free
              // text, and blocking a submission over a comma would be absurd. It improves
              // what it recognises and leaves the rest alone.
              normalize: normalizeAddress,
            })}

            <View style={styles.row}>
              {field('lat', 'Latitude', example.lat, {
                extra: { inputMode: 'decimal' },
                required: true,
              })}
              {field('lon', 'Longitude', example.lon, {
                extra: { inputMode: 'decimal' },
                required: true,
              })}
            </View>
            {/* Two ways to fill the pair above, and the order is the common case first:
                almost everyone is typing about a market they are not standing in. */}
            <View style={styles.coordActions}>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Find coordinates from the address"
                accessibilityState={{ disabled: finding, busy: finding }}
                aria-disabled={finding || undefined}
                aria-busy={finding || undefined}
                disabled={finding}
                onPress={findFromAddress}
              >
                <ThemedText type="small" themeColor={finding ? 'textSecondary' : 'link'}>
                  {finding ? '🔎 Looking…' : '🔎 Find it from the address'}
                </ThemedText>
              </Pressable>

              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Use my current location"
                onPress={useMyLocation}
              >
                <ThemedText type="small" themeColor="link">
                  📍 Use my current location
                </ThemedText>
              </Pressable>
            </View>

            {/* Mounted whether or not it has anything to say. A live region inserted at the
                same moment as its text is not reliably announced, and this one carries the
                only feedback a lookup produces — filling inputs makes no sound. It sits
                here rather than with the notice at the foot of the form because it reports
                on the fields around it — the coordinate pair below, and the address above
                when the reverse lookup writes it — and because that notice is 600 px away
                on a phone. */}
            <View role="status" aria-live="polite" accessibilityLiveRegion="polite">
              {lookup && (
                <ThemedText
                  type="small"
                  style={{ color: lookup.kind === 'ok' ? theme.tint : theme.danger }}
                >
                  {lookup.text}
                </ThemedText>
              )}
              {/* Only after a hit, and only as a hint: the numbers above are ordinary
                  inputs and were always editable. Saying so is what makes the found
                  address a proposal rather than a verdict. */}
              {lookup?.kind === 'ok' && (
                <ThemedText type="small" themeColor="textSecondary">
                  Not right? Edit the numbers above.
                </ThemedText>
              )}
            </View>

            <ThemedText nativeID="days-label" type="smallBold" style={styles.label}>
              WHICH DAYS?
            </ThemedText>
            <View style={styles.days} role="group" aria-labelledby="days-label">
              {DAYS.map(([day, letter, name], i) => {
                const on = (form.days as string[]).includes(day);
                // The group label is folded into each chip too: VoiceOver often skips
                // group boundaries in form navigation, and seven bare letters ("M", "T",
                // "T"…) are indistinguishable read aloud.
                const toggle = () =>
                  set(
                    'days',
                    on
                      ? (form.days as string[]).filter((d) => d !== day)
                      : [...(form.days as string[]), day]
                  );
                return (
                  <Pressable
                    key={day}
                    accessibilityRole="switch"
                    accessibilityState={{ checked: on }}
                    aria-checked={on}
                    accessibilityLabel={`Open on ${name}`}
                    onPress={toggle}
                    {...spaceToPress(toggle)}
                    style={[
                      styles.day,
                      {
                        backgroundColor: on ? theme.tint : theme.backgroundElement,
                        borderColor: on ? theme.tint : theme.border,
                      },
                    ]}>
                    <Text style={[styles.dayText, { color: on ? theme.background : theme.textSecondary }]}>
                      {letter}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
            {/* Says the times are read loosely — off-screen, not drawn. The sentence was a
                visible caption under the shared pair and is not wanted on the page; what it
                cannot stop being is the **accessible description of six time inputs**, which
                name it through `describes` (`aria-describedby` on the web, `accessibilityHint`
                on native). Deleting the node would leave six `aria-describedby` attributes
                pointing at an id that no longer exists — a dangling reference is not a
                degraded description, it is no description at all, and only for the readers who
                cannot see the placeholder either.
                So it moves to `srOnly` rather than going away: nothing is drawn, the id still
                resolves, and native still gets the text. The placeholder cannot carry this on
                its own — it disappears on the first keystroke, which this file already argues
                about two hundred lines down. */}
            <ThemedText nativeID={TIME_HINT_ID} type="small" style={styles.srOnly}>
              {TIME_HINT}
            </ThemedText>
            {/* Mounted from the first render and never conditionally, so the announcement
                lands: a live region inserted along with its text is not reliably read.
                Empty until a field actually rewrites itself. */}
            <View
              role="status"
              aria-live="polite"
              accessibilityLiveRegion="polite"
              style={styles.srOnly}>
              <ThemedText type="small">{rewritten}</ThemedText>
            </View>
            <View style={styles.row}>
              {field('open', form.perDayHours ? 'Opens (most days)' : 'Opens', '08:00', {
                normalize: parseTimeInput,
                describes: { id: TIME_HINT_ID, text: TIME_HINT },
              })}
              {field('close', form.perDayHours ? 'Closes (most days)' : 'Closes', '13:00', {
                normalize: parseTimeInput,
                describes: { id: TIME_HINT_ID, text: TIME_HINT },
              })}
            </View>

            {/* A switch, not a disclosure button, and the difference is not cosmetic: this
                changes what gets submitted, not just what is drawn. `FilterToggle` is a
                `button` with `expanded` precisely because it only reveals — this one has an
                on state that alters the payload, so it is a `switch` carrying `checked`
                (style guide §6).

                Shown only once a day is picked. Before that there is nothing to vary, and
                offering the choice would be asking a question about an empty set. */}
            {form.days.length > 0 && (
              <Pressable
                accessibilityRole="switch"
                accessibilityState={{ checked: form.perDayHours }}
                aria-checked={form.perDayHours}
                accessibilityLabel="Different hours on some days"
                {...(form.perDayHours ? { 'aria-controls': PER_DAY_ID } : {})}
                onPress={togglePerDay}
                {...spaceToPress(togglePerDay)}
                style={styles.perDayToggle}
              >
                <ThemedText type="small" themeColor={form.perDayHours ? 'tint' : 'link'}>
                  {form.perDayHours ? '☑︎' : '☐'} Different hours on some days
                </ThemedText>
              </Pressable>
            )}

            {/* One pair per selected day, in week order rather than the order they were
                tapped — the WeekStrip on the card will read Mon-first, so the form that
                fills it should too, or somebody checks their own work against a different
                sequence than the one they will see.

                Every input names its day. Seven pairs labelled "Opens"/"Closes" are
                indistinguishable to a screen reader, and that is exactly where a swapped
                pair becomes a wrong time in a file somebody commits. */}
            {form.perDayHours && form.days.length > 0 && (
              <View id={PER_DAY_ID} style={styles.perDay}>
                {DAYS.filter(([day]) => (form.days as string[]).includes(day)).map(
                  ([day, , name]) => {
                    const pair = hoursFor(form, day);
                    return (
                      <View key={day} style={styles.row}>
                        {field(`open_${day}`, `${name} opens`, '08:00', {
                          value: pair.open,
                          onChange: (t) => setDayHours(day, 'open', t),
                          normalize: parseTimeInput,
                          describes: { id: TIME_HINT_ID, text: TIME_HINT },
                        })}
                        {field(`close_${day}`, `${name} closes`, '13:00', {
                          value: pair.close,
                          onChange: (t) => setDayHours(day, 'close', t),
                          normalize: parseTimeInput,
                          describes: { id: TIME_HINT_ID, text: TIME_HINT },
                        })}
                      </View>
                    );
                  },
                )}
              </View>
            )}

            <ThemedText nativeID="tags-label" type="smallBold" style={styles.label}>
              ANYTHING TRUE OF IT?
            </ThemedText>
            <View style={styles.tags} role="group" aria-labelledby="tags-label">
              {ORDERED_TAGS.map((tag) => {
                const on = form.tags.includes(tag);
                const toggle = () =>
                  set('tags', on ? form.tags.filter((t) => t !== tag) : [...form.tags, tag]);
                return (
                  <Pressable
                    key={tag}
                    accessibilityRole="switch"
                    accessibilityState={{ checked: on }}
                    aria-checked={on}
                    accessibilityLabel={TAG_LABELS[tag]}
                    onPress={toggle}
                    {...spaceToPress(toggle)}
                    style={[
                      styles.chip,
                      {
                        backgroundColor: on ? theme.backgroundSelected : theme.backgroundElement,
                        borderColor: on ? theme.tint : theme.border,
                      },
                    ]}>
                    <Text style={[styles.chipText, { color: on ? theme.tint : theme.textSecondary }]}>
                      {TAG_LABELS[tag]}
                    </Text>
                  </Pressable>
                );
              })}
            </View>

            {field('website', 'Website', 'https://example.org (optional)', {
              extra: { autoCapitalize: 'none' },
            })}
            {field('note', 'Anything a reviewer should know', 'Optional — anything that would help a reviewer', {
              extra: { multiline: true, numberOfLines: 3 },
              // No caption: the "leave out personal details" ask lives in the opening line
              // now, read before anyone types rather than only by whoever reaches the last
              // field. But this is still the one free-text field that `server/batch.ts`
              // quotes verbatim into a public pull request, so it keeps the warning as its
              // own description rather than relying on somebody having met it 700 px
              // earlier: Tab and the VoiceOver rotor jump control to control and never pass
              // the intro, and on native the hint was the only carrier there has ever been.
              describes: { id: INTRO_ID, text: INTRO_COPY },
            })}

            {/* Honeypot: positioned off-screen rather than display:none, which some
                bots detect. A naive crawler fills it; tripping it is a hard fail in
                server/checks.ts, so anyone who reaches it by accident is silently
                dropped — which makes who can reach it a correctness question, not a
                cosmetic one. The two props below are native-only: react-native-web
                drops both, and the field sat in the web accessibility tree unlabelled
                and reachable by screen-reader form navigation. aria-hidden closes that
                on web, tabIndex keeps it out of the tab order everywhere, and the trap
                is unaffected because bots read the DOM, not the accessibility tree. */}
            <TextInput
              accessibilityElementsHidden
              importantForAccessibility="no-hide-descendants"
              aria-hidden={true}
              autoComplete="off"
              tabIndex={-1}
              onChangeText={(t) => (honeypot.current = t)}
              style={styles.honeypot}
            />

            {/* Off-screen, not deleted, and not `display: none` or `aria-hidden` — either
                would take it out of the accessibility tree along with the pixels.

                The asterisks say which fields are required to anyone who can see them. This
                is the same fact for anyone who cannot see the button dimming, or who reaches
                a disabled control and needs to know why it will not take a press. The gate
                was once written down only in a code comment, and that was the gap this
                closed; hiding the text visually must not reopen it. */}
            <ThemedText nativeID="submit-req" type="small" style={styles.srOnly}>
              Needs a market name, a street address and a location.
            </ThemedText>
            <Pressable
              accessibilityRole="button"
              disabled={!ready || busy}
              aria-describedby="submit-req"
              onPress={send}
              style={[styles.button, { backgroundColor: theme.tint, opacity: !ready || busy ? 0.5 : 1 }]}>
              <Text style={[styles.buttonLabel, { color: theme.background }]}>
                {busy ? 'SENDING…' : 'SUBMIT FOR REVIEW'}
              </Text>
            </Pressable>
          </>
        )}

        {/* Every outcome lands here — queued, validation failure, service unreachable,
            rate-limited — and on success the form is also emptied. None of it was
            announced, so a screen-reader user could not tell success from failure and
            would reasonably submit again.

            Mounted unconditionally on purpose: a live region inserted at the same moment
            as its text is unreliably announced, so the container has to be there first.
            Deliberately no aria-atomic — react-native-web 0.21.2 reads the wrong variable
            for it so it never reaches the DOM, and it is absent from React Native 0.86's
            types; role="status" implies it anyway. */}
        <View role="status" aria-live="polite" accessibilityLiveRegion="polite" aria-busy={busy}>
          {notice && (
            <ThemedText
              type="small"
              style={{ color: notice.kind === 'ok' ? theme.tint : theme.danger }}>
              {notice.text}
            </ThemedText>
          )}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  content: {
    alignSelf: 'center', width: '100%', maxWidth: MaxContentWidth,
    padding: Spacing.three, gap: Spacing.two + Spacing.one, paddingBottom: Spacing.six,
  },
  overline: { letterSpacing: 2.5, fontSize: 11 },
  heading: { fontFamily: Display.black, fontSize: 36, lineHeight: 42 },
  label: { letterSpacing: 1.5, fontSize: 11, paddingTop: Spacing.two },
  // The group captions' treatment minus their paddingTop, which would double-space
  // inside fieldWrap. Uppercase is a type treatment, so the DOM text stays sentence
  // case and a screen reader reads a word rather than spelling out capitals.
  fieldLabel: { letterSpacing: 1.5, fontSize: 11, textTransform: 'uppercase' as const },
  card: {
    borderRadius: Radii.card, borderWidth: StyleSheet.hairlineWidth,
    padding: Spacing.three, gap: Spacing.two,
  },
  // `flexGrow` with an **auto basis**, not `flex: 1`. The shorthand compiles to `flex: 1 1 0%`
  // in react-native-web, and a zero basis means the box is sized from leftover space instead
  // of from what is inside it — while RNW's own `View` reset zeroes the automatic minimum that
  // would otherwise stop a flex item shrinking below its content. Single-line fields survive
  // that because they happen to fit; the notes field does not. It is `multiline` with
  // `numberOfLines: 3`, which reaches the DOM as `<textarea rows="3">` whose intrinsic 83 pt
  // no React Native style ever declared, so the wrapper was handed 76.5 and the textarea hung
  // 6.5 past it — straight through the 8 pt gap and onto `SUBMIT FOR REVIEW`, which a press in
  // that band would hit instead of the field. An auto basis sizes the wrapper from its content
  // and still lets it grow, which is all `flex: 1` was ever wanted for here: two fields
  // sharing one row.
  fieldWrap: { flexGrow: 1, flexBasis: 'auto', gap: Spacing.half },
  perDayToggle: { paddingVertical: Spacing.two },
  perDay: { gap: Spacing.two },
  // Available to a screen reader, absent from the layout — the same treatment the map's
  // screen-reader-only live region uses. (Not the wordmark: that is a visible plaque which
  // also happens to be the map's heading.) Not display:none and not aria-hidden: both
  // remove it from the accessibility tree along with the pixels, which is the point.
  srOnly: { position: 'absolute', left: -9999, width: 1, height: 1, overflow: 'hidden' },
  row: { flexDirection: 'row', gap: Spacing.two },
  // Wraps rather than scrolls: at 200% font scaling the two labels do not share a line, and
  // a row that clipped one of them would hide the only way to fill the fields above it.
  coordActions: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.three },
  // Nothing but a positioning context for the clear button. The input keeps its own border,
  // so this box draws nothing and measures nothing of its own.
  inputWrap: { position: 'relative', justifyContent: 'center' },
  input: {
    borderRadius: Radii.button, borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: Spacing.three, paddingVertical: Spacing.two + Spacing.one, fontSize: 16,
    // Room for the `✕` at the right end: 16 of the field's own padding, 24 of target, and 8
    // between them and the text. Reserved whether or not the button is mounted — see the
    // note at the wrapper.
    paddingRight: Spacing.three + 24 + Spacing.two,
  },
  // Centred on the input's own vertical middle, inset by the padding the field already uses,
  // so the mark lines up with the text rather than with the box's corner.
  clearSlot: { position: 'absolute', right: Spacing.three, top: 0, bottom: 0, justifyContent: 'center' },
  days: { flexDirection: 'row', gap: Spacing.two, flexWrap: 'wrap' },
  day: {
    width: 40, height: 40, borderRadius: Radii.pill, borderWidth: StyleSheet.hairlineWidth,
    alignItems: 'center', justifyContent: 'center',
  },
  dayText: { fontSize: 13, fontWeight: '800' },
  tags: { flexDirection: 'row', gap: Spacing.two, flexWrap: 'wrap' },
  chip: {
    borderRadius: Radii.pill, borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: Spacing.three, paddingVertical: Spacing.two,
  },
  chipText: { fontSize: 11, fontWeight: '700', letterSpacing: 1.2 },
  honeypot: { position: 'absolute', left: -9999, width: 1, height: 1, opacity: 0 },
  button: {
    borderRadius: Radii.button, paddingVertical: Spacing.three,
    alignItems: 'center', minHeight: 44, marginTop: Spacing.two,
  },
  buttonLabel: { fontSize: 13, fontWeight: '800', letterSpacing: 1.5 },
});
