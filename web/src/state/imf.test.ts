import { describe, expect, it } from 'vitest';
import { clockSpanDeg, clockUndefined, coneSpans90, imfClockOf, mixesPolarity, representativeClock, representativeCone,
  rotationOf, tintAvailable, tintReason } from './imf';
import { DEFAULT_STATE } from './schema';

const ALL = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11];

describe('IMF helpers', () => {
  it('cone across 90 deg', () => {
    expect(coneSpans90([5, 6])).toBe(true);
    expect(coneSpans90([2, 3])).toBe(false);
    expect(coneSpans90([8, 9])).toBe(false);
    expect(representativeCone([5, 6])).toEqual({ cone: 82.5, ghost: 97.5 });
    expect(representativeCone([2, 3])).toEqual({ cone: 45, ghost: null });
    expect(mixesPolarity('PGSM', [0], [5, 6])).toBe(true);
    expect(tintAvailable('PGSM', [0], [5, 6])).toBe(false);
    expect(tintReason('PGSM', [0], [5, 6])).toMatch(/both signs of Bx/);
  });
  it('radial IMF: clock undefined near 0 and 180 deg', () => {
    expect(clockUndefined([0, 1])).toBe(true);
    expect(clockUndefined([10, 11])).toBe(true);
    expect(clockUndefined([0, 11])).toBe(true);
    expect(clockUndefined([1, 2])).toBe(false);
  });
  it('clock span of sectors, circularly', () => {
    expect(clockSpanDeg([11, 0])).toBe(60);
    expect(clockSpanDeg([0, 1, 2])).toBe(90);
    expect(clockSpanDeg([0, 6])).toBe(210);
    expect(clockSpanDeg(ALL)).toBe(360);
  });
  it('tint rule: PGSM unless the cone spans 90; GSM needs a narrow clock and a non-radial cone', () => {
    expect(tintAvailable('PGSM', ALL, [2, 3])).toBe(true);
    expect(tintAvailable('GSM', [11, 0, 1], [2, 3])).toBe(true);
    expect(tintAvailable('GSM', [11, 0, 1, 2], [2, 3])).toBe(false);
    expect(tintAvailable('GSM', [0], [0, 1])).toBe(false);
    expect(tintReason('GSM', ALL, [2, 3])).toMatch(/90°/);
  });
  it('field-line polarity warning', () => {
    expect(mixesPolarity('PGSM', ALL, [2, 3])).toBe(false);
    expect(mixesPolarity('GSM', [11, 0], [2, 3])).toBe(false);
    expect(mixesPolarity('GSM', [11, 0, 1, 2], [2, 3])).toBe(true);
    expect(mixesPolarity('GSM', [0], [5, 6])).toBe(true);
  });
  it('representative clock of GSM sectors', () => {
    const north = representativeClock([11, 0], [2, 3])!;
    expect(Math.min(north, 360 - north)).toBeCloseTo(0);   // 0 or 359.999…: both mean north
    expect(representativeClock([2], [2, 3])).toBeCloseTo(75);
    expect(representativeClock(ALL, [2, 3])).toBeNull();
    expect(representativeClock([2], [0, 1])).toBeNull();
  });
  it('rotation and displayed IMF clock per frame', () => {
    expect(rotationOf({ ...DEFAULT_STATE, frame: 'PGSM', clockDeg: 120 })).toBe(120);
    expect(rotationOf({ ...DEFAULT_STATE, frame: 'GSM', clockDeg: 120 })).toBe(0);
    expect(imfClockOf({ ...DEFAULT_STATE, frame: 'PGSM', clockDeg: 120 })).toBe(120);
    expect(imfClockOf({ ...DEFAULT_STATE, frame: 'GSM', clock: [2], cone: [2, 3] })).toBeCloseTo(75);
  });
});
