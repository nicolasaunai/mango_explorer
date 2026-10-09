// Python that reproduces the current view from the MANGO server: space_mango with the view's frame,
// then mango_explorer.atlas.cell_statistics for the bins.
import { grid, type ConditionName } from '../core/grid';
import type { ViewState } from '../state/schema';

const N_CLOCK = grid.conditionEdges('clock_deg').length - 1;

/** [start, end] degrees of a circularly contiguous, partial set of 30° sectors; null otherwise. */
export function clockRange(sectors: number[]): [number, number] | null {
  const sel = new Set(sectors);
  if (sel.size === 0 || sel.size === N_CLOCK) return null;
  const start = [...sel].find((s) => !sel.has((s - 1 + N_CLOCK) % N_CLOCK))!;
  for (let i = 0; i < sel.size; i++) if (!sel.has((start + i) % N_CLOCK)) return null;
  const w = 360 / N_CLOCK;
  return [start * w, ((start + sel.size) % N_CLOCK) * w];
}

const hull = (name: ConditionName, bins: number[]) => {
  const e = grid.conditionEdges(name);
  return [e[Math.min(...bins)], e[Math.max(...bins) + 1]] as const;
};
const full = (name: ConditionName, bins: number[]) => new Set(bins).size === grid.conditionEdges(name).length - 1;

export function pythonSnippet(s: ViewState): string {
  const pgsm = s.frame === 'PGSM';
  const dims: [ConditionName, number[]][] = [
    ...(pgsm ? [] : [['clock_deg', s.clock] as [ConditionName, number[]]]),
    ['cone_deg', s.cone], ['Ma_sw', s.ma],
  ];
  const sel = dims.filter(([n, b]) => !full(n, b)).map(([n, b]) => `"${n}": [${b.join(', ')}]`);
  const args: string[] = [`frame="${pgsm ? 'pgsm' : 'gsm'}"`];
  const [c0, c1] = hull('cone_deg', s.cone);
  if (pgsm || !full('cone_deg', s.cone)) args.push(`cone=[${c0}, ${c1}]`);
  if (pgsm) args.push(`clock=${s.clockDeg}`);
  else { const r = clockRange(s.clock); if (r) args.push(`clock=[${r[0]}, ${r[1]}]`); }
  args.push(`columns=list(FRAME_COLUMNS["${s.frame}"])`);
  const [lo, hi] = hull('Ma_sw', s.ma);
  if (lo > 0) args.push(`ma_sw_min=${lo}`);
  if (hi < 1e8) args.push(`ma_sw_max=${hi}`);
  const stat = s.stat === 'neff' ? 'neff' : s.stat === 'n' ? 'n' : s.stat === 'q25' ? 'q25' : s.stat === 'q75' ? 'q75' : 'median';
  return [
    '# space-mango >= 0.3 (frames API); downloads are cached locally as monthly per-column fragments',
    'import polars as pl',
    'import space_mango as sm',
    'from mango_explorer.atlas import FRAME_COLUMNS, cell_statistics',
    '',
    `result = sm.get_data("magnetosheath", ${args.join(', ')})`,
    `cells = cell_statistics(result, frame="${s.frame}", quantity="${s.quantity}",`,
    `                        selection={${sel.join(', ')}})`,
    `print(cells.filter(pl.col("reliable")).sort("${stat}"))`,
  ].join('\n');
}
