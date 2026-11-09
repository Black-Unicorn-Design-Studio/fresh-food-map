/**
 * Pin clustering — the settings and words both map files share.
 *
 * TRD §9 put clustering "above ~200 in-viewport points" and left it unbuilt while the dataset
 * was seventy-odd markets. An OpenStreetMap import takes it past two thousand, at which point a
 * country-wide view is a carpet of identical sprouts: unreadable, and on the web two thousand
 * DOM buttons. Both maps now hand the work to MapLibre's own clusterer (supercluster, on the
 * web and natively), and this module is the one copy of what they must agree on.
 *
 * A cluster is a disc carrying its **count**, so what it means never rests on colour (the
 * accessibility rule this repo had already dropped once on the map). Pressing one zooms to the
 * level at which it splits, which is MapLibre's to compute (`getClusterExpansionZoom`) rather
 * than ours to guess.
 */

/**
 * Pixel radius within which pins merge. MapLibre's default, and the one its clustering
 * examples use. Smaller leaves country views crowded; larger merges towns that are visibly apart.
 */
export const CLUSTER_RADIUS = 50;

/**
 * The last zoom at which pins cluster. Past it every market is its own pin, so two stalls on
 * one street can always be told apart by zooming in, and nothing is ever unreachable behind a
 * cluster that will not split.
 */
export const CLUSTER_MAX_ZOOM = 14;

/**
 * The count as the disc shows it, matching supercluster's `point_count_abbreviated`.
 *
 * Native reads that property straight off the cluster in a style expression; the web draws its
 * clusters as HTML and formats the count here. The two have to print the same thing for the
 * same cluster, so this is supercluster's rule restated exactly and pinned by a test: whole
 * counts below a thousand, one decimal of thousands up to ten thousand, whole thousands above.
 */
export function clusterCountText(count: number): string {
  if (count >= 10000) return `${Math.round(count / 1000)}k`;
  if (count >= 1000) return `${Math.round(count / 100) / 10}k`;
  return String(count);
}

/**
 * The accessible name of a cluster button, which is what a screen reader or a voice-control
 * user acts on. It says what pressing does, because a disc reading "12" tells a sighted user
 * nothing about zooming either; the count in full, because "1.2k" is not how anybody says it.
 */
export function clusterLabel(count: number): string {
  return `${count} ${count === 1 ? 'market' : 'markets'} here, zoom in`;
}

/**
 * The painted disc's diameter, by how many markets it holds: bigger clusters read as bigger
 * without anyone needing to read the number first. The **press target** is separate and does
 * not shrink with it — see each map file — because a small cluster is no easier to hit.
 */
export function clusterDiameter(count: number): number {
  if (count >= 100) return 42;
  if (count >= 10) return 36;
  return 30;
}

/**
 * One entry per cluster or market, from what `querySourceFeatures` returned.
 *
 * MapLibre answers per *tile*, so a cluster or a pin sitting near a tile boundary comes back
 * once per tile it touches. Building a marker per answer would stack duplicates, each its own
 * tab stop announcing the same thing. Keyed on the cluster's id or the market's own UUID — the
 * feature id is a hash the renderer uses and the app does not.
 */
export function uniqueRendered<
  T extends { properties?: Record<string, unknown> | null },
>(features: readonly T[]): Map<string, T> {
  const out = new Map<string, T>();
  for (const feature of features) {
    const p = feature.properties ?? {};
    const key =
      p.cluster === true || typeof p.cluster_id === 'number'
        ? `cluster:${String(p.cluster_id)}`
        : typeof p.id === 'string'
          ? `market:${p.id}`
          : null;
    if (key && !out.has(key)) out.set(key, feature);
  }
  return out;
}
