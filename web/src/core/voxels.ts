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
  private q = new Map<string, Promise<Record<string, Typed>>>();
  private constructor(readonly manifest: Manifest, readonly frame: string, readonly base: Record<string, Typed>,
    private entry: NonNullable<Manifest['voxels']>['frames'][number], private fetchBytes: FetchBytes) {}

  static async load(manifest: Manifest, frame: string, fetchBytes: FetchBytes) {
    const entry = manifest.voxels?.frames.find((f) => f.frame === frame);
    if (!entry) throw new Error(`this atlas has no voxel sums for ${frame} (rebuild it)`);
    return new VoxelFrame(manifest, frame, await loadSections(fetchBytes, entry.base) as Record<string, Typed>, entry, fetchBytes);
  }

  /** One quantity's (or vector component's) per-row count and sum, loaded once. */
  async quantity(name: QuantityName | `${VectorName}_${'x' | 'y' | 'z'}`) {
    const file = this.entry.quantities[name];
    if (!file) throw new Error(`this atlas has no ${name} voxel sums (rebuild it)`);
    if (!this.q.has(name)) {
      const load = loadSections(this.fetchBytes, file) as Promise<Record<string, Typed>>;
      this.q.set(name, load);
      load.catch(() => this.q.delete(name));  // a failed fetch is retried next time
    }
    return this.q.get(name)!;
  }

  /** Sum the selected condition bins into one entry per voxel: counts `n`, and each of `sums`. */
  private sumSelected(sel: Selection, n: Typed, sums: Typed[], cell: number, g: Grid) {
    const cube = this.manifest.cubes[0];
    const conds = selectedConditions(cube.dims, cube.shape, sel);
    const off = this.base.cond_offsets, vox = this.base.voxel, m = sums.length;
    const index = new Map<number, number>();
    const vids: number[] = [], ns: number[] = [], ss: number[][] = sums.map(() => []);
    for (const c of conds)
      for (let r = off[c]; r < off[c + 1]; r++) {
        if (n[r] === 0) continue;
        const v = vox[r];
        let i = index.get(v);
        if (i === undefined) { i = vids.length; index.set(v, i); vids.push(v); ns.push(0); for (const s of ss) s.push(0); }
        ns[i] += n[r];
        for (let k = 0; k < m; k++) ss[k][i] += sums[k][r];
      }
    const centers = new Float64Array(vids.length * 3);
    vids.forEach((v, i) => centers.set(voxelCenter(v, g), 3 * i));
    return { vid: Uint32Array.from(vids), n: Float64Array.from(ns), sums: ss.map((s) => Float64Array.from(s)), centers,
      hash: new SpatialHash(centers, cell), total: ns.reduce((a, b) => a + b, 0) };
  }

  /** Sum the selected condition bins into one entry per voxel. */
  async select(name: QuantityName, sel: Selection, cell: number, g: Grid = defaultGrid): Promise<VoxelSet> {
    const { n, sum } = await this.quantity(name);
    const { sums, ...rest } = this.sumSelected(sel, n, [sum], cell, g);
    return { ...rest, sum: sums[0] };
  }

  /** Sum the selected condition bins of a vector's three component sums (counts are shared). */
  async selectVector(name: VectorName, sel: Selection, cell: number, g: Grid = defaultGrid): Promise<VectorVoxelSet> {
    const names = (['x', 'y', 'z'] as const).map((c) => `${name}_${c}` as const);
    if (names.some((c) => !this.entry.quantities[c])) throw new Error(`this atlas has no ${name} voxel sums (rebuild it)`);
    const comps = await Promise.all(names.map((c) => this.quantity(c)));
    const { sums, ...rest } = this.sumSelected(sel, comps[0].n, comps.map((c) => c.sum), cell, g);
    return { ...rest, sums: [sums[0], sums[1], sums[2]] };
  }
}

export type VoxelKnnResult = { value: number; n: number; nVoxels: number; distMedian: number };

/** k-NN mean of one node (grid spec "voxels.knn"); `weighted` = 1/d weights as sklearn's 'distance'. */
let cIdx = new Int32Array(1024), cDist = new Float64Array(1024), cShell = new Int32Array(1024);

type Walkable = { vid: Uint32Array; n: Float64Array; hash: SpatialHash };

/** Visit the voxels holding a node's k nearest samples (grid spec "voxels.knn"): `use(i, taken, d)` for each
 * voxel, the last one only partly. Returns the samples used, voxels used and the median distance
 * (NaN, and nothing visited, when fewer than ceil(k/2) samples lie within factor * cap). */
function walkNeighbours(v: Walkable, node: [number, number, number], k: number, cap: number, factor: number,
  g: Grid, use: (i: number, taken: number, d: number) => void) {
  const size = g.raw.voxels.size_re, maxR = factor * cap, half = Math.ceil(k / 2);
  const out = { n: 0, nVoxels: 0, distMedian: NaN };
  let m = 0, r = Math.min(maxR, Math.max(size, maxR / 8));
  for (; ; r = Math.min(2 * r, maxR)) {
    m = v.hash.within(node[0], node[1], node[2], r);
    let tot = 0;
    for (let j = 0; j < m; j++) tot += v.n[v.hash.candidateIndex(j)];
    if (tot >= k || r >= maxR) break;
  }
  if (m > cIdx.length) { cIdx = new Int32Array(2 * m); cDist = new Float64Array(2 * m); cShell = new Int32Array(2 * m); }
  const width = size / 4, nShell = Math.floor(r / width) + 2;
  const shellN = new Float64Array(nShell);
  for (let j = 0; j < m; j++) {
    const i = v.hash.candidateIndex(j), d = Math.sqrt(v.hash.candidateD2(j)), sh = Math.min(nShell - 1, Math.floor(d / width));
    cIdx[j] = i; cDist[j] = d; cShell[j] = sh; shellN[sh] += v.n[i];
  }
  let cum = 0, shellK = -1, shellHalf = -1, beforeK = 0, beforeHalf = 0;
  for (let s = 0; s < nShell; s++) {
    if (shellHalf < 0 && cum + shellN[s] >= half) { shellHalf = s; beforeHalf = cum; }
    if (shellK < 0 && cum + shellN[s] >= k) { shellK = s; beforeK = cum; }
    cum += shellN[s];
  }
  if (shellHalf < 0) return out;
  const ordered = (s: number) => {
    const list: number[] = [];
    for (let j = 0; j < m; j++) if (cShell[j] === s) list.push(j);
    return list.sort((a, b) => cDist[a] - cDist[b] || v.vid[cIdx[a]] - v.vid[cIdx[b]]);
  };
  let c = beforeHalf;
  for (const j of ordered(shellHalf)) { c += v.n[cIdx[j]]; if (c >= half) { out.distMedian = cDist[j]; break; } }
  const last = shellK < 0 ? nShell - 1 : shellK;
  const take = (j: number, t: number) => { use(cIdx[j], t, cDist[j]); out.n += t; out.nVoxels++; };
  for (let j = 0; j < m; j++) if (cShell[j] < last) take(j, v.n[cIdx[j]]);
  c = shellK < 0 ? cum - shellN[last] : beforeK;
  for (const j of ordered(last)) {
    const n = v.n[cIdx[j]];
    if (c + n >= k) { take(j, k - c); c = k; break; }
    take(j, n); c += n;
  }
  return out;
}

export function voxelKnnAt(v: VoxelSet, node: [number, number, number], k: number, cap: number, factor: number,
  weighted: boolean, g: Grid = defaultGrid): VoxelKnnResult {
  const size = g.raw.voxels.size_re;
  let num = 0, den = 0;
  const w = walkNeighbours(v, node, k, cap, factor, g, (i, t, d) => {
    const wt = weighted ? 1 / Math.max(d, size / 2) : 1;
    num += (wt * t * v.sum[i]) / v.n[i]; den += wt * t;
  });
  const out: VoxelKnnResult = { value: NaN, n: w.n, nVoxels: w.nVoxels, distMedian: w.distMedian };
  if (!(w.distMedian <= cap)) return out;
  out.value = num / den;
  return out;
}

export type VectorName = 'V_vec' | 'B_vec';
export type VectorVoxelSet = { vid: Uint32Array; n: Float64Array; sums: [Float64Array, Float64Array, Float64Array];
  centers: Float64Array; hash: SpatialHash; total: number };

/** 1/d-weighted k-NN mean vector of a node (each component as voxelKnnAt), or null where that is NaN. */
export function voxelVectorAt(v: VectorVoxelSet, node: [number, number, number], k: number, cap: number, factor: number,
  g: Grid = defaultGrid): [number, number, number] | null {
  const size = g.raw.voxels.size_re;
  const num = [0, 0, 0];
  let den = 0;
  const w = walkNeighbours(v, node, k, cap, factor, g, (i, t, d) => {
    const wt = 1 / Math.max(d, size / 2);
    for (let c = 0; c < 3; c++) num[c] += (wt * t * v.sums[c][i]) / v.n[i];
    den += wt * t;
  });
  if (!(w.distMedian <= cap)) return null;
  return [num[0] / den, num[1] / den, num[2] / den];
}
