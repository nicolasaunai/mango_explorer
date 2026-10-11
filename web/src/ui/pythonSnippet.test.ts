import { describe, expect, it } from 'vitest';
import { clockRange, pythonSnippet } from './pythonSnippet';
import { DEFAULT_STATE } from '../state/schema';

describe('Copy Python', () => {
  it('PGSM: frame, cone hull and the one target clock go to space_mango', () => {
    const code = pythonSnippet({ ...DEFAULT_STATE, frame: 'PGSM', clockDeg: 135, cone: [2, 3], ma: [2, 3] });
    expect(code).toContain('frame="pgsm", cone=[30, 60], clock=135');
    expect(code).toContain('ma_sw_min=6, ma_sw_max=12');
    expect(code).toContain('columns=list(FRAME_COLUMNS["PGSM"])');
    expect(code).toContain('cell_statistics(result, frame="PGSM", quantity="Np_ratio"');
    expect(code).toContain('selection={"cone_deg": [2, 3], "Ma_sw": [2, 3]}');
    expect(code).not.toContain('clock_deg');
    expect(code).toContain("# cells match the explorer's when the clock is a multiple of 15 deg (the explorer bins at clock 0, then rotates the view)");
  });
  it('GSM: clock sectors become a wrapping range when contiguous', () => {
    const code = pythonSnippet({ ...DEFAULT_STATE, frame: 'GSM', clock: [11, 0], cone: [2, 3] });
    expect(code).toContain('frame="gsm", sw_paired_only=True, normalized_only=True, cone=[30, 60], clock=[330, 30]');
    expect(code).not.toContain('# cells match');
    expect(code).toContain('"clock_deg": [11, 0]');
  });
  it('GSM: non-contiguous sectors are left to cell_statistics; full selections are omitted', () => {
    const code = pythonSnippet({ ...DEFAULT_STATE, frame: 'GSM', clock: [0, 6], cone: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11], ma: [4] });
    expect(code).toContain('frame="gsm", sw_paired_only=True, normalized_only=True, columns=');
    expect(code).not.toContain('clock=[');
    expect(code).not.toContain('cone=[');
    expect(code).toContain('ma_sw_min=12)');
  });
  it('contiguous sector ranges', () => {
    expect(clockRange([11, 0, 1])).toEqual([330, 60]);
    expect(clockRange([0, 1, 2, 3, 4, 5])).toEqual([0, 180]);
    expect(clockRange([0, 6])).toBeNull();
    expect(clockRange([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11])).toBeNull();
  });
});
