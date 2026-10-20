/**
 * Where the map hangs a market's summary card.
 *
 * This is the native map's half of a job the web map's popup library does for itself, and the
 * bug it exists to prevent has already happened once on the web, where the library was asked
 * to choose before there was anything to measure: a pin 61px from the left and 130px from the
 * top of a 900×560 window produced a card at left -69, top -124. Half a card off two edges,
 * and only for markets near a corner — so the routes a reader is most likely to try first look
 * fine.
 *
 * It answers in pixels from the map's top-left corner. It used to answer in maplibre anchors,
 * and the change is a bug fix rather than a refactor: on iOS an anchor or an offset moves what
 * the annotation *draws* and leaves its touch frame behind, so a card against a screen edge
 * painted correctly and took presses half a card away. The card is an ordinary positioned view
 * over the map now, and these coordinates are where it goes.
 */
import { strict as assert } from 'node:assert';
import { describe, test } from 'node:test';

import { nearestFeature, placeCallout } from '@/lib/callout-anchor';

/** A phone-shaped map with the card the app actually draws. */
const view = { width: 390, height: 700 };
const card = { width: 260, height: 230 };
const gap = 20;

const place = (x: number, y: number, over: Partial<typeof view> = {}) =>
  placeCallout({ point: { x, y }, view: { ...view, ...over }, card, gap });

describe('placeCallout', () => {
  test('a pin in open middle ground centres the card above it', () => {
    const { left, top, above } = place(195, 400);
    assert.equal(above, true);
    assert.equal(left, 195 - card.width / 2, 'centred on the pin');
    assert.equal(top, 400 - gap - card.height, 'a gap clear of the pin');
  });

  test('a pin too close to the top puts the card below it instead', () => {
    // 130 above leaves 110 after the gap, and the card is 230. Above would clip.
    const { top, above } = place(195, 130);
    assert.equal(above, false);
    assert.equal(top, 130 + gap, 'and the gap swaps sides with it');
  });

  test('a pin near the left edge slides the card just far enough to fit', () => {
    // Centred, a 260 card on a pin 61 from the left reaches -69. It slides to 0 and no further:
    // the card stays as close to centred on its own pin as the screen allows.
    assert.equal(place(61, 400).left, 0);
  });

  test('a pin near the right edge slides it back the other way', () => {
    assert.equal(place(view.width - 61, 400).left, view.width - card.width);
  });

  test('the corner that was broken is clamped on both axes at once', () => {
    const { left, top, above } = place(61, 130);
    assert.equal(left, 0);
    assert.equal(above, false);
    assert.equal(top, 130 + gap);
  });

  test('a card is never placed off the left or right of the map', () => {
    // The whole point of the clamp, and the assertion that keeps it: a card half off the screen
    // is how this started, and the half that goes missing carries the `✕`.
    for (const x of [-50, 0, 61, 130, 195, view.width - 61, view.width, view.width + 50]) {
      const { left } = place(x, 400);
      assert.ok(left >= 0, `x=${x} placed the card at ${left}`);
      assert.ok(left + card.width <= view.width, `x=${x} ran the card off the right`);
    }
  });

  test('a card wider than the map is pinned to the left, not the right', () => {
    // The clamp inverts without a floor on its upper bound, and the right edge is the one place
    // guaranteed to hide the pin the card belongs to.
    const { left } = placeCallout({
      point: { x: 100, y: 400 },
      view: { width: 200, height: 700 },
      card,
      gap,
    });
    assert.equal(left, 0);
  });

  test('a card is kept out of the band the floating controls occupy', () => {
    // A market near the top opened its card under the wordmark. The controls stopped taking
    // presses, so it was reachable and still looked like a rendering fault — the card covered
    // the app's own name.
    const chrome = { top: 128, bottom: 80 };
    const withChrome = (x: number, y: number) =>
      placeCallout({ point: { x, y }, view, card, gap, chrome });

    // 300 down leaves 152 above the pin once the chrome is taken off, and the card is 230.
    // It opens downward instead of sliding under the wordmark.
    assert.equal(withChrome(195, 300).above, false);
    // Without the chrome the same pin has room and opens upward, which is what changed.
    assert.equal(place(195, 300).above, true);
  });

  test('a card never starts above the chrome, even when it fits nowhere', () => {
    const chrome = { top: 128, bottom: 80 };
    const tall = { width: 260, height: 900 };
    const { top } = placeCallout({ point: { x: 195, y: 600 }, view, card: tall, gap, chrome });
    assert.ok(top >= chrome.top, `card started at ${top}, above the chrome at ${chrome.top}`);
  });

  test('a card that fits neither way takes the roomier side', () => {
    // A short window in landscape, or a very tall card. It will be clipped either way; being
    // clipped at the foot keeps the market's name, which is at the top of the card.
    const squat = { height: 300 };
    assert.equal(place(195, 200, squat).above, true, 'more room above → above');
    assert.equal(place(195, 100, squat).above, false, 'more room below → below');
  });

  test('an unmeasured card still gets a placement rather than nothing', () => {
    // `card.height` is 0 until the first layout pass, and the first render happens before it.
    // A card of no height fits above anywhere, which is also the right default.
    const { above, top } = placeCallout({
      point: { x: 195, y: 400 },
      view,
      card: { width: 260, height: 0 },
      gap,
    });
    assert.equal(above, true);
    assert.equal(top, 400 - gap, 'and it sits a gap above the pin until it has a height');
  });

  test('a view of no size does not throw or produce nonsense coordinates', () => {
    // The map reports its size on layout, and the card can be asked for before that lands.
    const { left, top, above } = placeCallout({
      point: { x: 0, y: 0 },
      view: { width: 0, height: 0 },
      card,
      gap,
    });
    assert.equal(typeof above, 'boolean');
    for (const [name, value] of [['left', left], ['top', top]] as const) {
      assert.ok(Number.isFinite(value), `${name} is not a finite number`);
    }
    assert.equal(left, 0, 'with no room anywhere it goes to the corner rather than off it');
  });
});

/**
 * Which market a press actually meant.
 *
 * The map hands back every pin inside a 44×44 pt hitbox, so this is a list whenever pins sit
 * close together — which at a country-wide zoom is most of them. Taking the first one opened the
 * same market for every pin in a cluster, and since pressing an open market's pin closes it, the
 * second press shut the card rather than opening another. It was reported as duplicate pins, and
 * two fixes went looking for duplicates that were never there.
 */
describe('nearestFeature', () => {
  const at = (lon: number, lat: number, name: string) => ({
    geometry: { type: 'Point', coordinates: [lon, lat] },
    properties: { name },
  });

  test('takes the nearest pin, not the first the renderer listed', () => {
    const features = [at(-83.7, 32.7, 'far'), at(-83.61, 32.619, 'near')];
    assert.equal(nearestFeature(features, [-83.6105, 32.6189])?.properties.name, 'near');
  });

  test('order does not decide it', () => {
    const features = [at(-83.61, 32.619, 'near'), at(-83.7, 32.7, 'far')];
    assert.equal(nearestFeature(features, [-83.6105, 32.6189])?.properties.name, 'near');
  });

  test('a degree of longitude is worth less than a degree of latitude away from the equator', () => {
    // At 54° north a degree of longitude is about 0.59 of a degree of latitude. A press 0.1°
    // east of one market and 0.08° north of another is *nearer* the eastern one once that is
    // accounted for, and nearer the northern one if it is not.
    const features = [at(0.1, 54, 'east'), at(0, 54.08, 'north')];
    assert.equal(nearestFeature(features, [0, 54])?.properties.name, 'east');
  });

  test('an empty list is null rather than a crash', () => {
    assert.equal(nearestFeature([], [0, 0]), null);
  });

  test('a feature with no usable geometry is skipped, not chosen', () => {
    // The bridge types a feature's geometry as a union that may carry no coordinates at all.
    const features = [
      { geometry: { type: 'GeometryCollection' }, properties: { name: 'shapeless' } },
      at(0.001, 0.001, 'real'),
    ];
    assert.equal(nearestFeature(features, [0, 0])?.properties.name, 'real');
  });

  test('a list of nothing usable is null', () => {
    assert.equal(nearestFeature([{ geometry: undefined, properties: { name: 'x' } }], [0, 0]), null);
  });
});
