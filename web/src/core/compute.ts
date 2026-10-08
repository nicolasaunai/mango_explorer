// Per-cell statistics from summed histograms. Pure functions: they run in the stats worker.
import { grid as defaultGrid, type Grid, type QuantityName } from './grid';
import type { QueryResult } from './atlas';
import { histQuantile } from './stats';

export type Stat = 'median' | 'q25' | 'q75' | 'iqr_rel' | 'n' | 'neff' | 'wmean' | 'mean';
/** Statistics computed from the voxel sums (full data); the others need value distributions. */
export const isVoxelStat = (s: Stat) => s === 'wmean' || s === 'mean';
export const FLAG = { EMPTY: 0, WEAK: 1, OK: 2 } as const;

/** Whether colour values of (q, stat) are log10 of the physical value. */
export const isLogScale = (q: QuantityName, stat: Stat, g: Grid = defaultGrid) =>
  stat === 'n' || stat === 'neff' || (stat !== 'iqr_rel' && g.isLog(q));

/** Physical value of a colour-space value. */
export const toPhysical = (v: number, q: QuantityName, stat: Stat, g: Grid = defaultGrid) =>
  isLogScale(q, stat, g) ? 10 ** v : v;

/** Reliability per cell: empty, weak (too few samples, or with the N_eff overlay too few passes) or OK. */
export function cellFlags(n: ArrayLike<number>, neff: ArrayLike<number>, g: Grid = defaultGrid, useNeff = false): Uint8Array {
  const { min_neff, min_n } = g.reliability;
  const out = new Uint8Array(n.length);
  for (let c = 0; c < n.length; c++)
    out[c] = n[c] === 0 ? FLAG.EMPTY : n[c] < min_n || (useNeff && neff[c] < min_neff) ? FLAG.WEAK : FLAG.OK;
  return out;
}

function quantileAxis(hist: ArrayLike<number>, c: number, edges: number[], nb: number, p: number) {
  return histQuantile(hist, edges, p, c * nb, nb);
}

/** One colour-space value per cell (NaN where empty). */
export function cellValues(res: QueryResult, q: QuantityName, stat: Stat, g: Grid = defaultGrid): Float32Array {
  const nc = g.nCells, nb = g.nHist, edges = g.histAxisEdges(q), log = g.isLog(q);
  const out = new Float32Array(nc).fill(NaN);
  for (let c = 0; c < nc; c++) {
    if (res.n[c] === 0) continue;
    switch (stat) {
      case 'n': out[c] = Math.log10(res.n[c]); break;
      case 'neff': out[c] = Math.log10(res.neffUpper[c]); break;
      case 'median': out[c] = quantileAxis(res.hist, c, edges, nb, 0.5); break;
      case 'q25': out[c] = quantileAxis(res.hist, c, edges, nb, 0.25); break;
      case 'q75': out[c] = quantileAxis(res.hist, c, edges, nb, 0.75); break;
      case 'wmean': case 'mean': break; // k-NN only
      case 'iqr_rel': {
        const v = (p: number) => { const a = quantileAxis(res.hist, c, edges, nb, p); return log ? 10 ** a : a; };
        out[c] = (v(0.75) - v(0.25)) / Math.abs(v(0.5));
        break;
      }
    }
  }
  return out;
}

/** Robust spread per cell in colour space: IQR / 1.349 (a Gaussian sigma), NaN where empty. */
export function cellSpread(res: QueryResult, q: QuantityName, g: Grid = defaultGrid): Float32Array {
  const nc = g.nCells, nb = g.nHist, edges = g.histAxisEdges(q);
  const out = new Float32Array(nc).fill(NaN);
  for (let c = 0; c < nc; c++)
    if (res.n[c] > 0) out[c] = (quantileAxis(res.hist, c, edges, nb, 0.75) - quantileAxis(res.hist, c, edges, nb, 0.25)) / 1.349;
  return out;
}

/** 2nd–98th percentile of the reliable cells, the default colour range. */
export function robustRange(values: Float32Array, flags: Uint8Array, lo = 0.02, hi = 0.98): [number, number] {
  let v = Array.from(values).filter((x, i) => flags[i] === FLAG.OK && Number.isFinite(x));
  if (v.length < 3) v = Array.from(values).filter(Number.isFinite);
  if (!v.length) return [0, 1];
  v.sort((a, b) => a - b);
  const at = (p: number) => v[Math.min(v.length - 1, Math.max(0, Math.round(p * (v.length - 1))))];
  const a = at(lo), b = at(hi);
  return a === b ? [a - 0.5, b + 0.5] : [a, b];
}

export type ProfilePoint = { d0: number; d1: number; q25: number; q50: number; q75: number; n: number };

/** Quantiles vs depth D_msh, pooling every cell with theta below `thetaMaxDeg` (axis space). */
export function depthProfile(res: QueryResult, q: QuantityName, thetaMaxDeg: number, g: Grid = defaultGrid): ProfilePoint[] {
  const [nd, nt, nphi] = g.spatialShape, nb = g.nHist, edges = g.histAxisEdges(q);
  const jMax = g.thetaEdges.findIndex((e) => e >= thetaMaxDeg);
  const out: ProfilePoint[] = [];
  for (let i = 0; i < nd; i++) {
    const h = new Float64Array(nb);
    let n = 0;
    for (let j = 0; j < (jMax < 0 ? nt : jMax); j++)
      for (let k = 0; k < nphi; k++) {
        const c = (i * nt + j) * nphi + k;
        n += res.n[c];
        for (let b = 0; b < nb; b++) h[b] += res.hist[c * nb + b];
      }
    out.push({
      d0: g.dEdges[i], d1: g.dEdges[i + 1], n,
      q25: histQuantile(h, edges, 0.25), q50: histQuantile(h, edges, 0.5), q75: histQuantile(h, edges, 0.75),
    });
  }
  return out;
}

/** Nice tick values for a colour-space range; log scales get 1-2-5 per decade. */
export function ticks(lo: number, hi: number, log: boolean, max = 6): number[] {
  if (log) {
    const out: number[] = [];
    for (let e = Math.floor(lo) - 1; e <= Math.ceil(hi); e++)
      for (const m of [1, 2, 5]) {
        const t = e + Math.log10(m);
        if (t >= lo - 1e-9 && t <= hi + 1e-9) out.push(t);
      }
    // a narrow log range has too few 1-2-5 ticks: use round values of the physical quantity
    if (out.length < 3) return linearTicks(10 ** lo, 10 ** hi, Math.min(max, 5)).filter((v) => v > 0).map(Math.log10);
    return out.length > max ? out.filter((t) => Math.abs(t - Math.round(t)) < 1e-9) : out;
  }
  return linearTicks(lo, hi, max);
}

function linearTicks(lo: number, hi: number, max: number): number[] {
  const span = hi - lo, step0 = span / max, mag = 10 ** Math.floor(Math.log10(step0));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= step0)!;
  const out: number[] = [];
  for (let t = Math.ceil(lo / step - 1e-9) * step; t <= hi + 1e-9; t += step) out.push(+t.toPrecision(12));
  return out;
}

export function formatValue(v: number, digits = 3): string {
  if (!Number.isFinite(v)) return '—';
  const a = Math.abs(v);
  if (a !== 0 && (a >= 1e5 || a < 1e-2)) return v.toExponential(digits - 1).replace('e+', 'e');
  return v.toPrecision(digits).replace(/\.?0+$/, (m) => (m.includes('.') ? '' : m));
}
