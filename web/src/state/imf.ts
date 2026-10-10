// IMF orientation helpers for the views: what the yellow arrow shows, when the θBn tint is meaningful,
// when field lines mix IMF polarities. Pure functions of the view state.
import { grid } from '../core/grid';
import { mod } from '../core/frames';
import { N_CLOCK, type ViewState } from './schema';

const coneEdges = grid.conditionEdges('cone_deg');
const centre = (b: number) => (coneEdges[b] + coneEdges[b + 1]) / 2;

/** The cone selection holds bins on both sides of 90°: both signs of the IMF Bx. */
export const coneSpans90 = (cone: number[]) => cone.some((b) => coneEdges[b + 1] <= 90) && cone.some((b) => coneEdges[b] >= 90);

/** Every selected cone bin lies within 30° of the X axis: the clock angle is ill-defined. */
export const clockUndefined = (cone: number[]) => cone.every((b) => coneEdges[b + 1] <= 30 || coneEdges[b] >= 150);

/** Smallest arc (degrees) covering the selected clock sectors, circularly. */
export function clockSpanDeg(sectors: number[]): number {
  const sel = [...new Set(sectors)].sort((a, b) => a - b);
  let gap = 0;
  sel.forEach((s, i) => { gap = Math.max(gap, mod(sel[(i + 1) % sel.length] - s - 1, N_CLOCK)); });
  return (N_CLOCK - gap) * (360 / N_CLOCK);
}

/** Field lines average opposite IMF orientations. */
export const mixesPolarity = (frame: ViewState['frame'], sectors: number[], cone: number[]) =>
  coneSpans90(cone) || (frame === 'GSM' && clockSpanDeg(sectors) > 90);

export function tintReason(frame: ViewState['frame'], sectors: number[], cone: number[]): string {
  if (coneSpans90(cone)) return 'the cone selection spans 90°: both signs of Bx, so two quasi-parallel sides';
  if (frame === 'GSM' && clockUndefined(cone)) return 'radial IMF: the clock angle is undefined';
  if (frame === 'GSM' && clockSpanDeg(sectors) > 90) return 'the clock sectors span more than 90°';
  return '';
}
export const tintAvailable = (frame: ViewState['frame'], sectors: number[], cone: number[]) => tintReason(frame, sectors, cone) === '';

/** Circular mean of the selected 30° sectors; null when it carries no direction. */
export function representativeClock(sectors: number[], cone: number[]): number | null {
  if (sectors.length === N_CLOCK || clockUndefined(cone)) return null;
  let x = 0, y = 0;
  for (const k of sectors) { const a = ((k + 0.5) * (360 / N_CLOCK) * Math.PI) / 180; x += Math.sin(a); y += Math.cos(a); }
  if (Math.hypot(x, y) / sectors.length < 0.2) return null;
  return mod((Math.atan2(x, y) * 180) / Math.PI, 360);
}

/** Cone of the IMF arrow; across 90° the folded mean c gives two arrows, c and 180° − c. */
export function representativeCone(cone: number[]): { cone: number; ghost: number | null } {
  if (!coneSpans90(cone)) return { cone: cone.reduce((s, b) => s + centre(b), 0) / cone.length, ghost: null };
  const folded = cone.reduce((s, b) => s + Math.min(centre(b), 180 - centre(b)), 0) / cone.length;
  return { cone: folded, ghost: 180 - folded };
}

/** Rotation (degrees) from the atlas to the display: the target clock in PGSM, none in GSM. */
export const rotationOf = (s: Pick<ViewState, 'frame' | 'clockDeg'>) => (s.frame === 'PGSM' ? s.clockDeg - grid.atlasClockDeg : 0);

/** Clock angle of the drawn IMF arrow, or null when it has no direction. */
export const imfClockOf = (s: Pick<ViewState, 'frame' | 'clockDeg' | 'clock' | 'cone'>) =>
  s.frame === 'PGSM' ? s.clockDeg : representativeClock(s.clock, s.cone);
