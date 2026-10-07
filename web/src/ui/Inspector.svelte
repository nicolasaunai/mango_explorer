<script lang="ts">
  // Card for the probed cell: where it is, what the selection says there, and how much data backs it.
  import { app, patch } from '../state/app.svelte';
  import { stats } from '../state/stats.svelte';
  import { FLAG, formatValue } from '../core/compute';
  import { cellBounds } from '../core/geometry';
  import { grid } from '../core/grid';
  import { richText } from './format';

  const p = $derived(stats.probe && stats.probe.cell === app.probe ? stats.probe : null);
  // median of the pinned set A in the same cell, when comparing
  const aMedian = $derived(app.pinA && stats.resultA && app.probe >= 0 && (app.stat === 'median')
    ? stats.resultA.values[app.probe] : NaN);
  const b = $derived(app.probe >= 0 ? cellBounds(app.probe) : null);
  const log = $derived(grid.isLog(app.quantity));
  const phys = (v: number) => (log ? 10 ** v : v);
  const flag = $derived(stats.result && app.probe >= 0 ? stats.result.flags[app.probe] : null);
  const maxH = $derived(p ? Math.max(1, ...p.hist) : 1);
  const edges = $derived(grid.histAxisEdges(app.quantity));
  const fmt = new Intl.NumberFormat('en-US');
  const unit = $derived(grid.raw.quantities[app.quantity].unit);
  const medianX = $derived(p ? ((p.q50 - edges[0]) / (edges[edges.length - 1] - edges[0])) * 100 : 0);
</script>

{#if b}
  <aside class="card" aria-label="Probed cell">
    <header>
      <span class="eyebrow">Probe</span>
      <button type="button" class="x" aria-label="Close probe" onclick={() => patch({ probe: -1 })}>×</button>
    </header>
    <div class="where mono">D {b.d[0].toFixed(1)}–{b.d[1].toFixed(1)} · θ {b.theta[0]}–{b.theta[1]}° · φ {b.phi[0]}–{b.phi[1]}°</div>
    {#if p && p.n > 0}
      <div class="val"><span class="big mono">{formatValue(phys(p.q50))}</span>
        <span class="muted">{@html richText(grid.raw.quantities[app.quantity].label)}{#if unit}&nbsp;{@html richText(unit)}{/if}</span></div>
      <div class="mono muted">IQR {formatValue(phys(p.q25))} – {formatValue(phys(p.q75))}</div>
      {#if Number.isFinite(aMedian)}
        <div class="mono">A {formatValue(phys(aMedian))} · B/A {formatValue(log ? 10 ** (p.q50 - aMedian) : p.q50 / aMedian)}</div>
      {/if}
      <svg viewBox="0 0 100 28" preserveAspectRatio="none" aria-hidden="true">
        {#each Array.from(p.hist) as h, i (i)}
          <rect x={(i / p.hist.length) * 100} width={100 / p.hist.length - 0.3} y={28 - (h / maxH) * 26} height={(h / maxH) * 26} />
        {/each}
        <line x1={medianX} x2={medianX} y1="0" y2="28" />
      </svg>
      {#if p.spacecraft.length}
        {@const total = p.spacecraft.reduce((a, s) => a + s.n, 0)}
        <div class="mix" aria-label="Samples per spacecraft">
          {#each [...p.spacecraft].sort((a, b) => b.n - a.n) as s, i (s.name)}
            <span class="seg" style:flex-grow={s.n} style:opacity={1 - i * 0.18} title={`${s.name} ${Math.round((100 * s.n) / total)} %`}></span>
          {/each}
        </div>
        <div class="mixlab mono">
          {#each [...p.spacecraft].sort((a, b) => b.n - a.n).slice(0, 4) as s (s.name)}<span>{s.name} {Math.round((100 * s.n) / total)}%</span>{/each}
        </div>
      {/if}
      <div class="counts mono">
        <span>N {fmt.format(p.n)}</span>
        <span>N<sub>eff</sub> ≤ {fmt.format(p.neffUpper)}</span>
        {#if flag === FLAG.WEAK}<span class="weak">below reliability threshold</span>{/if}
      </div>
    {:else if p}
      <div class="muted">No samples here for this selection.</div>
    {:else}
      <div class="muted">Loading…</div>
    {/if}
  </aside>
{/if}

<style>
  .card { width: 230px; background: rgba(17, 24, 33, 0.94); color: #D7DEE6; border: 1px solid #243040; border-radius: 6px; padding: 10px 12px; display: grid; gap: 6px; font-size: 12px; pointer-events: auto; }
  header { display: flex; justify-content: space-between; align-items: center; }
  .x { background: none; border: 0; color: #8B98A6; font-size: 18px; line-height: 1; cursor: pointer; padding: 0 2px; }
  .where { font-size: 10.5px; color: #8B98A6; }
  .val { display: flex; gap: 8px; align-items: baseline; flex-wrap: wrap; }
  .big { font-size: 20px; }
  .muted { color: #8B98A6; }
  svg { width: 100%; height: 34px; }
  rect { fill: #4FD1E8; opacity: 0.7; }
  line { stroke: #D7DEE6; stroke-width: 0.6; }
  .counts { display: flex; gap: 10px; flex-wrap: wrap; font-size: 11px; }
  .weak { color: #E8C547; }
  .mix { display: flex; height: 6px; gap: 1px; border-radius: 2px; overflow: hidden; }
  .mix .seg { background: #F2A541; flex-basis: 0; }
  .mixlab { display: flex; gap: 8px; flex-wrap: wrap; font-size: 10.5px; color: #8B98A6; }
</style>
