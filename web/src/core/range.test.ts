import { describe, expect, it } from 'vitest';
import { axisRange } from './range';

describe('typed colour range', () => {
  it('linear quantities keep their values', () => {
    expect(axisRange(-2, 5, false)).toEqual([-2, 5]);
  });
  it('log quantities are converted to log10', () => {
    const r = axisRange(2, 4, true)!;
    expect(r[0]).toBeCloseTo(Math.log10(2), 12);
    expect(r[1]).toBeCloseTo(Math.log10(4), 12);
  });
  it('rejects min >= max, non-finite values, and non-positive values on a log scale', () => {
    expect(axisRange(4, 2, false)).toBeNull();
    expect(axisRange(3, 3, false)).toBeNull();
    expect(axisRange(NaN, 3, false)).toBeNull();
    expect(axisRange(0, 3, true)).toBeNull();
    expect(axisRange(-1, 3, true)).toBeNull();
  });
});
