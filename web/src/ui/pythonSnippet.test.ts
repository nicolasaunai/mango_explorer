import { describe, expect, it } from 'vitest';
import { pythonSnippet } from './pythonSnippet';
import { DEFAULT_STATE } from '../state/schema';

describe('Copy Python', () => {
  it('passes the M_A range to the server and the other bins locally', () => {
    const code = pythonSnippet({ ...DEFAULT_STATE, clock: [0, 1], cone: [2, 3], ma: [2, 3] });
    expect(code).toContain('ma_sw_min=6, ma_sw_max=12');
    expect(code).toContain('selection={"clock_deg": [0, 1], "cone_deg": [2, 3], "Ma_sw": [2, 3]}');
    expect(code).toContain('frame="PGSM_fold", quantity="Np_ratio"');
  });
  it('omits open-ended and full selections', () => {
    const code = pythonSnippet({ ...DEFAULT_STATE, ma: [4] });
    expect(code).toContain('ma_sw_min=12)');
    expect(code).not.toContain('"clock_deg"');
  });
});
