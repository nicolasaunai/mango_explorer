import { describe, expect, it } from 'vitest';
import { difference, symmetricRange } from './compare';
import { FLAG } from './compute';

const set = (v: number[], f: number[], s: number[], ne: number[]) => ({
  values: new Float32Array(v), flags: new Uint8Array(f), spread: new Float32Array(s), neffUpper: new Uint32Array(ne),
});

describe('A/B difference', () => {
  it('is B - A, significant only when both are reliable and |z| >= 2', () => {
    const a = set([1, 1, 1, 1], [2, 2, 1, 0], [0.1, 1, 0.1, 0.1], [100, 4, 100, 100]);
    const b = set([1.5, 1.5, 1.5, 1.5], [2, 2, 2, 2], [0.1, 1, 0.1, 0.1], [100, 4, 100, 100]);
    const d = difference(a, b);
    expect(d.values[0]).toBeCloseTo(0.5);
    expect(d.flags[0]).toBe(FLAG.OK);          // z = 0.5 / sqrt(2e-4) ≈ 35
    expect(d.flags[1]).toBe(FLAG.WEAK);        // z = 0.5 / sqrt(0.5) ≈ 0.7
    expect(d.flags[2]).toBe(FLAG.WEAK);        // A unreliable
    expect(d.flags[3]).toBe(FLAG.EMPTY);       // A empty
    expect(Number.isNaN(d.values[3])).toBe(true);
  });
  it('range is symmetric', () => {
    const r = symmetricRange(new Float32Array([-0.2, 0.1, 0.3]), new Uint8Array([2, 2, 2]));
    expect(r[0]).toBe(-r[1]);
    expect(r[1]).toBeCloseTo(0.3);
  });
});
