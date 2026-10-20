/**
 * Native map (iOS/Android) via MapLibre. Web has its own implementation in
 * market-map.web.tsx — keep both prop-compatible.
 *
 * Note: this native module is not in Expo Go; use a dev build
 * (`npx expo run:ios` / `run:android`). See README "Running the app".
 */
import {
  Camera,
  GeoJSONSource,
  Images,
  Layer,
  Map,
  type MapRef,
  type PressEventWithFeatures,
} from '@maplibre/maplibre-react-native';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useReducedMotion } from 'react-native-reanimated';
import { StyleSheet, View, type LayoutChangeEvent, type NativeSyntheticEvent } from 'react-native';

import { MarketCallout } from '@/components/market-callout';
import { MAP_STYLE_URL, MapFitPadding } from '@/constants/theme';
import { nearestFeature, placeCallout } from '@/lib/callout-anchor';
import { type Bounds, type LatLon } from '@/lib/geo';
import { type Market } from '@/lib/markets';

/**
 * How far above the pin the summary card sits, in pixels.
 *
 * The pin is 28 across and drawn centred on its coordinate, so 14 clears its top edge exactly
 * and anything less overlaps the mark the card is pointing at. 20 leaves six points of air,
 * which is enough for the shadow to read as a gap rather than a seam.
 */
const CALLOUT_OFFSET = 20;

/**
 * The card's width, as `market-callout.tsx` fixes it.
 *
 * Restated rather than imported because it is needed *before* the card has been laid out — the
 * first placement happens on the same frame the card first renders, and a width of zero there
 * would centre a 260-wide card on a pin near the edge and hang it off. It is only the seed:
 * every placement after the first measures the card itself.
 */
const CALLOUT_WIDTH = 260;

export interface MarketMapProps {
  markets: Market[];
  center: LatLon;
  zoom?: number;
  /**
   * A box to frame instead of `center`/`zoom`, used to hold two points on screen at once —
   * the shopper and the market nearest them. Wins when set, since a fit answers "where am
   * I relative to it", which a centre and a guessed zoom cannot.
   */
  bounds?: Bounds;
  onSelectMarket: (id: string) => void;
  /**
   * The market whose summary card is open, anchored to its own pin. `null` means none.
   *
   * The map owns the *placing* of the card and nothing else: which market is selected is the
   * screen's state, because it survives a filter change and the camera does not.
   */
  selected?: Market | null;
  onCloseSelected?: () => void;
  onOpenDetails?: (id: string) => void;
}

export function MarketMap({
  markets,
  center,
  zoom = 4,
  bounds,
  onSelectMarket,
  selected,
  onCloseSelected,
  onOpenDetails,
}: MarketMapProps) {
  const mapRef = useRef<MapRef>(null);
  /** The map's own size, for deciding whether a card would hang off an edge. */
  const [view, setView] = useState({ width: 0, height: 0 });
  /** The card's size, which is only known once it has been laid out once. */
  const [card, setCard] = useState({ width: 0, height: 0 });
  /** Where the selected pin currently sits on screen, in pixels. */
  const [point, setPoint] = useState<{ x: number; y: number } | null>(null);

  /**
   * **Zero when the reader has asked for less motion.** §6 has been promising this and neither
   * map file read the preference, so every camera move eased at MapLibre's default. It stopped
   * being theoretical when the camera began re-framing after *every* filter interaction rather
   * than only on a located press: a reader with vestibular sensitivity gets a flight across the
   * country on each chip.
   *
   * The frame still changes — it arrives instead of travelling. Not moving at all would leave
   * the map showing somewhere the filters no longer describe, which is a worse answer to a
   * request about animation than moving instantly.
   */
  const motionMs = useReducedMotion() ? 0 : undefined;

  /**
   * A stable **number** for a feature id, because the style spec does not accept anything else.
   *
   * A GeoJSON feature's `id` has to be an integer for maplibre to use it, and ours were the
   * market's UUID — a string, silently ignored. This is conformance and nothing more: it was
   * added while chasing what looked like duplicate pins and did not fix them, because there
   * were none. `nearestFeature` in `handlePress` is what fixed that. Kept because a string id
   * is still wrong, and because feature state and cross-tile matching both want a real one.
   *
   * Hashed rather than indexed. An index is a number and would do until the filters change, at
   * which point every market's id shifts by however many were dropped above it, and the
   * renderer is told that every symbol on screen is now a different symbol. FNV-1a over the
   * UUID gives the same market the same number whatever else is shown.
   *
   * `properties.id` keeps the real UUID, which is what `handlePress` reads and what the rest of
   * the app knows a market by. This number is the renderer's business and nobody else's.
   */
  const featureId = (uuid: string) => {
    let hash = 0x811c9dc5;
    for (let i = 0; i < uuid.length; i++) {
      hash ^= uuid.charCodeAt(i);
      hash = Math.imul(hash, 0x01000193);
    }
    return hash >>> 0;
  };

  const shape = useMemo(
    () => ({
      type: 'FeatureCollection' as const,
      features: markets.map((m) => ({
        type: 'Feature' as const,
        id: featureId(m.id),
        geometry: { type: 'Point' as const, coordinates: [m.lon, m.lat] },
        properties: { id: m.id, name: m.name },
      })),
    }),
    [markets]
  );

  function handlePress(event: NativeSyntheticEvent<PressEventWithFeatures>) {
    /**
     * **The nearest pin to the press, not the first one the renderer listed.**
     *
     * The source hands back every feature inside a 44×44 pt hitbox, which at a country-wide
     * zoom is most of a town at once. `features[0]` therefore answered with the same market for
     * every pin in a cluster — and since pressing a pin whose card is already open closes it,
     * the second press shut the card rather than opening another. Reported, reasonably, as
     * duplicate pins.
     */
    const { features, lngLat } = event.nativeEvent;
    const id = nearestFeature(features ?? [], lngLat)?.properties?.id;
    if (typeof id !== 'string') return;
    /**
     * **A pin press must not also reach the map**, or the card opens and shuts in one tap.
     *
     * MapLibre emits this press on the `Source` *and* on the `Map` — its own docs say so, and
     * say `stopPropagation` is the way to stop it. That was free while the map ignored presses
     * and became a defect the moment it started closing the card on one: every pin press
     * selected a market and then immediately deselected it, so the card never appeared at all.
     * Caught on a device, which is the only place this path runs.
     *
     * The web map has had the same line since it was written (`e.stopPropagation()` on the
     * marker's own click listener), for the same reason, and the two now agree rather than
     * looking like one platform is doing something the other does not need.
     */
    event.stopPropagation();
    // The press already knows where on screen it happened, so the card can be placed correctly
    // on the very first frame. Asking the map to project the coordinate instead is a round trip
    // over the bridge, and the card would be drawn once at the default anchor before the answer
    // came back — a visible jump, on exactly the markets near an edge where the correction
    // matters most.
    setPoint(event.nativeEvent.point ? { x: event.nativeEvent.point[0], y: event.nativeEvent.point[1] } : null);
    onSelectMarket(id);
  }

  /**
   * Where the selected pin is now, after the camera has moved.
   *
   * The press gives the first answer; this keeps it true. A pin that was mid-screen when it was
   * pressed can be at the edge two gestures later, and the card has to reorient with it or go
   * back to hanging off the side — which is the whole defect this machinery exists to fix.
   *
   * **On `onRegionIsChanging` as well as `onRegionDidChange`, which it did not used to need.**
   * While the card was a map annotation the native side carried it with the map and this only
   * supplied an anchor, so updating once the gesture settled was enough — the old note here
   * said as much, and reasoned that a card re-hanging itself mid-pan is more distracting than
   * one that settles afterwards. That was right about anchors and is wrong about coordinates:
   * the card is an overlay now and this projection *is* its position, so waiting for the end of
   * the gesture would leave it parked on screen while the map slid out from under it.
   *
   * It costs a bridge round trip per frame of a gesture, which is the price of the card being
   * a real view that can be pressed where it is drawn.
   */
  const reproject = useCallback(async () => {
    if (!selected) return;
    try {
      const projected = await mapRef.current?.project([selected.lon, selected.lat]);
      if (projected) setPoint({ x: projected[0], y: projected[1] });
    } catch {
      // The map was not ready, or went away mid-flight. The previous placement stands, which is
      // a stale anchor at worst — never a crash, and never a card that fails to appear.
    }
  }, [selected]);

  useEffect(() => {
    reproject();
  }, [reproject]);

  // Above the pin and centred until something says otherwise — which is what `placeCallout`
  // says, given a pin with room around it.
  const placement = placeCallout({
    point: point ?? { x: view.width / 2, y: view.height / 2 },
    view,
    card: { width: card.width || CALLOUT_WIDTH, height: card.height },
    gap: CALLOUT_OFFSET,
    // The same band the camera keeps clear when it fits a frame. A pin may sit under the
    // wordmark; a card the size of a paragraph may not.
    chrome: { top: MapFitPadding.top, bottom: MapFitPadding.bottom },
  });

  const measureCard = (event: LayoutChangeEvent) => {
    const { width, height } = event.nativeEvent.layout;
    // Guarded, because this sets state from layout and layout follows state: without it a card
    // whose measured height differs by a rounding step from the one that produced it would
    // re-render forever.
    setCard((previous) =>
      Math.abs(previous.width - width) < 1 && Math.abs(previous.height - height) < 1
        ? previous
        : { width, height }
    );
  };

  return (
    <View style={styles.container}>
      <Map
        ref={mapRef}
      mapStyle={MAP_STYLE_URL}
      onLayout={(event: LayoutChangeEvent) => setView(event.nativeEvent.layout)}
      /**
       * A tap on open map puts the card away, matching the web (`closeOnClick` there).
       *
       * The two platforms reach it by opposite routes, which is the usual shape of this file:
       * the web popup has the behaviour built in and only had to be switched on, while a
       * MapLibre `MapView` has no such notion and needs the press handled here. `onPress`
       * fires for taps that miss every interactive layer — a tap *on* a pin is consumed by
       * the source's own `onPress` below and never reaches this — so it is already "the map
       * itself", which is exactly the gesture wanted. A drag is a pan and emits no press.
       */
      onPress={() => onCloseSelected?.()}
      onRegionIsChanging={reproject}
      onRegionDidChange={reproject}>
      {/* Two spellings rather than one spread: `center` and `bounds` are mutually exclusive
          in CameraStop, so a conditional spread widens to a union the props reject. */}
      {bounds ? (
        <Camera bounds={bounds} padding={MapFitPadding} duration={motionMs} />
      ) : (
        <Camera center={[center.lon, center.lat]} zoom={zoom} duration={motionMs} />
      )}
      {/* A symbol layer takes a registered image rather than a path, so the sprout the web
          map inlines as SVG is rasterised into this asset. Generated: edit the shape in
          src/constants/sprout.ts, mirror it in scripts/gen-icons.js and rerun that script.
          Do not hand-edit the PNG. */}
      <Images images={{ sprout: require('../../assets/images/pin-sprout.png') }} />
      <GeoJSONSource id="markets" data={shape} onPress={handlePress}>
        {/* Every pin is identical. The map answers "where are the markets"; trust is carried
            by merging, not by a per-listing grade — which is also why nothing here
            depends on telling two pin colours apart. */}
        <Layer
          id="market-pins"
          type="symbol"
          layout={{
            'icon-image': 'sprout',
            // Drawn at 3x so it stays crisp on dense displays.
            'icon-size': 1 / 3,
            // Markets in the same town must not silently vanish; clustering is the real
            // answer to crowding and is not built yet.
            'icon-allow-overlap': true,
          }}
        />
      </GeoJSONSource>

      {/* `Marker` and not `ViewAnnotation`: the latter renders its children onto a bitmap on
          Android, which is faster and cannot be pressed — and this card is mostly a button.
          One marker only ever exists, for the selected market; the other pins stay a symbol
          layer, which is what keeps a few hundred of them cheap.

          `anchor="bottom"` puts the card's bottom edge on the coordinate, so it sits above the
          pin rather than over it — and above is also away from the dock at the foot of the
          screen, which is the one thing that can paint over it. */}
      </Map>

      {/* **The card is an overlay, not a map annotation**, and that is the fix for a `✕` that
          could not be pressed. Three attempts to place it as an annotation — a corner anchor, a
          pixel offset, padding inside its box — each moved what iOS *drew* and left the touch
          frame behind, so a card against a screen edge answered presses half a card away. An
          ordinary positioned view has no second frame to diverge from.

          `box-none` on the filler so only the card itself takes a touch: the rest of this layer
          is the whole map, and a lid over it would swallow every pan. */}
      {selected && point ? (
        <View pointerEvents="box-none" style={StyleSheet.absoluteFill}>
          <View
            onLayout={measureCard}
            style={{ position: 'absolute', left: placement.left, top: placement.top }}>
            <MarketCallout
              market={selected}
              onClose={() => onCloseSelected?.()}
              onViewDetails={() => onOpenDetails?.(selected.id)}
            />
          </View>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  // The map fills its slot and the callout layer is measured against the same box, so the
  // coordinates `placeCallout` returns and the ones the map projects into are the same space.
  container: { flex: 1 },
});
