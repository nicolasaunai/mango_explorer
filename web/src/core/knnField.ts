// Everything the views need in k-NN mode, computed from the selected samples.
import { grid as defaultGrid, type FrameName, type Grid, type QuantityName } from './grid';
import type { SampleTable, Selection } from './atlas';
import type { Boundaries } from './geometry';
import { normalizedCoords } from './geometry';
import { FLAG, type ProfilePoint, type Stat, isLogScale } from './compute';
import { SpatialHash, framePosition, knnAt, positionAt, type KnnResult } from './knn';
import { voxelKnnAt, type VoxelSet } from './voxels';

export type Plane = 'XY' | 'XZ' | 'YZ';
export const FIELD_N = 128; // 0.5 R_E on a 64 R_E plane
export const FIELD_HALF = 32; // the plane spans [-32, 32] R_E on both axes

/** Physics position of plane coordinates (u, v); must match the slice shader. */
export function planePoint(plane: Plane, u: number, v: number): [number, number, number] {
  return plane === 'XZ' ? [u, 0, v] : plane === 'XY' ? [u, v, 0] : [0, u, v];
}

export type KnnSamples = { hash: SpatialHash; values: Float64Array; intervals: Float64Array; n: number };

/** Normalized positions of the selected samples in `frame`, indexed for search. */
export function buildSamples(table: SampleTable, values: Float32Array, frame: FrameName, sel: Selection,
  cap: number): KnnSamples {
  const t = table.base;
  const rows = Array.from(table.rows(sel)).filter((r) => Number.isFinite(values[r]));
  const pos = new Float64Array(rows.length * 3), v = new Float64Array(rows.length), iv = new Float64Array(rows.length);
  rows.forEach((r, i) => {
    pos.set(framePosition(frame, t.x[r], t.y[r], t.z[r], t.clock_deg[r], t.bx_neg[r] === 1), 3 * i);
    v[i] = values[r]; iv[i] = t.interval[r];
  });
  return { hash: new SpatialHash(pos, cap / 2), values: v, intervals: iv, n: rows.length };
}

/** Colour-space value of a k-NN result for a statistic (values are in axis space). */
export function knnValue(r: KnnResult, q: QuantityName, stat: Stat, g: Grid = defaultGrid): number {
  switch (stat) {
    case 'median': return r.median;
    case 'q25': return r.q25;
    case 'q75': return r.q75;
    case 'n': return Number.isFinite(r.median) ? Math.log10(r.n) : NaN;
    case 'neff': return Number.isFinite(r.median) ? Math.log10(r.neff) : NaN;
    case 'wmean': case 'mean': return NaN; // voxel statistics, see voxelField
    case 'iqr_rel': {
      const f = (a: number) => (g.isLog(q) ? 10 ** a : a);
      return (f(r.q75) - f(r.q25)) / Math.abs(f(r.median));
    }
  }
}

export function knnFlag(r: KnnResult, minNeff: number, useNeff: boolean): number {
  return !Number.isFinite(r.median) ? FLAG.EMPTY : useNeff && r.neff < minNeff ? FLAG.WEAK : FLAG.OK;
}

export type KnnOptions = { k: number; cap: number; factor: number; minNeff: number; useNeff: boolean };

export type PlaneField = { plane: Plane; values: Float32Array; flags: Uint8Array };

/** What a node evaluates to: a colour-space value, a reliability flag, and its profile entry. */
export type NodeValue = { v: number; flag: number; q25: number; q50: number; q75: number; n: number };

/** Evaluate the slice planes, the shell map and the Sun-Earth-line profile with one node function. */
export function nodeField(evaluate: (p: [number, number, number]) => NodeValue, planes: Plane[], shell: number,
  b: Boundaries, g: Grid = defaultGrid) {
  const thetaMax = g.thetaEdges[g.thetaEdges.length - 1];
  const step = (2 * FIELD_HALF) / FIELD_N;
  const fields: PlaneField[] = planes.map((plane) => {
    const values = new Float32Array(FIELD_N * FIELD_N).fill(NaN), flags = new Uint8Array(FIELD_N * FIELD_N);
    for (let j = 0; j < FIELD_N; j++)
      for (let i = 0; i < FIELD_N; i++) {
        const p = planePoint(plane, -FIELD_HALF + (i + 0.5) * step, -FIELD_HALF + (j + 0.5) * step);
        const { d, thetaDeg } = normalizedCoords(p, b);
        if (!(d >= 0 && d <= 1) || thetaDeg >= thetaMax) continue;
        const r = evaluate(p);
        values[j * FIELD_N + i] = r.v;
        flags[j * FIELD_N + i] = r.flag;
      }
    return { plane, values, flags };
  });

  const [, nt, nphi] = g.spatialShape;
  const shellValues = new Float32Array(nt * nphi).fill(NaN), shellFlags = new Uint8Array(nt * nphi);
  const dMid = (g.dEdges[shell] + g.dEdges[shell + 1]) / 2;
  for (let j = 0; j < nt; j++)
    for (let k = 0; k < nphi; k++) {
      const th = (g.thetaEdges[j] + g.thetaEdges[j + 1]) / 2, ph = (g.phiEdges[k] + g.phiEdges[k + 1]) / 2;
      const r = evaluate(positionAt(dMid, th, ph, b));
      shellValues[j * nphi + k] = r.v;
      shellFlags[j * nphi + k] = r.flag;
    }

  const profile: ProfilePoint[] = [];
  const nProf = 20;
  for (let i = 0; i < nProf; i++) {
    const d0 = i / nProf, d1 = (i + 1) / nProf;
    const r = evaluate(positionAt((d0 + d1) / 2, 0, 0, b));
    profile.push({ d0, d1, q25: r.q25, q50: r.q50, q75: r.q75, n: Number.isFinite(r.q50) ? r.n : 0 });
  }
  return { fields, shellValues, shellFlags, profile };
}

/** k-NN quantiles over the (sub-sampled) samples. */
export function knnField(s: KnnSamples, q: QuantityName, stat: Stat, planes: Plane[], shell: number,
  b: Boundaries, o: KnnOptions, g: Grid = defaultGrid) {
  const f = nodeField((p) => {
    const r = knnAt(s.hash, s.values, s.intervals, p, o.k, o.cap, o.factor);
    return { v: knnValue(r, q, stat, g), flag: knnFlag(r, o.minNeff, o.useNeff), q25: r.q25, q50: r.median, q75: r.q75, n: r.n };
  }, planes, shell, b, g);
  return { ...f, log: isLogScale(q, stat, g) };
}

/** k-NN means over the voxel sums of the full data. */
export function voxelField(v: VoxelSet, q: QuantityName, stat: Stat, planes: Plane[], shell: number,
  b: Boundaries, o: { k: number; cap: number; factor: number }, g: Grid = defaultGrid) {
  const log = g.isLog(q);
  const f = nodeField((p) => {
    const r = voxelKnnAt(v, p, o.k, o.cap, o.factor, stat === 'wmean', g);
    const axis = log ? Math.log10(r.value) : r.value;
    return { v: axis, flag: Number.isFinite(axis) ? FLAG.OK : FLAG.EMPTY, q25: NaN, q50: axis, q75: NaN, n: r.n };
  }, planes, shell, b, g);
  return { ...f, log };
}
