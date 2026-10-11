// state/selection.ts — the condition selection a frame's tables understand.
import type { Selection } from '../core/atlas';
import type { FrameName } from '../core/grid';
import type { ViewState } from './schema';

export const selectionOf = (frame: FrameName, s: Pick<ViewState, 'clock' | 'cone' | 'ma'>): Selection =>
  frame === 'GSM' ? { clock_deg: s.clock, cone_deg: s.cone, Ma_sw: s.ma } : { cone_deg: s.cone, Ma_sw: s.ma };
