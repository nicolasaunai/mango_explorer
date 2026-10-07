import { describe, expect, it } from 'vitest';
import { grid } from './grid';
import { FLAG, cellFlags, cellValues, depthProfile, formatValue, robustRange, ticks } from './compute';
import type { QueryResult } from './atlas';

function fakeResult(): QueryResult {
  const nc = grid.nCells, nb = grid.nHist;
  const hist = new Uint32Array(nc * nb), n = new Uint32Array(nc), neffUpper = new Uint32Array(nc);
  // cell 0: 400 samples in bin 10, 20 hours; cell 1: 5 samples, 1 hour
  hist[0 * nb + 10] = 400; n[0] = 400; neffUpper[0] = 20;
  hist[1 * nb + 30] = 5; n[1] = 5; neffUpper[1] = 1;
  return { hist, n, neffUpper };
}

describe('cell statistics', () => {
  it('flags reliability with the grid thresholds', () => {
    const r = fakeResult();
    const f = cellFlags(r.n, r.neffUpper);
    expect([f[0], f[1], f[2]]).toEqual([FLAG.OK, FLAG.WEAK, FLAG.EMPTY]);
  });
  it('median of a single-bin histogram is the bin centre, in log10 space', () => {
    const v = cellValues(fakeResult(), 'Np', 'median');
    const e = grid.histAxisEdges('Np');
    expect(v[0]).toBeCloseTo((e[10] + e[11]) / 2, 6);
    expect(Number.isNaN(v[2])).toBe(true);
  });
  it('counts are shown as log10', () => {
    expect(cellValues(fakeResult(), 'Np', 'n')[0]).toBeCloseTo(Math.log10(400), 6);
  });
  it('depth profile pools theta below the limit', () => {
    const p = depthProfile(fakeResult(), 'Np', 30);
    expect(p).toHaveLength(10);
    expect(p[0].n).toBe(405);
  });
  it('robust range ignores weak cells', () => {
    const v = new Float32Array([1, 2, 3, 100]);
    const f = new Uint8Array([2, 2, 2, 1]);
    expect(robustRange(v, f, 0, 1)).toEqual([1, 3]);
  });
});

describe('ticks and formatting', () => {
  it('log ticks follow 1-2-5', () => {
    expect(ticks(0, 1, true).map((t) => +(10 ** t).toFixed(6))).toEqual([1, 2, 5, 10]);
  });
  it('linear ticks are round', () => expect(ticks(0, 1, false)).toEqual([0, 0.2, 0.4, 0.6, 0.8, 1]));
  it('narrow log ranges fall back to round physical values', () => {
    const t = ticks(Math.log10(3.2), Math.log10(7.1), true).map((v) => +(10 ** v).toFixed(6));
    expect(t.length).toBeGreaterThanOrEqual(3);
    expect(t).toContain(4);
  });
  it('formats values', () => {
    expect(formatValue(3.14159)).toBe('3.14');
    expect(formatValue(2.5e6)).toBe('2.50e6');
    expect(formatValue(NaN)).toBe('—');
  });
});
