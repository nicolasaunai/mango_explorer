// MANGO's normalization reference surfaces (grid spec "reference_boundaries"): the explorer draws
// them, and the normalized positions of the data lie between them.
import { grid } from './grid';
import { paraboloidR } from './boundaries';
import type { Boundaries } from './geometry';

const ref = grid.raw.reference_boundaries;

export const DISPLAY_BOUNDARIES: Boundaries = {
  rMp: (t) => paraboloidR(t, ref.magnetopause.nose, ref.magnetopause.p),
  rBs: (t) => paraboloidR(t, ref.bow_shock.nose, ref.bow_shock.p),
};
export const DISPLAY_NOTE = 'MANGO normalization reference · paraboloids fitted to the data';
