// Sums the selected condition bins of a cube and reduces them to per-cell statistics.
import { CubeView, SampleTable, httpFetcher, loadManifest, type FetchBytes, type Manifest, type QueryResult, type Selection } from '../core/atlas';
import { buildSamples, knnField, type KnnSamples } from '../core/knnField';
import { DISPLAY_BOUNDARIES } from '../core/display';
import { robustRange as range2 } from '../core/compute';
import { cellFlags, cellSpread, cellValues, depthProfile, robustRange } from '../core/compute';
import { grid, type FrameName, type QuantityName } from '../core/grid';
import { histQuantile } from '../core/stats';
import type { StatsReply, StatsRequest } from './protocol';

let fetchBytes: FetchBytes;
let manifest: Manifest;
const cubes = new Map<FrameName, Promise<CubeView>>();
let last: { quantity: QuantityName; res: QueryResult; frame: FrameName; selection: Selection } | null = null;

let samples: Promise<SampleTable> | null = null;
let knnCache: { key: string; s: KnnSamples; k: number; cap: number } | null = null;
const KNN = grid.raw.knn;

const post = (msg: StatsReply, transfer: Transferable[] = []) => (self as unknown as Worker).postMessage(msg, transfer);

function cube(frame: FrameName) {
  if (!cubes.has(frame)) {
    const entry = manifest.cubes.find((c) => c.frame === frame);
    if (!entry) throw new Error(`the atlas has no cube for frame ${frame}`);
    cubes.set(frame, CubeView.load(entry, fetchBytes));
  }
  return cubes.get(frame)!;
}

self.onmessage = async (e: MessageEvent<StatsRequest>) => {
  const m = e.data;
  try {
    if (m.type === 'init') {
      fetchBytes = httpFetcher(m.base);
      manifest = await loadManifest(fetchBytes);
      post({ type: 'ready', id: m.id, manifest });
    } else if (m.type === 'query') {
      const t0 = performance.now();
      const res = await (await cube(m.frame)).query(m.quantity, m.selection);
      if (m.slot === 'B') last = { quantity: m.quantity, res, frame: m.frame, selection: m.selection };
      const values = cellValues(res, m.quantity, m.stat);
      const flags = cellFlags(res.n, res.neffUpper);
      const n = res.n.slice(), neffUpper = res.neffUpper.slice(), spread = cellSpread(res, m.quantity);
      post({
        type: 'query', id: m.id, slot: m.slot, frame: m.frame, quantity: m.quantity, stat: m.stat,
        values, flags, n, neffUpper, spread, range: robustRange(values, flags),
        profile: depthProfile(res, m.quantity, m.profileThetaMax), ms: performance.now() - t0,
      }, [values.buffer, flags.buffer, n.buffer, neffUpper.buffer, spread.buffer]);
    } else if (m.type === 'knn') {
      const t0 = performance.now();
      samples ??= SampleTable.load(manifest, fetchBytes);
      const table = await samples;
      const key = JSON.stringify([m.frame, m.quantity, m.selection, m.cap]);
      if (knnCache?.key !== key) {
        const values = await table.quantity(m.quantity);
        knnCache = { key, s: buildSamples(table, values, m.frame, m.selection, DISPLAY_BOUNDARIES, m.cap), k: m.k, cap: m.cap };
      }
      knnCache.k = m.k;
      const opts = { k: m.k, cap: m.cap, factor: KNN.search_factor, minNeff: KNN.min_neff };
      const f = knnField(knnCache.s, m.quantity, m.stat, m.plane, m.shell, DISPLAY_BOUNDARIES, opts);
      const all = new Float32Array([...f.field, ...f.shellValues]), flags = new Uint8Array([...f.fieldFlags, ...f.shellFlags]);
      post({
        type: 'knn', id: m.id, frame: m.frame, quantity: m.quantity, stat: m.stat, plane: m.plane, shell: m.shell,
        field: f.field, fieldFlags: f.fieldFlags, shellValues: f.shellValues, shellFlags: f.shellFlags,
        profile: f.profile, range: range2(all, flags), nSamples: knnCache.s.n, ms: performance.now() - t0,
      }, [f.field.buffer, f.fieldFlags.buffer, f.shellValues.buffer, f.shellFlags.buffer]);
    } else if (m.type === 'knnProbe') {
      if (!knnCache) throw new Error('no k-NN query yet');
      const { s, k, cap } = knnCache;
      const { knnAt } = await import('../core/knn');
      const result = knnAt(s.hash, s.values, s.intervals, m.point, k, cap, KNN.search_factor);
      const near = s.hash.nearest(m.point[0], m.point[1], m.point[2], k, KNN.search_factor * cap);
      post({ type: 'knnProbe', id: m.id, cell: m.cell, quantity: JSON.parse(knnCache.key)[1], result, values: near.idx.map((i) => s.values[i]) });
    } else if (m.type === 'probe') {
      if (!last) throw new Error('no query yet');
      const nb = grid.nHist, { res, quantity } = last;
      const c = await cube(last.frame);
      const names = c.entry.spacecraft?.names ?? [];
      const bySc = await c.spacecraftCounts(m.cell, last.selection);
      const hist = res.hist.slice(m.cell * nb, (m.cell + 1) * nb);
      const edges = grid.histAxisEdges(quantity);
      post({
        type: 'probe', id: m.id, cell: m.cell, quantity, hist,
        n: res.n[m.cell], neffUpper: res.neffUpper[m.cell],
        q25: histQuantile(hist, edges, 0.25), q50: histQuantile(hist, edges, 0.5), q75: histQuantile(hist, edges, 0.75),
        spacecraft: names.map((name, i) => ({ name, n: bySc[i] })).filter((s) => s.n > 0),
      });
    }
  } catch (err) {
    post({ type: 'error', id: m.id, message: err instanceof Error ? err.message : String(err) });
  }
};
