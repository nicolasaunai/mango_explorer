import { grid, type QuantityName } from '../core/grid';
import type { Stat } from '../core/compute';

/** Spec labels are plain text ("N_p / N_p,sw", "cm^-3"): render sub- and superscripts. */
export const richText = (t: string) =>
  t.replace(/_([A-Za-z0-9,]+)/g, '<sub>$1</sub>').replace(/\^(-?\d+)/g, '<sup>$1</sup>');

export const STAT_LABEL: Record<Stat, string> = {
  median: 'median', q25: '25th percentile', q75: '75th percentile', iqr_rel: 'IQR / median', n: 'samples N', neff: 'N_eff (upper bound)',
  wmean: 'k-NN 1/d-weighted mean', mean: 'k-NN mean',
};

/** "median of N_p / N_p,sw" as rich text, with the unit when it applies. */
export function quantityTitle(q: QuantityName, stat: Stat): string {
  if (stat === 'n' || stat === 'neff') return richText(STAT_LABEL[stat]);
  const spec = grid.raw.quantities[q];
  const unit = stat !== 'iqr_rel' && spec.unit ? ` <span class="unit">${richText(spec.unit)}</span>` : '';
  return `${STAT_LABEL[stat]} of ${richText(spec.label)}${unit}`;
}

const binText = (name: 'clock_deg' | 'cone_deg' | 'Ma_sw', bins: number[]) => {
  const e = grid.conditionEdges(name), n = e.length - 1;
  if (bins.length === n) return 'all';
  const sorted = [...bins].sort((a, b) => a - b);
  const contiguous = sorted.every((b, i) => i === 0 || b === sorted[i - 1] + 1);
  const hi = (b: number) => (e[b + 1] >= 1e8 ? '∞' : String(e[b + 1]));
  return contiguous ? `${e[sorted[0]]}–${hi(sorted[sorted.length - 1])}` : sorted.map((b) => `${e[b]}–${hi(b)}`).join(', ');
};

/** One-line summary of the conditions, for exports and captions. */
export function conditionSummary(s: { frame: string; clock: number[]; cone: number[]; ma: number[] }) {
  const frame = s.frame === 'PGSM_fold' ? 'PGSM, IMF polarity folded' : s.frame;
  return `${frame} · clock ${binText('clock_deg', s.clock)}° · cone ${binText('cone_deg', s.cone)}° · M_A ${binText('Ma_sw', s.ma)}`;
}
