<script lang="ts">
  import { app, patch, toggleLayer } from '../state/app.svelte';
  import { grid, type QuantityName } from '../core/grid';
  import { PLANES, STATS } from '../state/schema';
  import CopyPython from './CopyPython.svelte';

  const q = grid.raw.quantities;
  const groups: { title: string; items: QuantityName[] }[] = [
    { title: 'Compression vs solar wind', items: ['Np_ratio', 'B_ratio', 'Tp_ratio', 'V_ratio'] },
    { title: 'Local values', items: ['Np', 'Tp', 'B', 'V'] },
  ];
  const statLabel: Record<(typeof STATS)[number], string> = {
    median: 'median', q25: 'P25', q75: 'P75', iqr_rel: 'IQR/med', n: 'N', neff: 'N_eff',
  };
  const fold = $derived(app.frame === 'PGSM_fold');
  // spec labels are plain text ("N_p / N_p,sw", "cm^-3"); render subscripts and superscripts
  const fmt = (t: string) => t.replace(/_([A-Za-z0-9,]+)/g, '<sub>$1</sub>').replace(/\^(-?\d+)/g, '<sup>$1</sup>');
</script>

<section class="panel" aria-label="Quantity and layers">
  <div class="ctl">
    <span class="eyebrow">Quantity</span>
    {#each groups as g (g.title)}
      <div class="group">
        <span class="muted small">{g.title}</span>
        {#each g.items as name (name)}
          <label class="opt">
            <input type="radio" name="quantity" value={name} checked={app.quantity === name}
              onchange={() => patch({ quantity: name })} />
            <span>{@html fmt(q[name].label)}{#if q[name].unit}&nbsp;<span class="muted mono small">{@html fmt(q[name].unit)}</span>{/if}</span>
          </label>
        {/each}
      </div>
    {/each}
    <p class="na" title="MANGO stores isotropic proton moments only">T<sub>∥</sub>/T<sub>⊥</sub> · not in MANGO (no anisotropy moments)</p>
  </div>

  <div class="ctl">
    <span class="eyebrow">Statistics from</span>
    <div class="seg">
      <button type="button" aria-pressed={app.source === 'bins'} onclick={() => patch({ source: 'bins', range: null })}>Bins</button>
      <button type="button" aria-pressed={app.source === 'knn'} onclick={() => patch({ source: 'knn', range: null })}>k-NN</button>
    </div>
    {#if app.source === 'knn'}
      <label class="num"><span>k neighbours</span>
        <input type="range" min="5" max="200" step="1" value={app.k} onchange={(e) => patch({ k: Number((e.currentTarget as HTMLInputElement).value) })} />
        <span class="mono">{app.k}</span></label>
      <label class="num"><span>cap (R<sub>E</sub>)</span>
        <input type="range" min="0.25" max="6" step="0.25" value={app.cap} onchange={(e) => patch({ cap: Number((e.currentTarget as HTMLInputElement).value) })} />
        <span class="mono">{app.cap}</span></label>
      <p class="na">Empty where the median distance of the k nearest samples exceeds the cap; hatched where they come from fewer than {grid.raw.knn.min_neff} spacecraft-hours. A/B compare uses bins.</p>
    {/if}
  </div>

  <div class="ctl">
    <span class="eyebrow">Statistic</span>
    <div class="chips">
      {#each STATS as s (s)}
        <button type="button" class="chip" aria-pressed={app.stat === s} onclick={() => patch({ stat: s })}>{statLabel[s]}</button>
      {/each}
    </div>
  </div>

  <div class="ctl">
    <span class="eyebrow">Slice plane</span>
    <div class="seg">
      {#each PLANES as pl (pl)}
        <button type="button" aria-pressed={app.plane === pl} onclick={() => patch({ plane: pl })}>{pl}</button>
      {/each}
    </div>
  </div>

  <div class="ctl">
    <span class="eyebrow">Layers</span>
    <label class="opt"><input type="checkbox" checked={app.layers.includes('slice')} onchange={() => toggleLayer('slice')} /><span>Data on slice plane</span></label>
    <label class="opt"><input type="checkbox" checked={app.layers.includes('mp')} onchange={() => toggleLayer('mp')} /><span>Magnetopause</span></label>
    <label class="opt"><input type="checkbox" checked={app.layers.includes('bs')} onchange={() => toggleLayer('bs')} /><span>Bow shock</span></label>
    <label class="opt" class:off={!fold} title={fold ? '' : 'The quasi-parallel side depends on the sign of Bx unless the IMF polarity is folded'}>
      <input type="checkbox" disabled={!fold} checked={app.layers.includes('tint')} onchange={() => toggleLayer('tint')} />
      <span>Shock tinted by θ<sub>Bn</sub>{#if !fold}<span class="muted small"> (needs fold)</span>{/if}</span></label>
    <label class="opt"><input type="checkbox" checked={app.layers.includes('shells')} onchange={() => toggleLayer('shells')} /><span>D<sub>msh</sub> = 0.5 shell</span></label>
  </div>
  <CopyPython />
</section>

<style>
  .panel { display: grid; gap: 18px; align-content: start; }
  .ctl { display: grid; gap: 6px; }
  .group { display: grid; gap: 2px; margin-top: 4px; }
  .opt { display: flex; align-items: baseline; gap: 6px; font-size: 13px; cursor: pointer; }
  .opt input { accent-color: var(--mp); }
  .opt.off { opacity: 0.55; }
  .small { font-size: 11px; }
  .na { margin: 6px 0 0; font-size: 11.5px; color: var(--muted); }
  .chips { display: flex; flex-wrap: wrap; gap: 4px; }
  .num { display: grid; grid-template-columns: 1fr 1.4fr 2.6em; gap: 6px; align-items: center; font-size: 12px; }
  .num input { accent-color: var(--mp); min-width: 0; }
</style>
