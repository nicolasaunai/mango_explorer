// A/B comparison per cell, in colour space (log10 for log quantities, so B - A is log10(B/A)).
import { FLAG } from './compute';

export type CellSet = { values: Float32Array; flags: Uint8Array; spread: Float32Array; neffUpper: Uint32Array };

/**
 * B - A per cell, flagged OK only where both cells are reliable and |z| >= zMin, with
 * z = (B - A) / sqrt(sA^2/N_eff,A + sB^2/N_eff,B) and s = IQR/1.349 in colour space.
 * N_eff is the summed upper bound, so z is optimistic: label it approximate.
 */
export function difference(a: CellSet, b: CellSet, zMin = 2) {
  const n = a.values.length;
  const values = new Float32Array(n).fill(NaN), flags = new Uint8Array(n), z = new Float32Array(n).fill(NaN);
  for (let c = 0; c < n; c++) {
    if (a.flags[c] === FLAG.EMPTY || b.flags[c] === FLAG.EMPTY) continue;
    const d = b.values[c] - a.values[c];
    values[c] = d;
    const se = Math.sqrt(a.spread[c] ** 2 / Math.max(1, a.neffUpper[c]) + b.spread[c] ** 2 / Math.max(1, b.neffUpper[c]));
    z[c] = se > 0 ? d / se : d === 0 ? 0 : Infinity;
    const reliable = a.flags[c] === FLAG.OK && b.flags[c] === FLAG.OK;
    flags[c] = reliable && Math.abs(z[c]) >= zMin ? FLAG.OK : FLAG.WEAK;
  }
  return { values, flags, z };
}

/** Symmetric colour range for a difference: the 98th percentile of |B - A| over reliable cells. */
export function symmetricRange(values: Float32Array, flags: Uint8Array): [number, number] {
  let v = Array.from(values).filter((x, i) => flags[i] === FLAG.OK && Number.isFinite(x)).map(Math.abs);
  if (v.length < 3) v = Array.from(values).filter(Number.isFinite).map(Math.abs);
  v.sort((x, y) => x - y);
  const m = v.length ? v[Math.min(v.length - 1, Math.round(0.98 * (v.length - 1)))] : 1;
  return [-(m || 1e-3), m || 1e-3];
}
