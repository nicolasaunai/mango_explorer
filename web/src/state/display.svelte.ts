// What the slice and the 2D views show: condition set B (current), the pinned set A, or B - A.
import { app } from './app.svelte';
import { stats } from './stats.svelte';
import { difference, symmetricRange } from '../core/compare';
import { isLogScale } from '../core/compute';
import type { LutName } from '../render/lut';
import { FIELD_HALF, FIELD_N, type PlaneField } from '../core/knnField';

export type Shown = {
  mode: 'A' | 'B' | 'diff';
  values: Float32Array; flags: Uint8Array; range: [number, number];
  lut: LutName; log: boolean; diverging: boolean;
  /** k-NN mode: values are a field on the slice plane; the shell map has its own arrays */
  field?: { n: number; half: number; planes: PlaneField[] };
  shell?: { values: Float32Array; flags: Uint8Array };
};

class Display {
  /** Differences only make sense for value statistics, not for counts. */
  readonly canDiff = $derived(app.stat !== 'n' && app.stat !== 'neff' && app.source === 'bins');
  /** A/B comparison works on the binned statistics only (for now). */
  readonly mode = $derived<'A' | 'B' | 'diff'>(!app.pinA || app.source === 'knn' ? 'B' : app.cmp === 'diff' && !this.canDiff ? 'B' : app.cmp);
  readonly diff = $derived.by(() => {
    const a = stats.resultA, b = stats.result;
    if (this.mode !== 'diff' || !a || !b) return null;
    return difference(a, b);
  });
  readonly shown = $derived.by<Shown | null>(() => {
    const log = isLogScale(app.quantity, app.stat);
    if (app.source === 'knn') {
      const r = stats.knn;
      if (!r) return null;
      return { mode: 'B', values: r.shellValues, flags: r.shellFlags, range: app.range ?? r.range, lut: app.lut, log, diverging: false,
        field: { n: FIELD_N, half: FIELD_HALF, planes: r.fields }, shell: { values: r.shellValues, flags: r.shellFlags } };
    }
    if (this.mode === 'diff') {
      const d = this.diff;
      if (!d) return null;
      return { mode: 'diff', values: d.values, flags: d.flags, range: app.range ?? symmetricRange(d.values, d.flags), lut: 'vik', log, diverging: true };
    }
    const r = this.mode === 'A' ? stats.resultA : stats.result;
    if (!r) return null;
    return { mode: this.mode, values: r.values, flags: r.flags, range: app.range ?? r.range, lut: app.lut, log, diverging: false };
  });
}

export const display = new Display();
