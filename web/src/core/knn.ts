// k-nearest-neighbour statistics; Python reference: src/mango_explorer/atlas/knn.py.
// A node gets the quartiles of its k nearest samples, or NaN when the distance of the
// ceil(k/2)-th nearest exceeds the cap. Only neighbours within factor * cap are searched.
import type { FrameName } from './grid';
import type { Boundaries } from './geometry';
import { mod } from './frames';

const RAD = Math.PI / 180;

/** Azimuth of each sample in `frame` from its GSM azimuth, IMF clock angle and Bx sign. */
export function framePhi(frame: FrameName, phiGsm: number, clockDeg: number, bxNeg: boolean): number {
  if (frame === 'GSM') return mod(phiGsm, 360);
  return mod(phiGsm + clockDeg + (frame === 'PGSM_fold' && bxNeg ? 180 : 0), 360);
}

/** Position (X, Y, Z) in R_E of a sample at (D, theta, phi) between the displayed boundaries. */
export function displayPosition(d: number, thetaDeg: number, phiDeg: number, b: Boundaries): [number, number, number] {
  const t = thetaDeg * RAD, p = phiDeg * RAD, rm = b.rMp(t);
  const r = rm + d * (b.rBs(t) - rm);
  return [r * Math.cos(t), r * Math.sin(t) * Math.cos(p), r * Math.sin(t) * Math.sin(p)];
}

/** Uniform-grid spatial index over points (x, y, z interleaved). */
export class SpatialHash {
  private start: Int32Array;
  private order: Int32Array;
  private min: [number, number, number];
  private dims: [number, number, number];

  constructor(readonly pos: Float64Array, readonly cell: number) {
    const n = pos.length / 3;
    const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
    for (let i = 0; i < n; i++) for (let a = 0; a < 3; a++) { lo[a] = Math.min(lo[a], pos[3 * i + a]); hi[a] = Math.max(hi[a], pos[3 * i + a]); }
    if (!n) { lo.fill(0); hi.fill(0); }
    this.min = lo as [number, number, number];
    this.dims = [0, 1, 2].map((a) => Math.floor((hi[a] - lo[a]) / cell) + 1) as [number, number, number];
    const key = new Int32Array(n), count = new Int32Array(this.dims[0] * this.dims[1] * this.dims[2] + 1);
    for (let i = 0; i < n; i++) { key[i] = this.cellOf(pos[3 * i], pos[3 * i + 1], pos[3 * i + 2]); count[key[i] + 1]++; }
    for (let c = 1; c < count.length; c++) count[c] += count[c - 1];
    this.start = count.slice();
    this.order = new Int32Array(n);
    const fill = count.slice();
    for (let i = 0; i < n; i++) this.order[fill[key[i]]++] = i;
  }

  private cellOf(x: number, y: number, z: number) {
    const [nx, ny] = this.dims;
    const ix = Math.floor((x - this.min[0]) / this.cell), iy = Math.floor((y - this.min[1]) / this.cell), iz = Math.floor((z - this.min[2]) / this.cell);
    return (iz * ny + iy) * nx + ix;
  }

  private d2 = new Float64Array(1024);
  private ix = new Int32Array(1024);

  /** Indices and distances of the (at most k) nearest points within radius, nearest first. */
  nearest(x: number, y: number, z: number, k: number, radius: number): { idx: number[]; dist: number[] } {
    const [nx, ny, nz] = this.dims, c = this.cell, r2 = radius * radius;
    const fx = (x - this.min[0]) / c, fy = (y - this.min[1]) / c, fz = (z - this.min[2]) / c, s = radius / c;
    const x0 = Math.max(0, Math.floor(fx - s)), x1 = Math.min(nx - 1, Math.floor(fx + s));
    const y0 = Math.max(0, Math.floor(fy - s)), y1 = Math.min(ny - 1, Math.floor(fy + s));
    const z0 = Math.max(0, Math.floor(fz - s)), z1 = Math.min(nz - 1, Math.floor(fz + s));
    const p = this.pos;
    let m = 0;
    for (let iz = z0; iz <= z1; iz++)
      for (let iy = y0; iy <= y1; iy++)
        for (let ix = x0; ix <= x1; ix++) {
          const cell = (iz * ny + iy) * nx + ix;
          for (let j = this.start[cell]; j < this.start[cell + 1]; j++) {
            const i = this.order[j], dx = p[3 * i] - x, dy = p[3 * i + 1] - y, dz = p[3 * i + 2] - z;
            const d2 = dx * dx + dy * dy + dz * dz;
            if (d2 > r2) continue;
            if (m === this.d2.length) this.grow();
            this.d2[m] = d2; this.ix[m] = i; m++;
          }
        }
    const take = Math.min(k, m);
    if (m > k) this.select(m, k);
    const top = Array.from({ length: take }, (_, j) => j).sort((a, b) => this.d2[a] - this.d2[b]);
    return { idx: top.map((j) => this.ix[j]), dist: top.map((j) => Math.sqrt(this.d2[j])) };
  }

  private grow() {
    const d2 = new Float64Array(this.d2.length * 2), ix = new Int32Array(this.ix.length * 2);
    d2.set(this.d2); ix.set(this.ix);
    this.d2 = d2; this.ix = ix;
  }

  /** Quickselect: move the k smallest of the first m candidates to the front (unordered). */
  private select(m: number, k: number) {
    const d = this.d2, ix = this.ix;
    const swap = (a: number, b: number) => {
      const t = d[a]; d[a] = d[b]; d[b] = t;
      const u = ix[a]; ix[a] = ix[b]; ix[b] = u;
    };
    let lo = 0, hi = m - 1;
    while (lo < hi) {
      const pivot = d[(lo + hi) >> 1];
      let i = lo, j = hi;
      while (i <= j) {
        while (d[i] < pivot) i++;
        while (d[j] > pivot) j--;
        if (i <= j) { swap(i, j); i++; j--; }
      }
      if (k - 1 <= j) hi = j; else if (k - 1 >= i) lo = i; else break;
    }
  }
}

export type KnnResult = { q25: number; median: number; q75: number; n: number; neff: number; distMedian: number };

const quantile = (sorted: number[], q: number) => {
  const pos = q * (sorted.length - 1), lo = Math.floor(pos), hi = Math.ceil(pos);
  return sorted[lo] + (pos - lo) * (sorted[hi] - sorted[lo]);
};

/** Statistics of the k nearest samples of one node (see the module comment for the NaN rule). */
export function knnAt(hash: SpatialHash, values: ArrayLike<number>, intervals: ArrayLike<number>,
  node: [number, number, number], k: number, cap: number, factor = 2): KnnResult {
  // k points within the cap are the k nearest overall; widen the search only when needed
  let { idx, dist } = hash.nearest(node[0], node[1], node[2], k, cap);
  if (idx.length < k && factor > 1) ({ idx, dist } = hash.nearest(node[0], node[1], node[2], k, factor * cap));
  const half = Math.ceil(k / 2);
  const out: KnnResult = { q25: NaN, median: NaN, q75: NaN, n: idx.length, neff: 0, distMedian: NaN };
  if (idx.length < half) return out;
  out.distMedian = dist[half - 1];
  out.neff = new Set(idx.map((i) => intervals[i])).size;
  if (out.distMedian > cap) return out;
  const v = idx.map((i) => values[i]).sort((a, b) => a - b);
  out.q25 = quantile(v, 0.25); out.median = quantile(v, 0.5); out.q75 = quantile(v, 0.75);
  return out;
}
