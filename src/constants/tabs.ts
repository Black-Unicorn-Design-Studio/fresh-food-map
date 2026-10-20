/**
 * The three tabs, in the order they appear, and the one place each one's name is written.
 *
 * A tab's name has to reach two different mechanisms: `options.title` on `Tabs.Screen`, which
 * labels the tab bar, and the **root stack's** `title` for the `(tabs)` route, which labels the
 * back button of anything pushed above the tabs — the market detail screen being the only such
 * screen. A native stack takes that label from the previous screen's title, so one static word
 * up there could only ever name the group: it read `Markets`, and so returning to the map and
 * returning to the list were offered to the reader in the same word. `src/app/(tabs)/_layout.tsx`
 * now sets it from whichever tab has focus.
 *
 * Both consumers read this list, because a tab whose two names disagreed would be a button
 * promising one destination and delivering another — and that is a thing nobody would think to
 * check. `src/app/_layout.tsx` takes the first entry as its static fallback, which is right by
 * construction rather than by a rule somebody has to remember: **order is meaningful here** —
 * the first entry is the route a group opens on, so it is also the tab a back button leads to
 * before any tab has been focused.
 *
 * Not a closed vocabulary in the sense `constants/tags.ts` is: nothing validates against it and
 * adding a tab means adding a file under `src/app/(tabs)/` as well as an entry here.
 */
export const TABS = [
  { name: 'index', title: 'Map', glyph: '🗺️' },
  { name: 'list', title: 'List', glyph: '📋' },
  { name: 'submit', title: 'Submit', glyph: '🧺' },
] as const;
