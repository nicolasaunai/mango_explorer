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
let cIdx = new Int32Array(1024), cDist = new Float64Array(1024), cShell = new Int32Array(1024);

export function voxelKnnAt(v: VoxelSet, node: [number, number, number], k: number, cap: number, factor: number,
  weighted: boolean, g: Grid = defaultGrid): VoxelKnnResult {
  const size = g.raw.voxels.size_re, maxR = factor * cap, half = Math.ceil(k / 2);
  const out: VoxelKnnResult = { value: NaN, n: 0, nVoxels: 0, distMedian: NaN };
  // grow the radius until it holds k samples: all voxels closer than the k-th are then inside
  let m = 0, r = Math.min(maxR, Math.max(size, maxR / 8));
  for (; ; r = Math.min(2 * r, maxR)) {
    m = v.hash.within(node[0], node[1], node[2], r);
    let tot = 0;
    for (let j = 0; j < m; j++) tot += v.n[v.hash.candidateIndex(j)];
    if (tot >= k || r >= maxR) break;
  }
  if (m > cIdx.length) { cIdx = new Int32Array(2 * m); cDist = new Float64Array(2 * m); cShell = new Int32Array(2 * m); }
  // thin distance shells: whole shells are added in any order, only the shells where the
  // cumulative count crosses k (and k/2, for the median distance) are ordered by (distance, id)
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
  if (shellHalf < 0) return out;  // fewer than ceil(k/2) samples within the search radius
  const ordered = (s: number) => {
    const list: number[] = [];
    for (let j = 0; j < m; j++) if (cShell[j] === s) list.push(j);
    return list.sort((a, b) => cDist[a] - cDist[b] || v.vid[cIdx[a]] - v.vid[cIdx[b]]);
  };
  let c = beforeHalf;
  for (const j of ordered(shellHalf)) { c += v.n[cIdx[j]]; if (c >= half) { out.distMedian = cDist[j]; break; } }

  const last = shellK < 0 ? nShell - 1 : shellK;
  let num = 0, den = 0, total = 0, nVox = 0;
  const add = (j: number, take: number) => {
    const i = cIdx[j], w = weighted ? 1 / Math.max(cDist[j], size / 2) : 1;
    num += (w * take * v.sum[i]) / v.n[i]; den += w * take; total += take; nVox++;
  };
  for (let j = 0; j < m; j++) if (cShell[j] < last) add(j, v.n[cIdx[j]]);
  c = shellK < 0 ? cum - shellN[last] : beforeK;
  for (const j of ordered(last)) {
    const n = v.n[cIdx[j]];
    if (c + n >= k) { add(j, k - c); c = k; break; }
    add(j, n); c += n;
  }
  out.n = total; out.nVoxels = nVox;
  if (out.distMedian > cap) return out;
  out.value = num / den;
  return out;
}
