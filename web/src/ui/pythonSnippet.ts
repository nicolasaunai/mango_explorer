// Python that reproduces the current view from the MANGO server with mango_explorer.atlas.
import { grid, type ConditionName } from '../core/grid';
import type { ViewState } from '../state/schema';

const DIMS: [ConditionName, keyof Pick<ViewState, 'clock' | 'cone' | 'ma'>][] = [
  ['clock_deg', 'clock'], ['cone_deg', 'cone'], ['Ma_sw', 'ma'],
];

export function pythonSnippet(s: ViewState): string {
  const sel = DIMS.filter(([name, key]) => s[key].length < grid.conditionEdges(name).length - 1)
    .map(([name, key]) => `"${name}": [${s[key].join(', ')}]`);
  const ma = grid.conditionEdges('Ma_sw');
  const lo = ma[Math.min(...s.ma)], hi = ma[Math.max(...s.ma) + 1];
  const server = [lo > 0 ? `ma_sw_min=${lo}` : '', hi < 1e8 ? `ma_sw_max=${hi}` : ''].filter(Boolean);
  const stat = s.stat === 'neff' ? 'neff' : s.stat === 'n' ? 'n' : s.stat === 'q25' ? 'q25' : s.stat === 'q75' ? 'q75' : 'median';
  return [
    'import polars as pl',
    'import space_mango as sm',
    'from mango_explorer.atlas import COLUMNS, cell_statistics',
    '',
    '# The server filters M_A; clock and cone bins (grid-v1) are applied locally.',
    '# Without an M_A filter this downloads the whole magnetosheath table: consider spacecraft= or time_min=.',
    `df = sm.get_data("magnetosheath", columns=list(COLUMNS), sw_paired_only=True, normalized_only=True${server.length ? ', ' + server.join(', ') : ''})`,
    `cells = cell_statistics(df, frame="${s.frame}", quantity="${s.quantity}",`,
    `                        selection={${sel.join(', ')}})`,
    `print(cells.filter(pl.col("reliable")).sort("${stat}"))`,
  ].join('\n');
}
