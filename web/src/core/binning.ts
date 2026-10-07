// Bin indices; Python reference: src/mango_explorer/atlas/binning.py. -1 means "dropped".
import { grid as defaultGrid, type Grid, type QuantityName } from './grid';
import { mod } from './frames';

/** Same as numpy searchsorted(edges, v, 'right') - 1, last edge inclusive, outside → -1. */
export function digitize(v: number, edges: number[]): number {
  const n = edges.length;
  if (!Number.isFinite(v) || v < edges[0] || v > edges[n - 1]) return -1;
  if (v === edges[n - 1]) return n - 2;
  let lo = 0, hi = n; // first index with edges[i] > v
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (edges[mid] <= v) lo = mid + 1; else hi = mid;
  }
  return lo - 1;
}

export function periodicDigitize(deg: number, edges: number[]): number {
  const period = edges[edges.length - 1] - edges[0];
  return digitize(mod(deg - edges[0], period) + edges[0], edges);
}

export function depthIndex(d: number, g: Grid = defaultGrid): number {
  const [lo, hi] = g.dClip;
  if (!Number.isFinite(d) || d < lo || d > hi) return -1;
  const e = g.dEdges;
  return digitize(Math.min(Math.max(d, e[0]), e[e.length - 1]), e);
}

export function spatialCell(d: number, thetaDeg: number, phiDeg: number, g: Grid = defaultGrid): number {
  const [, nt, nphi] = g.spatialShape;
  const i = depthIndex(d, g), j = digitize(thetaDeg, g.thetaEdges), k = periodicDigitize(phiDeg, g.phiEdges);
  return i < 0 || j < 0 || k < 0 ? -1 : (i * nt + j) * nphi + k;
}

export function cellCoords(cell: number, g: Grid = defaultGrid): [number, number, number] {
  const [, nt, nphi] = g.spatialShape;
  return [Math.floor(cell / (nt * nphi)), Math.floor(cell / nphi) % nt, cell % nphi];
}

export function histBin(v: number, q: QuantityName, g: Grid = defaultGrid): number {
  const axis = g.isLog(q) ? Math.log10(v) : v;
  if (!Number.isFinite(axis)) return -1;
  const [lo, hi] = g.histAxisRange(q);
  const pos = ((axis - lo) / (hi - lo)) * g.nHist;
  return Math.min(Math.max(Math.floor(pos), 0), g.nHist - 1);
}
