// The hour table (one row per spacecraft-hour and condition combination), see atlas/hours.py.
// Rows are sorted by (spacecraft, hour), so rows of one interval are contiguous: counting
// distinct intervals is a single pass that counts key changes.
import { grid as defaultGrid, type ConditionName, type Grid } from './grid';
import type { Selection } from './atlas';

export type Counts = { n: number; neff: number };

export class HourTable {
  readonly length: number;
  constructor(private cols: Record<string, ArrayLike<number>>, readonly grid: Grid = defaultGrid) {
    this.length = cols.n.length;
  }

  private masks(sel: Selection) {
    return (Object.entries(sel) as [ConditionName, number[] | null][])
      .filter(([, bins]) => bins != null)
      .map(([name, bins]) => {
        const allowed = new Uint8Array(256);
        for (const b of bins!) allowed[b] = 1;
        return { col: this.cols[name], allowed };
      });
  }

  /** Exact sample count and N_eff (distinct spacecraft-hours) of a selection. */
  counts(sel: Selection): Counts {
    const masks = this.masks(sel);
    const { sc, interval, n } = this.cols;
    let total = 0, neff = 0, lastSc = -1, lastIv = -1;
    for (let i = 0; i < this.length; i++) {
      if (!masks.every((m) => m.allowed[m.col[i]])) continue;
      total += n[i];
      if (sc[i] !== lastSc || interval[i] !== lastIv) { neff++; lastSc = sc[i]; lastIv = interval[i]; }
    }
    return { n: total, neff };
  }

  /** N_eff in each bin of `dim`, with every other condition of `sel` applied (crossfilter). */
  marginal(dim: ConditionName, sel: Selection): Counts[] {
    const nb = this.grid.conditionEdges(dim).length - 1;
    const others = this.masks({ ...sel, [dim]: null });
    const col = this.cols[dim];
    const { sc, interval, n } = this.cols;
    const out = Array.from({ length: nb }, () => ({ n: 0, neff: 0 }));
    const lastSc = new Float64Array(nb).fill(-1), lastIv = new Float64Array(nb).fill(-1);
    for (let i = 0; i < this.length; i++) {
      const b = col[i];
      if (b >= nb || !others.every((m) => m.allowed[m.col[i]])) continue;
      out[b].n += n[i];
      if (sc[i] !== lastSc[b] || interval[i] !== lastIv[b]) { out[b].neff++; lastSc[b] = sc[i]; lastIv[b] = interval[i]; }
    }
    return out;
  }
}
