/**
 * The sprout mark, in its two renderings: filled leaves for the map pin, two bars for the
 * filter disc, one stem shared.
 *
 * They are the same mark because **the bars lie along the leaves' own diagonals**, and that
 * relationship is exactly the kind that rots — it is geometry stated in prose, spread over
 * three files, two of which import `src/constants/sprout.ts` while `scripts/gen-icons.js`
 * cannot, being plain JS run outside the app's module graph to rasterise the native pin.
 *
 * So two things are pinned here. That the bars still run between their leaf's tip and base,
 * and that `SPROUT_BARS_RN` — the rotated-rectangle form the filter toggle lays out with — is
 * genuinely derived from those endpoints rather than retyped beside them, since a rounding
 * slip there would tilt the chrome a degree away from the pins with nothing to notice it.
 *
 * Nothing renders here. These are coordinates.
 */
import { strict as assert } from 'node:assert';
import { describe, test } from 'node:test';

import {
  SPROUT_BARS,
  SPROUT_BARS_RN,
  SPROUT_BAR_THICKNESS,
  SPROUT_GRID,
  SPROUT_LEAF_LEFT,
  SPROUT_LEAF_RIGHT,
  SPROUT_STEM,
  SPROUT_STEM_RN,
  barPath,
} from '@/constants/sprout';

const closeTo = (actual: number, expected: number, what: string, tolerance = 1e-9) =>
  assert.ok(
    Math.abs(actual - expected) <= tolerance,
    `${what}: expected ${expected} ±${tolerance}, got ${actual}`
  );

describe('the mark fits its own grid', () => {
  test('every drawn point is inside the 24-unit viewbox', () => {
    // The pin is anchored at the bottom of this box and the toggle positions its glyph
    // absolutely inside a 24×24 View. A coordinate outside it is clipped on one surface and
    // overlaps the disc's rim on the other.
    const points = SPROUT_BARS.flatMap((b) => [b.x1, b.y1, b.x2, b.y2]);
    for (const value of points) {
      assert.ok(value >= 0 && value <= SPROUT_GRID, `${value} outside 0..${SPROUT_GRID}`);
    }
  });

  test('the stem path and the stem numbers describe the same line', () => {
    // `M12 21 V11` is what the SVG draws and `SPROUT_STEM_RN` is what the View does. They are
    // two spellings of one stem, and only this asserts they agree.
    const [, x, bottom, top] = /^M(\d+) (\d+) V(\d+)$/.exec(SPROUT_STEM)!.map(Number);
    assert.equal(x, SPROUT_STEM_RN.x);
    assert.equal(top, SPROUT_STEM_RN.top);
    assert.equal(bottom - top, SPROUT_STEM_RN.length);
  });
});

describe('SPROUT_BARS_RN is derived, not retyped', () => {
  test('each bar keeps the length of the line it came from', () => {
    SPROUT_BARS.forEach((bar, i) => {
      const expected = Math.hypot(bar.x2 - bar.x1, bar.y2 - bar.y1);
      closeTo(SPROUT_BARS_RN[i].length, expected, `bar ${i} length`);
    });
  });

  test('rotating the placed rectangle lands on the original endpoints', () => {
    // The real invariant, and the one a hand-carried number would break: take the RN
    // rectangle, rotate it about its own centre by the angle RN was given, and the ends must
    // arrive exactly where the SVG line's ends are. Anything else means the two renderers draw
    // different marks.
    SPROUT_BARS.forEach((bar, i) => {
      const rn = SPROUT_BARS_RN[i];
      const radians = (parseFloat(rn.rotate) * Math.PI) / 180;
      const cx = rn.left + rn.length / 2;
      const cy = rn.top + SPROUT_BAR_THICKNESS / 2;
      const half = rn.length / 2;

      closeTo(cx - half * Math.cos(radians), bar.x1, `bar ${i} x1`);
      closeTo(cy - half * Math.sin(radians), bar.y1, `bar ${i} y1`);
      closeTo(cx + half * Math.cos(radians), bar.x2, `bar ${i} x2`);
      closeTo(cy + half * Math.sin(radians), bar.y2, `bar ${i} y2`);
    });
  });

  test('the two bars are offset, not a symmetric pair', () => {
    // The mark reads as growth because the leaves are staggered. A symmetric V is the shape
    // this is most likely to drift into, and it reads as a tick or a wishbone.
    const [lower, upper] = SPROUT_BARS;
    assert.notEqual(lower.y1, upper.y2, 'bars start at the same height — the stagger is gone');
    assert.ok(upper.y2 < lower.y1, 'the upper bar must reach higher than the lower one starts');
  });
});

describe('the bars stand for the leaves', () => {
  test('each bar runs between its leaf’s own tip and base', () => {
    // This is the sentence that makes the pin and the filter disc one mark rather than two
    // drawings that happen to look alike, and it used to live only in a comment. A leaf is a
    // filled curve and a bar is a line, so the only thing they can share is their endpoints:
    // the lower-left leaf spans (4.5,5.5)→(12,13) and the upper-right one (12,10.5)→(19.5,3).
    // Redraw a leaf without moving its bar and the chrome quietly stops matching the pins.
    const [lower, upper] = SPROUT_BARS;
    assert.ok(
      SPROUT_LEAF_LEFT.includes(`${lower.x1} ${lower.y1}`) &&
        SPROUT_LEAF_LEFT.includes(`${lower.x2} ${lower.y2}`),
      `left leaf ${SPROUT_LEAF_LEFT} does not pass through the lower bar's endpoints`
    );
    assert.ok(
      SPROUT_LEAF_RIGHT.includes(`${upper.x1} ${upper.y1}`) &&
        SPROUT_LEAF_RIGHT.includes(`${upper.x2} ${upper.y2}`),
      `right leaf ${SPROUT_LEAF_RIGHT} does not pass through the upper bar's endpoints`
    );
  });

  test('both leaves are closed paths, so the pin fills rather than strokes', () => {
    // The pin was briefly redrawn as strokes and put back: at 22px on pale tiles a stroked
    // sprout reads as a scratch. An unclosed path fills unpredictably.
    for (const leaf of [SPROUT_LEAF_LEFT, SPROUT_LEAF_RIGHT]) {
      assert.match(leaf.trim(), /Z$/, `${leaf} is not closed`);
    }
  });
});

describe('barPath', () => {
  test('spells a straight line between the two endpoints', () => {
    assert.equal(barPath({ x1: 4.5, y1: 5.5, x2: 12, y2: 13 }), 'M4.5 5.5 L12 13');
  });

  test('emits a path for every bar, with no undefined in it', () => {
    // The web map interpolates this straight into `innerHTML`; an undefined here paints
    // nothing and throws nothing.
    for (const bar of SPROUT_BARS) {
      assert.match(barPath(bar), /^M[\d.]+ [\d.]+ L[\d.]+ [\d.]+$/);
    }
  });
});
