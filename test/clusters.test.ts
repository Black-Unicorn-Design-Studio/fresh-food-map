import { strict as assert } from 'node:assert';
import { describe, test } from 'node:test';

import {
  CLUSTER_MAX_ZOOM,
  clusterCountText,
  clusterDiameter,
  clusterLabel,
  uniqueRendered,
} from '@/lib/clusters';

/**
 * The web map draws clusters as HTML and formats their counts itself; the native map reads
 * supercluster's own `point_count_abbreviated`. These pin the web's copy of that rule to
 * supercluster's, so one cluster cannot read "1.2k" on a phone and "1.3k" in a browser.
 */
describe('clusterCountText', () => {
  test('matches supercluster: whole below 1000, one decimal to 10k, whole thousands above', () => {
    assert.equal(clusterCountText(7), '7');
    assert.equal(clusterCountText(999), '999');
    assert.equal(clusterCountText(1000), '1k');
    assert.equal(clusterCountText(1234), '1.2k');
    assert.equal(clusterCountText(1250), '1.3k');
    assert.equal(clusterCountText(9949), '9.9k');
    assert.equal(clusterCountText(10000), '10k');
    assert.equal(clusterCountText(12600), '13k');
  });
});

describe('clusterLabel', () => {
  test('says the count in full and what pressing does', () => {
    assert.equal(clusterLabel(1234), '1234 markets here, zoom in');
    assert.equal(clusterLabel(1), '1 market here, zoom in');
  });
});

describe('clusterDiameter', () => {
  test('grows with the count and never passes the press target it sits in', () => {
    assert.ok(clusterDiameter(2) < clusterDiameter(10));
    assert.ok(clusterDiameter(10) < clusterDiameter(100));
    // Both maps give a cluster a 44-point target, so the disc must fit inside it.
    assert.ok(clusterDiameter(100000) <= 44);
  });
});

describe('uniqueRendered', () => {
  test('keeps one entry per cluster and per market, however many tiles returned it', () => {
    // querySourceFeatures answers per tile, so anything on a tile edge comes back twice.
    const features = [
      { properties: { cluster: true, cluster_id: 7, point_count: 12 } },
      { properties: { id: 'a', name: 'A' } },
      { properties: { cluster: true, cluster_id: 7, point_count: 12 } },
      { properties: { id: 'a', name: 'A' } },
      { properties: { id: 'b', name: 'B' } },
    ];
    const out = uniqueRendered(features);
    assert.deepEqual([...out.keys()], ['cluster:7', 'market:a', 'market:b']);
  });

  test('ignores a feature that is neither a cluster nor a market', () => {
    assert.equal(uniqueRendered([{ properties: {} }, { properties: null }]).size, 0);
  });
});

test('clustering stops at a zoom where a street is still legible', () => {
  // Past this every market is its own pin, so none can stay hidden behind a cluster.
  assert.ok(CLUSTER_MAX_ZOOM >= 13 && CLUSTER_MAX_ZOOM <= 16);
});
