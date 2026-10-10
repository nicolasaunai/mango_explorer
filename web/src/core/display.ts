// MANGO's normalization reference surfaces (grid spec "reference_boundaries"): the explorer draws
// them, and the normalized positions of the data lie between them.
import { grid } from './grid';
import { jelinekBs, shueAlpha, shueMp, shueR0 } from './boundaries';
import type { Boundaries } from './geometry';

const ref = grid.raw.reference_boundaries;
const r0 = shueR0(ref.magnetopause.bz_nt, ref.magnetopause.pd_npa);
const alpha = shueAlpha(ref.magnetopause.bz_nt, ref.magnetopause.pd_npa);

export const DISPLAY_BOUNDARIES: Boundaries = {
  rMp: (t) => shueMp(t, r0, alpha),
  rBs: (t) => jelinekBs(t, ref.bow_shock.pd_npa),
};
export const DISPLAY_NOTE = 'MANGO normalization reference · mean Shue 1998 / Jelínek 2012';
