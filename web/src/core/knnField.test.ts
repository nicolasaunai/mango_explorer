import { describe, expect, it } from 'vitest';
import { FIELD_HALF, FIELD_N, knnField, planePoint } from './knnField';
import { SpatialHash, positionAt } from './knn';
import { DISPLAY_BOUNDARIES as b } from './display';
import { FLAG } from './compute';
import { normalizedCoords } from './geometry';

describe('k-NN field', () => {
  // dense samples on the dayside, value = log10(2) everywhere
  const pts: number[] = [];
  for (let d = 0.05; d < 1; d += 0.1)
    for (let th = 0; th < 60; th += 3)
      for (let ph = 0; ph < 360; ph += 10) pts.push(...positionAt(d, th, ph, b));
  const n = pts.length / 3;
  const s = { hash: new SpatialHash(Float64Array.from(pts), 2), values: new Float64Array(n).fill(Math.log10(2)),
    intervals: Float64Array.from({ length: n }, (_, i) => i % 50), n };
  const out = knnField(s, 'Np_ratio', 'median', ['XZ', 'YZ'], 5, b, { k: 20, cap: 2, factor: 2, minNeff: 5, useNeff: true });

  it('fills the dayside sheath and leaves the unsampled flanks NaN', () => {
    const at = (x: number, z: number) => {
      const i = Math.floor(((x + FIELD_HALF) / (2 * FIELD_HALF)) * FIELD_N), j = Math.floor(((z + FIELD_HALF) / (2 * FIELD_HALF)) * FIELD_N);
      return { v: out.fields[0].values[j * FIELD_N + i], f: out.fields[0].flags[j * FIELD_N + i] };
    };
    const nose = (b.rMp(0) + b.rBs(0)) / 2;
    expect(at(nose, 0).v).toBeCloseTo(Math.log10(2), 6);
    expect(at(nose, 0).f).toBe(FLAG.OK);
    expect(at(-10, 25).f).toBe(FLAG.EMPTY);
  });
  it('computes one field per requested plane', () => {
    expect(out.fields.map((f) => f.plane)).toEqual(['XZ', 'YZ']);
  });
  it('profile runs from the magnetopause to the bow shock', () => {
    expect(out.profile).toHaveLength(20);
    expect(out.profile.every((p) => Math.abs(p.q50 - Math.log10(2)) < 1e-9)).toBe(true);
  });
  it('plane points lie in their plane', () => {
    expect(planePoint('XY', 1, 2)).toEqual([1, 2, 0]);
    expect(normalizedCoords(planePoint('YZ', 0, 12), b).thetaDeg).toBeCloseTo(90);
  });
});
