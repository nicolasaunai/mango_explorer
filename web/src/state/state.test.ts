import { describe, expect, it } from 'vitest';
import { DEFAULT_STATE, decodeHash, encodeHash } from './schema';
import { selectionOf } from './selection';

describe('URL state', () => {
  it('round-trips', () => {
    const s = { ...DEFAULT_STATE, frame: 'GSM' as const, clock: [11, 0], clockDeg: 37, cone: [4, 9], view: 'north' as const,
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
  it('target clock wraps and rounds', () => {
    expect(decodeHash('#f=PGSM&ck=360').clockDeg).toBe(0);
    expect(decodeHash('#f=PGSM&ck=-30').clockDeg).toBe(330);
    expect(decodeHash('#f=PGSM&ck=1000000').clockDeg).toBe(280);
    expect(decodeHash('#f=PGSM&ck=12.7').clockDeg).toBe(13);
    expect(decodeHash('#f=PGSM&ck=abc').clockDeg).toBe(DEFAULT_STATE.clockDeg);
    expect(encodeHash({ ...DEFAULT_STATE, frame: 'PGSM', clockDeg: 45 })).toContain('ck=45');
  });
  it('old links', () => {
    const s = decodeHash('#f=PGSM_fold&clk=11.0&cone=2.3&ly=mp.bs.zgsm.slice');
    expect(s.frame).toBe('PGSM');
    expect(s.clockDeg).toBe(0);
    expect(s.cone).toEqual([2, 3]);
    expect(s.layers).toEqual(['mp', 'bs', 'slice']);
    expect(decodeHash('#f=PGSM').frame).toBe('PGSM');
  });
  it('line layers and density round-trip, density only when not default', () => {
    const s = { ...DEFAULT_STATE, layers: ['mp', 'flow', 'field'] as typeof DEFAULT_STATE.layers, density: 220 };
    expect(decodeHash(encodeHash(s))).toEqual(s);
    expect(encodeHash(DEFAULT_STATE)).not.toContain('ln=');
    expect(decodeHash('#ln=9999').density).toBe(DEFAULT_STATE.density);
    expect(DEFAULT_STATE.layers).not.toContain('flow');
  });
});

describe('selection', () => {
  it('PGSM selections never carry the clock sectors', () => {
    const s = { ...DEFAULT_STATE, clock: [3], cone: [2], ma: [1] };
    expect(selectionOf('GSM', s)).toEqual({ clock_deg: [3], cone_deg: [2], Ma_sw: [1] });
    expect(selectionOf('PGSM', s)).toEqual({ cone_deg: [2], Ma_sw: [1] });
  });
});
