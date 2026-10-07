// The boundaries the explorer draws (grid spec "display_boundaries"); k-NN samples sit between them.
import { grid } from './grid';
import { jelinekBs, shueAlpha, shueMp, shueR0 } from './boundaries';
import type { Boundaries } from './geometry';

const db = grid.raw.display_boundaries;
const r0 = shueR0(db.bz_nT, db.pd_nPa), alpha = shueAlpha(db.bz_nT, db.pd_nPa);

export const DISPLAY_BOUNDARIES: Boundaries = {
  rMp: (t) => shueMp(t, r0, alpha),
  rBs: (t) => jelinekBs(t, db.pd_nPa),
};
export const DISPLAY_NOTE = `Shue 98 / Jelínek 12 at Pd = ${db.pd_nPa} nPa · illustrative`;
