/** Web map via maplibre-gl. Prop-compatible with the native market-map.tsx. */
import maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { useReducedMotion } from 'react-native-reanimated';
import { useMemo, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

import { MarketCallout } from '@/components/market-callout';

import {
  SPROUT_LEAF_LEFT,
  SPROUT_LEAF_RIGHT,
  SPROUT_STEM,
  SPROUT_STEM_RN,
  SPROUT_VIEWBOX,
} from '@/constants/sprout';
import { MAP_STYLE_URL, MapFitPadding } from '@/constants/theme';
import { type MarketMapProps } from '@/components/market-map';
import { useTheme } from '@/hooks/use-theme';

/** Hit target. 16px was under the 24px minimum and the pins are the only way into a market. */
const TARGET = 28;
/** The painted disc inside the target. Kept small so neighbouring pins stay distinguishable. */
const DISC = 22;

/** Marks our popup so the tip rules below apply to it and to nothing maplibre adds later. */
const POPUP_CLASS = 'ffm-market-callout';
/** The card's ground colour, handed to the stylesheet so the tip can follow the theme. */
const TIP_COLOR_VAR = '--ffm-callout-bg';

/**
 * The popup's tail, themed.
 *
 * maplibre draws the tip as a CSS triangle — four transparent borders with the one facing the
 * card given a colour — and its own stylesheet hardcodes that colour to white. Our card is
 * `background`, which is off-white in the light theme and nearly black in the dark one, so an
 * unstyled tip is a white wedge hanging off a dark card.
 *
 * It has to be a stylesheet rather than an inline style because *which* border carries the
 * colour depends on where maplibre decided to put the popup, and it re-decides as the map
 * moves: the anchor is a class on the popup root, which these rules key off. Setting all four
 * borders inline instead would paint a square.
 *
 * Injected once per document, on first use rather than at import: a module that writes to
 * `<head>` the moment it loads is a module that cannot be imported by a test or a server
 * renderer.
 */
function ensureTipStyle() {
  const id = 'ffm-callout-tip-style';
  if (typeof document === 'undefined' || document.getElementById(id)) return;
  const side: Record<string, string> = {
    top: 'bottom',
    'top-left': 'bottom',
    'top-right': 'bottom',
    bottom: 'top',
    'bottom-left': 'top',
    'bottom-right': 'top',
    left: 'right',
    right: 'left',
  };
  const style = document.createElement('style');
  style.id = id;
  style.textContent = Object.entries(side)
    .map(
      ([anchor, border]) =>
        `.${POPUP_CLASS}.maplibregl-popup-anchor-${anchor} .maplibregl-popup-tip` +
        `{border-${border}-color:var(${TIP_COLOR_VAR})}`
    )
    .join('');
  document.head.appendChild(style);
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
  const theme = useTheme();
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const markersRef = useRef<maplibregl.Marker[]>([]);
  /**
   * The popup's own empty div, once it exists, so React can portal the card into it.
   *
   * State and not a ref: the portal has to render when the container appears, and a ref
   * changing does not tell React anything.
   */
  const [calloutHost, setCalloutHost] = useState<HTMLElement | null>(null);
  const popupRef = useRef<maplibregl.Popup | null>(null);

  // Held in a ref so the marker effect does not depend on the callback's identity. The
  // parent passes an inline arrow, so every MapScreen render used to tear down and rebuild
  // every marker — dropping keyboard focus to <body>, reachable during the async
  // geolocation window.
  const onSelectRef = useRef(onSelectMarket);
  useEffect(() => {
    onSelectRef.current = onSelectMarket;
  });

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;
    mapRef.current = new maplibregl.Map({
      container: containerRef.current,
      style: MAP_STYLE_URL,
      center: [center.lon, center.lat],
      zoom,
    });
    // Bottom-right: the top right belongs to the app's own floating controls.
    mapRef.current.addControl(new maplibregl.NavigationControl(), 'bottom-right');
    return () => {
      mapRef.current?.remove();
      mapRef.current = null;
    };
    // Initial mount only; center/zoom changes are handled below without a re-init.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /**
   * **Zero when the reader has asked for less motion**, which is a promise §6 has been making
   * and the map has not been keeping: neither map file read the preference, so every fit eased
   * at MapLibre's default. It went from a nuisance to a real one when the camera began
   * re-framing after *every* filter interaction rather than only on a located press — a reader
   * with vestibular sensitivity now gets a flight across the country each time they press a
   * chip.
   *
   * The frame still changes; it arrives rather than travels. Suppressing the fit instead would
   * leave the map showing somewhere the filters no longer describe, which is a worse answer to
   * a request about animation.
   */
  /**
   * Spread, never passed as an explicit `undefined`.
   *
   * `easeTo({ duration: undefined })` is not the same as omitting the key: MapLibre reads the
   * property as given and the arithmetic downstream produces a null transform, which surfaces
   * as `Cannot read properties of null` inside `_calcMatrices` mid-ease and then a re-entered
   * render loop. An absent key takes the library's own default; a present undefined does not.
   */
  const reducedMotion = useReducedMotion();
  // Memoised because both camera effects depend on it, and a fresh object each render would
  // re-run them on every render — which is the "fights the user for the camera" failure this
  // file already warns about, reintroduced through a dependency rather than an inline literal.
  const motion = useMemo(() => (reducedMotion ? { duration: 0 } : {}), [reducedMotion]);

  // A fit outranks a centre: both describe the same camera, and the caller sends `center` on
  // every locate whether or not there is a market to frame. Without this guard the two
  // effects raced on the same press and the ease landed after the fit, undoing it.
  useEffect(() => {
    if (bounds) return;
    mapRef.current?.easeTo({ center: [center.lon, center.lat], zoom, ...motion });
  }, [center.lat, center.lon, zoom, bounds, motion]);

  // Kept apart from the centre effect rather than folded into it: the two cannot both drive
  // the camera, and a fit must not be undone by a stale centre re-running beside it. The
  // parent changes one or the other, never both.
  //
  // Keyed on the array's identity, not on the four numbers it holds. Asking to be framed is
  // an intent, and the same intent can recur with identical coordinates — press NEAR ME
  // twice without moving, and a value-keyed effect concludes nothing changed and leaves the
  // camera wherever the user has since panned it. So the caller must hold `bounds` in state
  // and hand over a new array per fit; an inline literal would re-fit on every render and
  // fight the user for the camera.
  useEffect(() => {
    if (!bounds) return;
    const [west, south, east, north] = bounds;
    mapRef.current?.fitBounds(
      [
        [west, south],
        [east, north],
      ],
      { padding: MapFitPadding, ...motion }
    );
  }, [bounds, motion]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    markersRef.current.forEach((m) => m.remove());
    markersRef.current = markets.map((market) => {
      const el = document.createElement('button');
      el.setAttribute('aria-label', market.name);
      // The button is the target; the disc is only paint. Transparent padding around a
      // smaller disc keeps neighbouring pins visually apart while meeting the target size.
      el.style.cssText =
        `width:${TARGET}px;height:${TARGET}px;border-radius:50%;cursor:pointer;` +
        'background:transparent;border:0;padding:0;display:grid;place-items:center';

      // A white disc carrying a green sprout — filled leaves, not the filter disc's bars. The
      // two marks were briefly one; at 22px over pale tiles the stroked version read as a
      // scratch rather than a plant, so the pin keeps the filled shape and the chrome keeps
      // the drawn one.
      //
      // Every pin is identical: the map shows where markets are. There is no per-listing grade
      // anywhere — merging is the check — so no meaning rests on pin colour here, which is the
      // simplest possible answer to "never colour alone".
      const disc = document.createElement('span');
      disc.setAttribute('aria-hidden', 'true');
      disc.style.cssText =
        `width:${DISC}px;height:${DISC}px;box-sizing:border-box;border-radius:50%;` +
        'background:#fff;border:1px solid rgba(0,0,0,.12);box-shadow:0 1px 4px rgba(0,0,0,.35);' +
        'display:grid;place-items:center';
      // Static markup, no interpolated market data.
      disc.innerHTML =
        `<svg viewBox="${SPROUT_VIEWBOX}" width="${DISC - 4}" height="${DISC - 4}" fill="none" ` +
        'aria-hidden="true" focusable="false">' +
        `<path d="${SPROUT_STEM}" stroke="${theme.tint}" ` +
        `stroke-width="${SPROUT_STEM_RN.thickness}" stroke-linecap="round"/>` +
        `<path d="${SPROUT_LEAF_LEFT}" fill="${theme.tint}"/>` +
        `<path d="${SPROUT_LEAF_RIGHT}" fill="${theme.tint}"/>` +
        '</svg>';
      el.appendChild(disc);

      el.addEventListener('click', (e) => {
        e.stopPropagation();
        onSelectRef.current(market.id);
      });
      return new maplibregl.Marker({ element: el }).setLngLat([market.lon, market.lat]).addTo(map);
    });

    // maplibre appends every marker once and thereafter only transforms it, and the map
    // clips overflow — so a pin scrolled out of view stayed a focusable, announcing tab
    // stop for a market nobody could see, and Enter navigated away from the map.
    // tabIndex alone is not enough: it leaves the element reachable in browse mode.
    const syncOffscreen = () => {
      const bounds = map.getBounds();
      for (const marker of markersRef.current) {
        const el = marker.getElement();
        const onScreen = bounds.contains(marker.getLngLat());
        el.tabIndex = onScreen ? 0 : -1;
        el.toggleAttribute('aria-hidden', !onScreen);
      }
    };
    syncOffscreen();
    // moveend covers pan, zoom and resize.
    map.on('moveend', syncOffscreen);
    return () => {
      map.off('moveend', syncOffscreen);
      markersRef.current.forEach((m) => m.remove());
      markersRef.current = [];
    };
    // theme is deliberately absent: recolouring happens in place below, because rebuilding
    // markers on an OS colour-scheme change would drop focus.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [markets]);

  // Recolour in place rather than rebuilding: tearing markers down would drop keyboard
  // focus. Pins previously read the light palette unconditionally and did not follow dark
  // mode at all.
  useEffect(() => {
    for (const marker of markersRef.current) {
      const svg = marker.getElement().querySelector('svg');
      if (!svg) continue;
      const [stem, leafLeft, leafRight] = Array.from(svg.querySelectorAll('path'));
      stem?.setAttribute('stroke', theme.tint);
      leafLeft?.setAttribute('fill', theme.tint);
      leafRight?.setAttribute('fill', theme.tint);
    }
  }, [theme.tint]);

  // The summary card, anchored to the selected pin.
  //
  // Keyed on the id and the two coordinates rather than on the object, so a re-render with an
  // equal market does not tear the popup down and rebuild it — which would drop the focus the
  // card takes when it opens, and blink the tail.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !selected) return;

    ensureTipStyle();
    const host = document.createElement('div');
    const popup = new maplibregl.Popup({
      // Ours, not maplibre's: the card carries its own ✕, which is inside the accessible name
      // and inside the tab order where a reader expects it.
      closeButton: false,
      /**
       * A tap on open map puts the card away, along with the ✕, Escape, and pressing another
       * pin.
       *
       * This was `false`, on the argument that "a press on the map is how somebody looks at
       * the map… where a pan does not [say I am done]". The observation about panning is
       * right and the conclusion did not follow: **MapLibre does not emit `click` after a
       * drag.** It compares pointer-down and pointer-up and suppresses the click when the
       * pointer moved past its threshold, so panning could never have dismissed anything.
       * The rule was defending against a case the library had already ruled out, and what it
       * actually cost was the gesture every map makes available — tapping away from a thing
       * to stop looking at it.
       *
       * `closeOnMove` stays `false` for the half that *was* real: a camera move is not a
       * dismissal, and the card should ride along with the pin it belongs to.
       */
      closeOnClick: true,
      closeOnMove: false,
      // The card moves focus to its own heading; letting maplibre focus the popup first would
      // announce the container and then the heading.
      focusAfterOpen: false,
      // Wider than the card, so the library's own max-width never wraps what we sized.
      maxWidth: '320px',
      // Clears the 28 pt pin plus a little air, the same gap the native map offsets by.
      offset: 20,
    })
      .setDOMContent(host)
      .setLngLat([selected.lon, selected.lat])
      .addTo(map);

    // Strip the library's card so ours is the only one: maplibre's content box brings a white
    // background, a radius and a shadow, and two stacked cards read as a rendering fault.
    const element = popup.getElement();
    element.classList.add(POPUP_CLASS);
    element.style.setProperty(TIP_COLOR_VAR, theme.background);
    const content = element.querySelector('.maplibregl-popup-content') as HTMLElement | null;
    if (content) {
      content.style.padding = '0';
      content.style.background = 'transparent';
      content.style.boxShadow = 'none';
      content.style.borderRadius = '0';
    }

    popupRef.current = popup;
    setCalloutHost(host);
    return () => {
      popup.remove();
      popupRef.current = null;
      setCalloutHost(null);
    };
    // theme.background is read once per popup and updated by the effect below, so it is not a
    // dependency: recolouring must not rebuild the popup.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected?.id, selected?.lat, selected?.lon]);

  /**
   * Make maplibre choose the anchor again, now that there is something to measure.
   *
   * With no `anchor` option a Popup picks one of eight itself, from the point's position and
   * the popup's own width and height — which is what keeps a card near an edge from hanging off
   * it. It makes that choice when the popup is added to the map, and **at that moment this
   * popup is empty**: the host div exists, React has not yet rendered the card into it, so
   * maplibre measures 0×0, concludes the card fits anywhere, and settles on `bottom`. It never
   * revisits the decision on its own. Measured before this effect: a pin 61px from the left and
   * 130px from the top of a 900×560 window put the card at left -69, top -124.
   *
   * `setLngLat` with the coordinates it already has is the public way back in — it re-runs the
   * same update that placed the popup, this time against a card with a size. The ResizeObserver
   * covers everything that changes that size afterwards: a web font landing, a long name
   * wrapping to a second line, tags appearing.
   */
  useEffect(() => {
    const popup = popupRef.current;
    if (!popup || !calloutHost || !selected) return;
    const reanchor = () => popup.setLngLat([selected.lon, selected.lat]);
    reanchor();
    if (typeof ResizeObserver === 'undefined') return;
    // Repositioning does not resize the card, so this cannot feed itself.
    const observer = new ResizeObserver(reanchor);
    observer.observe(calloutHost);
    return () => observer.disconnect();
  }, [calloutHost, selected]);

  // Recolour the tail in place on a scheme change, for the same reason the pins recolour in
  // place: rebuilding would drop focus.
  useEffect(() => {
    const element = calloutHost?.closest(`.${POPUP_CLASS}`) as HTMLElement | null;
    element?.style.setProperty(TIP_COLOR_VAR, theme.background);
  }, [calloutHost, theme.background]);

  return (
    <>
      <div ref={containerRef} style={{ flex: 1, minHeight: 0 }} />
      {calloutHost && selected
        ? createPortal(
            <MarketCallout
              market={selected}
              onClose={() => onCloseSelected?.()}
              onViewDetails={() => onOpenDetails?.(selected.id)}
            />,
            calloutHost
          )
        : null}
    </>
  );
}
