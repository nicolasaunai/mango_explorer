// Full-data k-NN means from voxel sums; Python reference: src/mango_explorer/atlas/voxels.py.
// Per (frame, condition bin, voxel) the atlas stores the sample count and the sum of each
// quantity. A selection sums its condition bins; a node then takes its nearest voxels (by
// distance to the voxel centre, ties by id) until k samples, the last voxel only partly.
import { grid as defaultGrid, type Grid, type QuantityName } from './grid';
import { loadSections, selectedConditions, type FetchBytes, type Manifest, type Selection } from './atlas';
import { SpatialHash } from './knn';

type Typed = Uint32Array | Uint16Array | Float32Array | Uint8Array | Int32Array;

export function voxelCenter(vid: number, g: Grid = defaultGrid): [number, number, number] {
  const s = g.raw.voxels.size_re, off = g.raw.voxels.index_offset;
  return [(((vid >>> 20) & 1023) - off + 0.5) * s, (((vid >>> 10) & 1023) - off + 0.5) * s, ((vid & 1023) - off + 0.5) * s];
}

/** The selected voxels of one frame and quantity, indexed for neighbour search. */
export type VoxelSet = { vid: Uint32Array; n: Float64Array; sum: Float64Array; centers: Float64Array; hash: SpatialHash; total: number };

export class VoxelFrame {
  private q = new Map<string, Record<string, Typed>>();
  private constructor(readonly manifest: Manifest, readonly frame: string, readonly base: Record<string, Typed>,
    private entry: NonNullable<Manifest['voxels']>['frames'][number], private fetchBytes: FetchBytes) {}

  static async load(manifest: Manifest, frame: string, fetchBytes: FetchBytes) {
    const entry = manifest.voxels?.frames.find((f) => f.frame === frame);
    if (!entry) throw new Error(`this atlas has no voxel sums for ${frame} (rebuild it)`);
    return new VoxelFrame(manifest, frame, await loadSections(fetchBytes, entry.base) as Record<string, Typed>, entry, fetchBytes);
  }

  async quantity(name: QuantityName) {
    if (!this.q.has(name)) this.q.set(name, await loadSections(this.fetchBytes, this.entry.quantities[name]) as Record<string, Typed>);
    return this.q.get(name)!;
  }

  /** Sum the selected condition bins into one entry per voxel. */
  async select(name: QuantityName, sel: Selection, cell: number, g: Grid = defaultGrid): Promise<VoxelSet> {
    const cube = this.manifest.cubes[0];
    const conds = selectedConditions(cube.dims, cube.shape, sel);
    const { n: qn, sum: qs } = await this.quantity(name);
    const off = this.base.cond_offsets, vox = this.base.voxel;
    const index = new Map<number, number>();
    const vids: number[] = [], ns: number[] = [], ss: number[] = [];
    for (const c of conds)
      for (let r = off[c]; r < off[c + 1]; r++) {
        if (qn[r] === 0) continue;
        const v = vox[r];
        let i = index.get(v);
        if (i === undefined) { i = vids.length; index.set(v, i); vids.push(v); ns.push(0); ss.push(0); }
        ns[i] += qn[r]; ss[i] += qs[r];
      }
    const centers = new Float64Array(vids.length * 3);
    vids.forEach((v, i) => centers.set(voxelCenter(v, g), 3 * i));
    return { vid: Uint32Array.from(vids), n: Float64Array.from(ns), sum: Float64Array.from(ss), centers,
      hash: new SpatialHash(centers, cell), total: ns.reduce((a, b) => a + b, 0) };
  }
}

export type VoxelKnnResult = { value: number; n: number; nVoxels: number; distMedian: number };

/** k-NN mean of one node (grid spec "voxels.knn"); `weighted` = 1/d weights as sklearn's 'distance'. */
export function voxelKnnAt(v: VoxelSet, node: [number, number, number], k: number, cap: number, factor: number,
  weighted: boolean, g: Grid = defaultGrid): VoxelKnnResult {
  const size = g.raw.voxels.size_re, maxR = factor * cap, half = Math.ceil(k / 2);
  const out: VoxelKnnResult = { value: NaN, n: 0, nVoxels: 0, distMedian: NaN };
  let cand: { i: number; d: number }[] = [];
  for (let r = Math.min(maxR, Math.max(size, maxR / 8)); ; r = Math.min(2 * r, maxR)) {
    const { idx, dist } = v.hash.nearest(node[0], node[1], node[2], Number.MAX_SAFE_INTEGER, r);
    let tot = 0;
    for (const i of idx) tot += v.n[i];
    cand = idx.map((i, j) => ({ i, d: dist[j] }));
    if (tot >= k || r >= maxR) break;
  }
  cand.sort((a, b) => a.d - b.d || v.vid[a.i] - v.vid[b.i]);
  let cum = 0, m = 0;
  for (; m < cand.length; m++) {
    cum += v.n[cand[m].i];
    if (Number.isNaN(out.distMedian) && cum >= half) out.distMedian = cand[m].d;
    if (cum >= k) { m++; break; }
  }
  if (cum < half) { out.distMedian = NaN; return out; }
  let num = 0, den = 0, used = 0;
  for (let j = 0; j < m; j++) {
    const { i, d } = cand[j];
    const take = j === m - 1 && cum > k ? v.n[i] - (cum - k) : v.n[i];
    const w = weighted ? 1 / Math.max(d, size / 2) : 1;
    num += (w * take * v.sum[i]) / v.n[i];
    den += w * take;
    used += take;
  }
  out.n = used; out.nVoxels = m;
  if (out.distMedian > cap) return out;
  out.value = num / den;
  return out;
}
