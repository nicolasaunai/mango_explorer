// Flow lines and magnetic field lines: automatic seeds, a lazily evaluated lattice field, RK4 tracing.
// Positions are normalized frame coordinates (R_E); the field comes from the vector voxel k-NN.
import type { Boundaries } from './geometry';
import { normalizedCoords } from './geometry';
import { positionAt } from './knn';

export type Vec3 = [number, number, number];
export type VectorField = (p: Vec3) => Vec3 | null;
export type TraceOptions = { step: number; maxSteps: number; inside: (p: Vec3) => boolean };
export type Polylines = { points: Float32Array; offsets: Uint32Array };

export const LINE = { step: 0.1, maxSteps: 600, lattice: 0.5, flowDepth: 0.95, flowThetaMax: 60, fieldThetaMax: 120 };
const GOLDEN = Math.PI * (3 - Math.sqrt(5));

/** n points on the shell at depth d for theta in [0, thetaMax], evenly spread in solid angle (golden spiral). */
export function seeds(n: number, d: number, thetaMaxDeg: number, b: Boundaries): Vec3[] {
  const cMin = Math.cos((thetaMaxDeg * Math.PI) / 180), out: Vec3[] = [];
  for (let i = 0; i < n; i++) {
    const c = 1 - ((1 - cMin) * (i + 0.5)) / n;
    out.push(positionAt(d, (Math.acos(c) * 180) / Math.PI, (((i * GOLDEN) % (2 * Math.PI)) * 180) / Math.PI, b));
  }
  return out;
}
export const flowSeeds = (n: number, b: Boundaries) => seeds(n, LINE.flowDepth, LINE.flowThetaMax, b);
export const fieldSeeds = (n: number, d: number, b: Boundaries) => seeds(n, d, LINE.fieldThetaMax, b);

/** `evaluate` on a cubic lattice of spacing h, computed on first use, interpolated trilinearly. */
export function latticeField(evaluate: VectorField, h = LINE.lattice): VectorField & { evaluations(): number } {
  const cache = new Map<number, Vec3 | null>();
  const node = (i: number, j: number, k: number) => {
    const key = ((i + 1024) * 2048 + (j + 1024)) * 2048 + (k + 1024);
    let v = cache.get(key);
    if (v === undefined) { v = evaluate([i * h, j * h, k * h]); cache.set(key, v); }
    return v;
  };
  const f = ((p: Vec3) => {
    const x = p[0] / h, y = p[1] / h, z = p[2] / h;
    const i = Math.floor(x), j = Math.floor(y), k = Math.floor(z), fx = x - i, fy = y - j, fz = z - k;
    const out: Vec3 = [0, 0, 0];
    for (let c = 0; c < 8; c++) {
      const di = c & 1, dj = (c >> 1) & 1, dk = (c >> 2) & 1;
      const v = node(i + di, j + dj, k + dk);
      if (!v) return null;
      const w = (di ? fx : 1 - fx) * (dj ? fy : 1 - fy) * (dk ? fz : 1 - fz);
      out[0] += w * v[0]; out[1] += w * v[1]; out[2] += w * v[2];
    }
    return out;
  }) as VectorField & { evaluations(): number };
  f.evaluations = () => cache.size;
  return f;
}

/** True inside the magnetosheath (0 <= D <= 1) and below thetaMax. */
export function insideSheath(b: Boundaries, thetaMaxDeg = LINE.fieldThetaMax) {
  return (p: Vec3) => { const n = normalizedCoords(p, b); return n.d >= 0 && n.d <= 1 && n.thetaDeg < thetaMaxDeg; };
}

/** Streamline along the unit direction of `field` (dir -1: backward), RK4, until it leaves, the field is
 * missing or ~0, or maxSteps. Starts with the seed. */
export function trace(field: VectorField, seed: Vec3, dir: 1 | -1, o: TraceOptions): Vec3[] {
  const unit = (p: Vec3): Vec3 | null => {
    const v = field(p);
    if (!v) return null;
    const m = Math.hypot(v[0], v[1], v[2]);
    return m > 1e-9 && Number.isFinite(m) ? [(dir * v[0]) / m, (dir * v[1]) / m, (dir * v[2]) / m] : null;
  };
  const at = (p: Vec3, k: Vec3, s: number): Vec3 => [p[0] + s * k[0], p[1] + s * k[1], p[2] + s * k[2]];
  const out: Vec3[] = [seed];
  let p = seed;
  for (let s = 0; s < o.maxSteps; s++) {
    const k1 = unit(p); if (!k1) break;
    const k2 = unit(at(p, k1, o.step / 2)); if (!k2) break;
    const k3 = unit(at(p, k2, o.step / 2)); if (!k3) break;
    const k4 = unit(at(p, k3, o.step)); if (!k4) break;
    const q: Vec3 = [0, 1, 2].map((c) => p[c] + (o.step / 6) * (k1[c] + 2 * k2[c] + 2 * k3[c] + k4[c])) as Vec3;
    if (!o.inside(q)) break;
    out.push(q);
    p = q;
  }
  return out;
}

/** One line through the seed: backward end first, forward end last. */
export function traceBoth(field: VectorField, seed: Vec3, o: TraceOptions): Vec3[] {
  return [...trace(field, seed, -1, o).reverse(), ...trace(field, seed, 1, o).slice(1)];
}

export function pack(lines: Vec3[][]): Polylines {
  const kept = lines.filter((l) => l.length >= 2);
  const offsets = new Uint32Array(kept.length + 1);
  kept.forEach((l, i) => (offsets[i + 1] = offsets[i] + l.length));
  const points = new Float32Array(3 * offsets[kept.length]);
  kept.forEach((l, i) => l.forEach((p, j) => points.set(p, 3 * (offsets[i] + j))));
  return { points, offsets };
}
