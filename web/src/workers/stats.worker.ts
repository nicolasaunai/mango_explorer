// Sums the selected condition bins of a cube and reduces them to per-cell statistics.
import { CubeView, SampleTable, httpFetcher, loadManifest, type FetchBytes, type Manifest, type QueryResult, type Selection } from '../core/atlas';
import { buildSamples, knnField, voxelField, type KnnSamples } from '../core/knnField';
import { VoxelFrame, voxelKnnAt, type VoxelSet } from '../core/voxels';
import { isVoxelStat } from '../core/compute';
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
const voxelFrames = new Map<string, Promise<VoxelFrame>>();
let voxCache: { key: string; v: VoxelSet; k: number; cap: number; weighted: boolean } | null = null;
let knnCache: { key: string; s: KnnSamples; k: number; kSearched: number; cap: number } | null = null;

/** k is given in neighbours of the full dataset; the browser holds a random fraction of it, so the
 * same neighbourhood holds about k x fraction of its samples. */
const searchedK = (k: number) => Math.max(1, Math.round(k * (manifest.samples?.fraction ?? 1)));
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
      const flags = cellFlags(res.n, res.neffUpper, undefined, m.useNeff);
      const n = res.n.slice(), neffUpper = res.neffUpper.slice(), spread = cellSpread(res, m.quantity);
      post({
        type: 'query', id: m.id, slot: m.slot, frame: m.frame, quantity: m.quantity, stat: m.stat,
        values, flags, n, neffUpper, spread, range: robustRange(values, flags),
        profile: depthProfile(res, m.quantity, m.profileThetaMax), ms: performance.now() - t0,
      }, [values.buffer, flags.buffer, n.buffer, neffUpper.buffer, spread.buffer]);
    } else if (m.type === 'knn' && isVoxelStat(m.stat)) {
      // full data: k-NN means from the voxel sums
      const t0 = performance.now();
      if (!voxelFrames.has(m.frame)) voxelFrames.set(m.frame, VoxelFrame.load(manifest, m.frame, fetchBytes));
      const vf = await voxelFrames.get(m.frame)!;
      const key = JSON.stringify(['vox', m.frame, m.quantity, m.selection, m.cap]);
      if (voxCache?.key !== key) voxCache = { key, v: await vf.select(m.quantity, m.selection, m.cap / 2), k: m.k, cap: m.cap, weighted: true };
      voxCache.k = m.k; voxCache.weighted = m.stat === 'wmean';
      knnCache = null;
      const f = voxelField(voxCache.v, m.quantity, m.stat, m.planes, DISPLAY_BOUNDARIES,
        { k: m.k, cap: m.cap, factor: KNN.search_factor }, undefined, m.offsets);
      const all = new Float32Array([...f.fields.flatMap((p) => [...p.values]), ...f.shellValues]);
      const flags = new Uint8Array([...f.fields.flatMap((p) => [...p.flags]), ...f.shellFlags]);
      post({
        type: 'knn', id: m.id, frame: m.frame, quantity: m.quantity, stat: m.stat,
        fields: f.fields, shellValues: f.shellValues, shellFlags: f.shellFlags,
        profile: f.profile, range: range2(all, flags), nSamples: voxCache.v.total, ms: performance.now() - t0,
        k: m.k, kSearched: m.k, fraction: 1,
      }, [...f.fields.flatMap((p) => [p.values.buffer, p.flags.buffer]), f.shellValues.buffer, f.shellFlags.buffer]);
    } else if (m.type === 'knn') {
      const t0 = performance.now();
      voxCache = null;
      samples ??= SampleTable.load(manifest, fetchBytes);
      const table = await samples;
      const key = JSON.stringify([m.frame, m.quantity, m.selection, m.cap]);
      if (knnCache?.key !== key) {
        const values = await table.quantity(m.quantity);
        knnCache = { key, s: buildSamples(table, values, m.frame, m.selection, m.cap), k: m.k, kSearched: 0, cap: m.cap };
      }
      const kSearched = searchedK(m.k);
      knnCache.k = m.k; knnCache.kSearched = kSearched;
      const opts = { k: kSearched, cap: m.cap, factor: KNN.search_factor, minNeff: KNN.min_neff, useNeff: m.useNeff };
      const f = knnField(knnCache.s, m.quantity, m.stat, m.planes, DISPLAY_BOUNDARIES, opts, undefined, m.offsets);
      const all = new Float32Array([...f.fields.flatMap((p) => [...p.values]), ...f.shellValues]);
      const flags = new Uint8Array([...f.fields.flatMap((p) => [...p.flags]), ...f.shellFlags]);
      post({
        type: 'knn', id: m.id, frame: m.frame, quantity: m.quantity, stat: m.stat,
        fields: f.fields, shellValues: f.shellValues, shellFlags: f.shellFlags,
        profile: f.profile, range: range2(all, flags), nSamples: knnCache.s.n, ms: performance.now() - t0,
        k: m.k, kSearched, fraction: manifest.samples?.fraction ?? 1,
      }, [...f.fields.flatMap((p) => [p.values.buffer, p.flags.buffer]), f.shellValues.buffer, f.shellFlags.buffer]);
    } else if (m.type === 'knnProbe' && voxCache) {
      const r = voxelKnnAt(voxCache.v, m.point, voxCache.k, voxCache.cap, KNN.search_factor, voxCache.weighted);
      const quantity = JSON.parse(voxCache.key)[2] as QuantityName;
      const axis = grid.isLog(quantity) ? Math.log10(r.value) : r.value;  // probes report axis space
      post({ type: 'knnProbe', id: m.id, cell: m.cell, quantity, values: [], k: voxCache.k, kSearched: voxCache.k,
        result: { q25: NaN, median: axis, q75: NaN, n: r.n, neff: 0, distMedian: r.distMedian }, voxels: r.nVoxels });
    } else if (m.type === 'knnProbe') {
      if (!knnCache) throw new Error('no k-NN query yet');
      const { s, k, kSearched, cap } = knnCache;
      const { knnAt } = await import('../core/knn');
      const result = knnAt(s.hash, s.values, s.intervals, m.point, kSearched, cap, KNN.search_factor);
      const near = s.hash.kNearest(m.point[0], m.point[1], m.point[2], kSearched, KNN.search_factor * cap);
      post({ type: 'knnProbe', id: m.id, cell: m.cell, quantity: JSON.parse(knnCache.key)[1], result,
        values: near.idx.map((i) => s.values[i]), k, kSearched });
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
