import { describe, expect, it } from 'vitest';
import { DEFAULT_STATE, clockUndefined, decodeHash, encodeHash } from './schema';

describe('URL state', () => {
  it('round-trips', () => {
    const s = { ...DEFAULT_STATE, frame: 'GSM' as const, clock: [11, 0], cone: [4], view: 'north' as const,
      lut: 'cividis' as const, shell: 2, probe: 1234, range: [0.25, 0.75] as [number, number],
      pinA: { clock: [0, 1], cone: [3], ma: [1, 2] }, cmp: 'diff' as const };
    expect(decodeHash(encodeHash(s))).toEqual(s);
  });
  it('falls back field by field on bad input', () => {
    const s = decodeHash('#f=SM&clk=0.99&cone=1.2&q=Np');
    expect(s.frame).toBe(DEFAULT_STATE.frame);
    expect(s.clock).toEqual(DEFAULT_STATE.clock);
    expect(s.cone).toEqual([1, 2]);
    expect(s.quantity).toBe('Np');
  });
  it('flags radial IMF', () => {
    expect(clockUndefined([0, 1])).toBe(true);
    expect(clockUndefined([1, 2])).toBe(false);
  });
});
