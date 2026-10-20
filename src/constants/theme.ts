/**
 * Design tokens for Fresh Food Map — the single source of truth for color,
 * type, and spacing. Values come from docs/style-guide.md; components must not
 * hardcode hex values (style guide §7).
 */

import '@/global.css';

import { Platform } from 'react-native';

export const Colors = {
  light: {
    text: '#2B2118', // soil.900
    background: '#FAF6EF', // kraft.50
    backgroundElement: '#FFFFFF',
    backgroundSelected: '#E7F2E5', // market.green.100
    // A decorative surface, and the only one. Deliberately *not* `backgroundSelected`, which
    // means "this filter is on" and must keep meaning only that (§2) — this is paler and
    // warmer, kraft with a green cast rather than green with a white one, so the two do not
    // read as the same ink at a glance. Nothing that can be switched on may use it.
    backgroundAccent: '#EEF2E6',
    textSecondary: '#6B5D4F', // soil.600
    tint: '#2D5A27', // market.green.700 — primary actions, active tab
    border: '#EADFCC', // kraft.200
    link: '#20699E', // sky.600
    danger: '#C0392B', // tomato.600
    /**
     * Neon purple, and not from the kraft-and-market-green palette — which is the point, and
     * was the point when it was neon *green*. **Exactly one thing wears it**: the border of
     * `🕒 OPEN NOW`, which filters by the clock where the tags beside it filter by a kind of
     * market.
     *
     * It was briefly two — the ring that pulses round the map's sprout disc took it as well,
     * on the argument that both are the app pointing rather than reporting. The ring is `tint`
     * now, the disc's own colour, so that pairing no longer exists, and an entitlement written
     * for two consumers is exactly the sentence a future reader would cite to put this on a
     * third. If something else ever wants it, it needs its own argument.
     *
     * **The hue change fixed a real asymmetry rather than only a preference.** `#39FF14` on
     * white measured **1.36:1** — a colour you could see and not an edge you could rely on —
     * against 11.9:1 on the dark chip, so the same token was nearly invisible in one theme and
     * shouting in the other. Purple lands at **4.50:1 light and 3.58:1 dark**: one accent that
     * reads about the same in both, which is what a single token was always claiming to be.
     *
     * **It is still decoration and must never be the only thing carrying meaning.** The state
     * is carried three other ways — the fill, the label colour, and `checked` on a switch —
     * and that, not the ratio, is what makes a border colour safe. Put this on anything whose
     * meaning rests on the border alone and it fails 1.4.11 whatever the number says.
     */
    highlight: '#BC13FE',
    /**
     * The orange-red of the `📍` in `📍 NEAR ME`, and the border of that chip.
     *
     * It reads as the colour of a map pin because that is what it is copying — the emoji the
     * chip already carries in its own label, which every platform draws in some red. The chip
     * and its glyph now agree instead of a green edge sitting around a red pin.
     *
     * **Deliberately not `danger`.** That token is `#C0392B`, tomato, and it means something
     * has gone wrong — a field that failed validation, a lookup that did not resolve. A filter
     * is not an error, and one wearing error ink would be the row's only false sentence. Two
     * names for one hex would have been worse still: this is its own colour with its own job.
     *
     * 3.68:1 on the light chip and 4.38:1 on the dark. Like `highlight` it is identity rather
     * than state, so the ratio is a comfort rather than the thing keeping it conformant.
     */
    locator: '#E4572E',
  },
  dark: {
    text: '#F2EDE4',
    background: '#1A1712',
    backgroundElement: '#262019',
    backgroundSelected: '#26301F', // darkened from #2E3A2C: tint on it was 4.47:1
    // The same job in the dark: a lift off the page with a green cast, well short of
    // `backgroundSelected` so the two stay distinguishable. `text` on it is 14.12:1 and
    // `tint` 6.16:1.
    backgroundAccent: '#1E2019',
    textSecondary: '#B5A995',
    tint: '#6BAE62',
    border: '#3A3226',
    link: '#6FA8D6',
    danger: '#E06052',
    // One hex in both themes, because a neon that shifts hue between them stops reading as one
    // accent. What changed is that it no longer needs to: the old green was 1.36:1 here and
    // 11.9:1 there, so "unchanged rather than tuned" was carrying a 9x difference. Purple is
    // 4.50:1 light and 3.58:1 dark and genuinely is one accent.
    highlight: '#BC13FE',
    // Same hex as the light theme, for the same reason, and it lands the better way round
    // here: 4.38:1 on this chip fill against 3.68:1 on the light one.
    locator: '#E4572E',
  },
} as const;

export type ThemeColor = keyof typeof Colors.light & keyof typeof Colors.dark;

/**
 * Display type is Fraunces — a warm, old-style serif that carries the
 * "market-stand editorial" voice (style guide §3). Loaded in the root layout;
 * these names are the registered expo-font keys, identical on all platforms.
 */
export const Display = {
  black: 'Fraunces_900Black',
  bold: 'Fraunces_700Bold',
  semi: 'Fraunces_600SemiBold',
  italic: 'Fraunces_400Regular_Italic',
} as const;

export const Fonts = Platform.select({
  ios: {
    sans: 'system-ui',
    serif: 'ui-serif',
    rounded: 'ui-rounded',
    mono: 'ui-monospace',
  },
  default: {
    sans: 'normal',
    serif: 'serif',
    rounded: 'normal',
    mono: 'monospace',
  },
  web: {
    sans: 'var(--font-display)',
    serif: 'var(--font-serif)',
    rounded: 'var(--font-rounded)',
    mono: 'var(--font-mono)',
  },
});

// 4-pt spacing scale (style guide §4).
export const Spacing = {
  half: 2,
  one: 4,
  two: 8,
  three: 16,
  four: 24,
  five: 32,
  six: 64,
} as const;

export const Radii = {
  card: 12,
  button: 10,
  pill: 999,
} as const;

/** Soft lift for controls floating over the map (style guide §4). */
export const Elevation = {
  floating: {
    shadowColor: '#000',
    shadowOpacity: 0.1,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 2 },
    elevation: 2,
  },
} as const;

export const BottomTabInset = Platform.select({ ios: 50, android: 80 }) ?? 0;
export const MaxContentWidth = 800;

/**
 * Viewport inset for a camera fit, in points, so a fitted pin never lands under the
 * controls floating over the map: the wordmark above, and the dock below — the filter
 * panel, the sprout disc that opens it, and NEAR ME. Generous at the top because the
 * wordmark clears the notch, and at the bottom because the dock is three stacked controls.
 */
export const MapFitPadding = {
  top: Spacing.six * 2,
  bottom: Spacing.six + Spacing.three,
  left: Spacing.four,
  right: Spacing.four,
} as const;

/** MapLibre style — free, keyless (docs/trd.md §1). Keep behind this constant
 * so a tile-provider change is a one-line diff. */
export const MAP_STYLE_URL = 'https://tiles.openfreemap.org/styles/liberty';
