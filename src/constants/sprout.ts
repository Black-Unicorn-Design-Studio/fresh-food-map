/**
 * The sprout mark, in its two renderings.
 *
 * **The pin is the filled sprout** — a stem and two leaves, green on a white disc: the web map
 * inlines it as SVG, and `scripts/gen-icons.js` rasterises the same coordinates for the native
 * map, because a MapLibre symbol layer takes a registered image and not a path. That script
 * runs outside the app's module graph and cannot import this file, so it holds the one
 * hand-carried copy and says so; a shape change means rerunning it.
 *
 * **The filter disc is the same mark redrawn as chrome** — two bars standing in for the leaves,
 * over the same stem, built from Views because bars and a stem are rectangles and one icon does
 * not justify a drawing dependency. The two were tried as a single glyph and the pin is better
 * filled: at 22px on map tiles a stroked mark reads as a scratch, where a leaf reads as a leaf.
 *
 * What keeps them one mark is that **the bars lie along the leaves' own diagonals**, which is
 * why both live here rather than in the component that draws each. That relationship used to be
 * carried by hand in `filter-toggle.tsx`, and `test/sprout.test.ts` now pins it instead.
 *
 * Drawn on a 24×24 grid, sitting on the baseline so the stem meets the pin's anchor point.
 */
export const SPROUT_VIEWBOX = '0 0 24 24';
export const SPROUT_GRID = 24;

/** Stroked, not filled — it is a stem. `M12 21 V11` as a path, and as numbers for RN. */
export const SPROUT_STEM = 'M12 21 V11';
export const SPROUT_STEM_RN = { x: 12, top: 11, length: 10, thickness: 2 } as const;

/** Filled leaves, left lower and right upper, so the mark reads as growth rather than a bow. */
export const SPROUT_LEAF_LEFT = 'M12 13 C7.2 13 4.5 9.8 4.5 5.5 C9.3 5.5 12 8.7 12 13 Z';
export const SPROUT_LEAF_RIGHT = 'M12 10.5 C16.8 10.5 19.5 7.3 19.5 3 C14.7 3 12 6.2 12 10.5 Z';

/** Stroke width of a bar. Thicker than the stem: a leaf reads heavier than what it grows on. */
export const SPROUT_BAR_THICKNESS = 2.5;

/**
 * The two bars of the filter glyph, as the diagonals the leaves above are drawn along: the
 * lower-left leaf spans (4.5,5.5)→(12,13) and the upper-right one (12,10.5)→(19.5,3), tip to
 * base. Offset rather than mirrored, because the leaves are.
 *
 * Endpoints are the source of truth: a centre plus an angle is three numbers where two points
 * are four, and it is the form that drifts.
 */
export const SPROUT_BARS = [
  { x1: 4.5, y1: 5.5, x2: 12, y2: 13 },
  { x1: 12, y1: 10.5, x2: 19.5, y2: 3 },
] as const;

/** `M x1 y1 L x2 y2` for a bar — what an SVG renderer wants. */
export const barPath = (bar: (typeof SPROUT_BARS)[number]) =>
  `M${bar.x1} ${bar.y1} L${bar.x2} ${bar.y2}`;

/**
 * The same two bars as React Native wants them: a rectangle of `length` × thickness, placed by
 * its top-left corner and rotated about its centre.
 *
 * Derived rather than written down, so the glyph cannot drift from the leaves it stands for.
 * `rotate` is in CSS degrees, where y grows downward and a negative angle therefore lifts the
 * outer end — which is why the upper bar's is negative and reads backwards at first glance.
 */
export const SPROUT_BARS_RN = SPROUT_BARS.map((bar) => {
  const dx = bar.x2 - bar.x1;
  const dy = bar.y2 - bar.y1;
  const length = Math.hypot(dx, dy);
  return {
    length,
    left: (bar.x1 + bar.x2) / 2 - length / 2,
    top: (bar.y1 + bar.y2) / 2 - SPROUT_BAR_THICKNESS / 2,
    rotate: `${(Math.atan2(dy, dx) * 180) / Math.PI}deg`,
  };
});
