// Sums the selected condition bins of a cube and reduces them to per-cell statistics.
import { CubeView, httpFetcher, loadManifest, type FetchBytes, type Manifest, type QueryResult, type Selection } from '../core/atlas';
import { cellFlags, cellSpread, cellValues, depthProfile, robustRange } from '../core/compute';
import { grid, type FrameName, type QuantityName } from '../core/grid';
import { histQuantile } from '../core/stats';
import type { StatsReply, StatsRequest } from './protocol';

let fetchBytes: FetchBytes;
let manifest: Manifest;
const cubes = new Map<FrameName, Promise<CubeView>>();
let last: { quantity: QuantityName; res: QueryResult; frame: FrameName; selection: Selection } | null = null;

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
