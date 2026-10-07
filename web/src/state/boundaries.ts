// Boundary shapes the data are drawn between. Until the MANGO models are available these are
// Shue 1998 (magnetopause) and Jelínek 2012 (bow shock) at Pd = 2 nPa, Bz = 0: illustrative.
import { jelinekBs, shueAlpha, shueMp, shueR0 } from '../core/boundaries';
import type { Boundaries } from '../core/geometry';

const PD = 2, BZ = 0;
const r0 = shueR0(BZ, PD), alpha = shueAlpha(BZ, PD);

export const BOUNDARIES: Boundaries = {
  rMp: (t) => shueMp(t, r0, alpha),
  rBs: (t) => jelinekBs(t, PD),
};
export const BOUNDARY_NOTE = 'Shue 98 / Jelínek 12 at Pd = 2 nPa · illustrative';
