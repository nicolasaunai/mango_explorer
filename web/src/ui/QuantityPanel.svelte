<script lang="ts">
  import { app, patch, toggleLayer } from '../state/app.svelte';
  import { grid, type QuantityName } from '../core/grid';
  import { PLANES, STATS_FOR } from '../state/schema';
  import { isVoxelStat } from '../core/compute';
  import CopyPython from './CopyPython.svelte';
  import { stats } from '../state/stats.svelte';
  import { data } from '../state/data.svelte';
  import { tintAvailable, tintReason } from '../state/imf';
  import { hasVectors } from '../core/atlas';

  const q = grid.raw.quantities;
  const groups: { title: string; items: QuantityName[] }[] = [
    { title: 'Compression vs solar wind', items: ['Np_ratio', 'B_ratio', 'Tp_ratio', 'V_ratio'] },
    { title: 'Local values', items: ['Np', 'Tp', 'B', 'V'] },
  ];
  const statLabel: Record<string, string> = {
    median: 'median', q25: 'P25', q75: 'P75', iqr_rel: 'IQR/med', n: 'N', neff: 'N_eff', wmean: '1/d mean', mean: 'mean',
  };
  const setSource = (source: 'bins' | 'knn') => {
    const allowed = STATS_FOR[source] as readonly string[];
    patch({ source, range: null, stat: allowed.includes(app.stat) ? app.stat : (allowed[0] as typeof app.stat) });
  };
  const tintOk = $derived(tintAvailable(app.frame, app.clock, app.cone));
  const vectors = $derived(hasVectors(data.manifest));
  const NO_VECTORS = 'this atlas has no flow/field data (vector sums)';
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
      <button type="button" aria-pressed={app.source === 'bins'} onclick={() => setSource('bins')}>Bins</button>
      <button type="button" aria-pressed={app.source === 'knn'} onclick={() => setSource('knn')}>k-NN</button>
    </div>
    {#if app.source === 'knn'}
      <label class="num"><span>k neighbours</span>
        <input id="knn-k" type="number" min="1" step="1" value={app.k} class="mono"
          onchange={(e) => { const v = Math.round(Number((e.currentTarget as HTMLInputElement).value)); if (v >= 1) patch({ k: v }); }} />
        <span class="muted small">full data</span></label>
      {#if stats.knn && isVoxelStat(stats.knn.stat)}<p class="na">Full data: {stats.knn.nSamples.toLocaleString('en-US')} samples selected, k nearest from voxel sums ({grid.raw.voxels.size_re} R<sub>E</sub>) · {Math.round(stats.knn.ms)} ms.</p>
      {:else if stats.knn}<p class="na">Quantiles: searching {stats.knn.kSearched.toLocaleString('en-US')} neighbours among the {Math.round(stats.knn.fraction * 100)} % random sample held by the browser ({stats.knn.nSamples.toLocaleString('en-US')} samples selected) · {Math.round(stats.knn.ms)} ms.</p>{/if}
      <label class="num"><span>cap (R<sub>E</sub>)</span>
        <input type="range" min="0.25" max="6" step="0.25" value={app.cap} onchange={(e) => patch({ cap: Number((e.currentTarget as HTMLInputElement).value) })} />
        <span class="mono">{app.cap}</span></label>
      <p class="na">Empty where the median distance of the k nearest samples exceeds the cap. A/B compare uses bins.</p>
    {/if}
  </div>

  <div class="ctl">
    <span class="eyebrow">Statistic</span>
    <div class="chips">
      {#each STATS_FOR[app.source] as s (s)}
        <button type="button" class="chip" aria-pressed={app.stat === s} onclick={() => patch({ stat: s })}>{statLabel[s]}</button>
      {/each}
    </div>
  </div>

  <div class="ctl">
    <span class="eyebrow">Slice planes</span>
    <div class="seg" role="group" aria-label="Slice planes, any combination">
      {#each PLANES as pl (pl)}
        <button type="button" aria-pressed={app.planes.includes(pl)}
          onclick={() => patch({ planes: app.planes.includes(pl) ? app.planes.filter((x) => x !== pl) : [...app.planes, pl] })}>{pl}</button>
      {/each}
    </div>
    {#each PLANES.filter((pl) => app.planes.includes(pl)) as pl (pl)}
      <label class="num"><span>{pl} at {({ XY: 'Z', XZ: 'Y', YZ: 'X' })[pl]} (R<sub>E</sub>)</span>
        <input id={`offset-${pl}`} type="number" step="0.5" min="-30" max="30" value={app.offsets[pl]} class="mono"
          onchange={(e) => { const v = Number((e.currentTarget as HTMLInputElement).value); if (Number.isFinite(v)) patch({ offsets: { ...app.offsets, [pl]: Math.max(-30, Math.min(30, v)) } }); }} />
        <button type="button" class="link" onclick={() => patch({ offsets: { ...app.offsets, [pl]: 0 } })}>0</button></label>
    {/each}
    <p class="na">Drag a slice in the view to move it along its normal.</p>
  </div>

  <div class="ctl">
    <span class="eyebrow">Layers</span>
    <label class="opt"><input type="checkbox" checked={app.layers.includes('slice')} onchange={() => toggleLayer('slice')} /><span>Data on slice plane</span></label>
    <label class="opt"><input type="checkbox" checked={app.layers.includes('mp')} onchange={() => toggleLayer('mp')} /><span>Magnetopause</span></label>
    <label class="opt"><input type="checkbox" checked={app.layers.includes('bs')} onchange={() => toggleLayer('bs')} /><span>Bow shock</span></label>
    <label class="opt" class:off={!tintOk} title={tintOk ? 'Bow shock coloured by the angle θBn between its normal and the IMF arrow' : `Off: ${tintReason(app.frame, app.clock, app.cone)}`}>
      <input type="checkbox" disabled={!tintOk} checked={app.layers.includes('tint')} onchange={() => toggleLayer('tint')} />
      <span>Shock tinted by θ<sub>Bn</sub>{#if !tintOk}<span class="muted small"> (IMF direction ambiguous)</span>{/if}</span></label>
    <label class="opt"><input type="checkbox" checked={app.layers.includes('shells')} onchange={() => toggleLayer('shells')} /><span title="The surface of constant depth D between the magnetopause and the bow shock, coloured like the map below; the map's depth slider moves it">Depth shell (D of the map)</span></label>
    <label class="opt" class:off={!vectors} title={vectors ? '' : NO_VECTORS}><input type="checkbox" disabled={!vectors} checked={vectors && app.layers.includes('flow')} onchange={() => toggleLayer('flow')} /><span title={vectors ? 'Ion bulk-flow streamlines from just inside the bow shock (dayside), traced downstream through the k-NN mean velocity' : NO_VECTORS}>Flow lines (V)</span></label>
    <label class="opt" class:off={!vectors} title={vectors ? '' : NO_VECTORS}><input type="checkbox" disabled={!vectors} checked={vectors && app.layers.includes('field')} onchange={() => toggleLayer('field')} /><span title={vectors ? "Magnetic field lines through the depth shell's D, traced both ways through the k-NN mean field" : NO_VECTORS}>Field lines (B)</span></label>
    {#if vectors && (app.layers.includes('flow') || app.layers.includes('field'))}
      <label class="num"><span>lines</span>
        <input type="range" min="50" max="400" step="10" value={app.density} onchange={(e) => patch({ density: Number((e.currentTarget as HTMLInputElement).value) })} />
        <span class="mono">{app.density}</span></label>
    {/if}
    <label class="opt" title="Hatch cells whose samples come from few spacecraft passes (distinct spacecraft-hours): bins N_eff &lt; {grid.reliability.min_neff}, k-NN &lt; {grid.raw.knn.min_neff}">
      <input type="checkbox" checked={app.neff} onchange={() => patch({ neff: !app.neff })} /><span>Flag few-pass cells (N<sub>eff</sub>)</span></label>
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
  .link { background: none; border: 0; color: var(--muted); font: 11px var(--f-mono); cursor: pointer; text-decoration: underline; }
  .num input[type='number'] { font-size: 12px; padding: 3px 6px; border: 1px solid var(--rule); border-radius: 4px; background: var(--panel); color: var(--fg); }
</style>
