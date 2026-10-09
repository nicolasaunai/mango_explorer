import { describe, expect, it } from 'vitest';
import { DEFAULT_STATE, clockUndefined, decodeHash, encodeHash, mixesPolarity } from './schema';

describe('URL state', () => {
  it('round-trips', () => {
    const s = { ...DEFAULT_STATE, frame: 'GSM' as const, clock: [11, 0], cone: [4], view: 'north' as const,
      lut: 'cividis' as const, depth: 0.37, probe: 1234, range: [0.25, 0.75] as [number, number],
      pinA: { clock: [0, 1], cone: [3], ma: [1, 2] }, cmp: 'diff' as const, source: 'knn' as const, k: 7000, cap: 1.5, neff: true, planes: ['XZ', 'YZ'] as ('XY' | 'XZ' | 'YZ')[], offsets: { XY: 1.5, XZ: -3, YZ: 0 } };
    expect(decodeHash(encodeHash(s))).toEqual(s);
  });
  it('falls back field by field on bad input', () => {
    const s = decodeHash('#f=SM&clk=0.99&cone=1.2&q=Np');
    expect(s.frame).toBe(DEFAULT_STATE.frame);
    expect(s.clock).toEqual(DEFAULT_STATE.clock);
    expect(s.cone).toEqual([1, 2]);
    expect(s.quantity).toBe('Np');
  });
  it('depth is continuous in the hash', () => {
    expect(encodeHash({ ...DEFAULT_STATE, depth: 0.37 })).toContain('d=0.37');
    expect(decodeHash('#d=0.37').depth).toBe(0.37);
    expect(decodeHash('#d=1.5').depth).toBe(DEFAULT_STATE.depth);
  });
  it('old links with a shell bin open at the centre of that bin', () => {
    expect(decodeHash('#sh=2').depth).toBeCloseTo(0.25);
    expect(decodeHash('#sh=2&d=0.6').depth).toBe(0.6);
  });
  it('flags radial IMF', () => {
    expect(clockUndefined([0, 1])).toBe(true);
    expect(clockUndefined([1, 2])).toBe(false);
  });
  it('line layers and density round-trip, density only when not default', () => {
    const s = { ...DEFAULT_STATE, layers: ['mp', 'flow', 'field'] as typeof DEFAULT_STATE.layers, density: 220 };
    expect(decodeHash(encodeHash(s))).toEqual(s);
    expect(encodeHash(DEFAULT_STATE)).not.toContain('ln=');
    expect(decodeHash('#ln=9999').density).toBe(DEFAULT_STATE.density);
    expect(DEFAULT_STATE.layers).not.toContain('flow');
  });
  it('field lines mix IMF polarities in PGSM without fold, and in GSM over more than 90 deg of clock', () => {
    expect(mixesPolarity('PGSM_fold', [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11])).toBe(false);
    expect(mixesPolarity('PGSM', [0])).toBe(true);
    expect(mixesPolarity('GSM', [11, 0])).toBe(false);
    expect(mixesPolarity('GSM', [0, 1, 2])).toBe(false);
    expect(mixesPolarity('GSM', [11, 0, 1, 2])).toBe(true);
    expect(mixesPolarity('GSM', [0, 6])).toBe(true);
  });
});
