/**
 * Where to hang the summary card so it stays on screen.
 *
 * The web map gets this for free: a `maplibregl.Popup` with no fixed anchor picks one of eight
 * itself from the point's position and its own measured size. The native map has no equivalent
 * — MapLibre's `Marker` places the anchor you give it and never reconsiders — so this is that
 * rule, written out, and the reason it is a pure function in `lib` rather than three ternaries
 * inside a component is that it is the kind of thing that is easy to get backwards and
 * invisible when you do: the card simply sits half off the screen for markets near an edge,
 * which nobody sees until they press one.
 *
 * It answers in **pixels from the map's top-left corner**, not in anchors. There were anchors,
 * and `CalloutPlacement` below records why there are none left.
 */
/**
 * Where to draw the card, in pixels from the map's top-left corner.
 *
 * **Absolute coordinates, because the card is no longer a map annotation.** It was one, and
 * three attempts to place it that way all failed the same way on iOS: a corner `anchor`, then a
 * pixel `offset`, then padding inside the annotation's own box. Each moved what was *drawn* and
 * left the touch frame where it started, so a card against a screen edge painted correctly and
 * answered presses half a card away — `VIEW DETAILS` appeared to work only because it spans the
 * full width and still overlapped its own displaced self, while the `✕`, a 44 pt corner, missed
 * entirely.
 *
 * Rather than model that behaviour correctly on the fourth try, the card stopped being an
 * annotation. It is an ordinary absolutely positioned view over the map now, and an ordinary
 * view has no second frame to diverge from: where it is drawn is where it is pressed.
 */
export interface CalloutPlacement {
  /** Pixels from the map's left edge to the card's left edge. */
  left: number;
  /** Pixels from the map's top edge to the card's top edge. */
  top: number;
  /** Whether the card ended up above its pin. Exposed for tests and for the tip, if one returns. */
  above: boolean;
}

export interface PlaceCalloutInput {
  /** The pin's position in the map view, in pixels from its top-left corner. */
  point: { x: number; y: number };
  /** The map view's size. */
  view: { width: number; height: number };
  /** The card's size. Its height is not known until it has been laid out once. */
  card: { width: number; height: number };
  /** The gap between the pin and the card — enough to clear the pin's own disc. */
  gap: number;
  /**
   * Space at the top and bottom of the map that the floating chrome occupies — the wordmark and
   * the gear above, the dock below.
   *
   * **The card treats it as unavailable, exactly as the camera already does.** `MapFitPadding`
   * exists so "a framed pin never lands under the controls floating over the map", and a card
   * is bigger than a pin: a market near the top of the screen opened its card underneath the
   * wordmark, which reads as a rendering fault rather than as a card. Those controls do not take
   * presses any more, so nothing is unreachable — it simply looked wrong, and a summary you have
   * to read around is not a summary.
   *
   * Optional so the function keeps working for a caller with no chrome to dodge, which is what
   * every test that does not care about it passes.
   */
  chrome?: { top: number; bottom: number };
}

export function placeCallout({ point, view, card, gap, chrome }: PlaceCalloutInput): CalloutPlacement {
  // Above by default, and above whenever it fits: the card is read top-down, so opening it
  // downward pushes the name away from the pin the reader just pressed — and on the map screen
  // downward is also where the floating dock is.
  const topEdge = chrome?.top ?? 0;
  const bottomEdge = chrome?.bottom ?? 0;
  const roomAbove = point.y - gap - topEdge;
  const roomBelow = view.height - point.y - gap - bottomEdge;
  // When the card fits in neither direction — a short window, a tall card — take the roomier
  // side rather than insisting on the default. It will still be clipped; it will be clipped by
  // less, and the name at the top survives.
  const above = card.height <= roomAbove || roomAbove >= roomBelow;

  /**
   * Centred on the pin, then slid back inside the viewport if that hangs it off an edge.
   *
   * A clamp rather than the anchor-flipping this used to do. The old rule pinned the card's
   * near *corner* to the pin when it would otherwise overflow, which moved the card further
   * than it needed to go — a pin 60 from the left threw the card 200 to the right of where it
   * wanted to be. Sliding it just far enough keeps it as close to centred on its own pin as
   * the screen allows, which is what the reader is actually looking for.
   *
   * `Math.max(0, …)` on the upper bound matters for a card wider than the map: without it the
   * clamp inverts and pins the card to the right edge, which is the one place it is guaranteed
   * to hide the pin it belongs to.
   */
  const centred = point.x - card.width / 2;
  const left = Math.min(Math.max(centred, 0), Math.max(0, view.width - card.width));

  /**
   * Held out of the chrome even when the card does not fit in the room left over. The flip
   * above handles the ordinary case — a pin too near the top opens its card downward instead —
   * and this covers the one where neither side has room: the card is going to be clipped, and
   * clipped at the foot beats slid under the wordmark, because the name is at the top.
   */
  const top = above
    ? Math.max(topEdge, point.y - gap - card.height)
    : point.y + gap;

  return { left, top, above };
}

/**
 * Which of the markets under a press the reader actually aimed at.
 *
 * **A press on the map returns every pin within a 44×44 pixel hitbox, not the one pressed.**
 * That is the source's documented behaviour and the right behaviour — a 44 pt target is the
 * accessibility floor, and a pin is 28 — but it means `features` is a *list* whenever pins sit
 * close together, which at a country-wide zoom is most of them. Taking `features[0]` gave
 * whichever the renderer happened to return first, so every pin in a cluster in Georgia opened
 * the same market, and pressing a second one fed the same id back to a toggle and shut the card
 * instead of opening it. It reads exactly like duplicate pins, which is what it was reported as
 * and what two earlier fixes here chased.
 *
 * Distance is measured in degrees rather than metres, and squared rather than rooted: this only
 * has to *order* candidates that are all within 44 pixels of one another, and the cheapest
 * comparison that orders them correctly is the right one. Longitude is scaled by `cos(latitude)`
 * so a degree of longitude is worth what it is worth at that latitude — without it, a press
 * between two markets in Georgia would lean north-south, and at Manchester's latitude a degree
 * of longitude is only about six tenths of a degree of latitude.
 */
export function nearestFeature<T extends { geometry?: unknown }>(
  features: readonly T[],
  /** The press, as maplibre gives it: `[longitude, latitude]`. */
  lngLat: readonly [number, number],
): T | null {
  const [pressLon, pressLat] = lngLat;
  let best: T | null = null;
  let bestDistance = Infinity;
  const scale = Math.cos((pressLat * Math.PI) / 180);
  for (const feature of features) {
    // Narrowed by hand rather than by type: the caller's features come from a native bridge
    // as `GeoJSON.Feature`, whose geometry is a union that may be a `GeometryCollection` with
    // no coordinates at all. A press can only ever land on the point layer, so the check is a
    // guard against the type rather than against anything the map does.
    const geometry = feature.geometry as { coordinates?: unknown } | undefined;
    const coordinates = geometry?.coordinates;
    if (!Array.isArray(coordinates) || coordinates.length < 2) continue;
    const [lon, lat] = coordinates;
    if (typeof lon !== 'number' || typeof lat !== 'number') continue;
    const dx = (lon - pressLon) * scale;
    const dy = lat - pressLat;
    const distance = dx * dx + dy * dy;
    // Strictly nearer, so a tie keeps the order the renderer gave — arbitrary, but stable,
    // which matters more than which of two pins at one coordinate wins.
    if (distance < bestDistance) {
      bestDistance = distance;
      best = feature;
    }
  }
  return best;
}
