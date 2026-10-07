<script lang="ts">
  import { app, patch } from '../state/app.svelte';
  import { stats } from '../state/stats.svelte';
  import { formatValue, isLogScale, ticks } from '../core/compute';
  import { LUT_NAMES, lutBytes, lutColor } from '../render/lut';
  import { quantityTitle } from './format';

  const result = $derived(stats.result);
  const range = $derived(app.range ?? result?.range ?? null);
  const log = $derived(isLogScale(app.quantity, app.stat));
  const gradient = $derived.by(() => {
    const b = lutBytes(app.lut);
    return `linear-gradient(90deg, ${Array.from({ length: 17 }, (_, i) => lutColor(b, i / 16)).join(', ')})`;
  });
  const tickList = $derived(range ? ticks(range[0], range[1], log) : []);
  const pos = (t: number) => (range ? ((t - range[0]) / (range[1] - range[0])) * 100 : 0);
  const label = (t: number) => formatValue(log ? 10 ** t : t, 3);
</script>

<div class="cb">
  <div class="title">{@html quantityTitle(app.quantity, app.stat)}</div>
  <div class="bar" style:background={gradient}></div>
  <div class="ticks">
    {#each tickList as t (t)}<span style:left={`${pos(t)}%`}>{label(t)}</span>{/each}
  </div>
  <div class="row">
    {#if app.range}
      <button type="button" class="chip" aria-pressed="true" onclick={() => patch({ range: null })} title="Return to the automatic 2–98 % range">range locked</button>
    {:else}
      <button type="button" class="chip" disabled={!range} onclick={() => range && patch({ range: [range[0], range[1]] })} title="Keep this range when the conditions change, to compare selections">lock range</button>
    {/if}
    <select aria-label="Colormap" value={app.lut} onchange={(e) => patch({ lut: (e.currentTarget as HTMLSelectElement).value as typeof app.lut })}>
      {#each LUT_NAMES as l (l)}<option value={l}>{l}</option>{/each}
    </select>
  </div>
  {#if !app.range}<p class="hint">Auto range: 2nd–98th percentile of reliable cells.</p>{/if}
</div>

<style>
  .cb { display: grid; gap: 6px; }
  .title { font-size: 12.5px; }
  .title :global(.unit) { color: var(--muted); font-family: var(--f-mono); font-size: 11px; }
  .bar { height: 12px; border-radius: 2px; }
  .ticks { position: relative; height: 16px; font: 10.5px var(--f-mono); color: var(--muted); }
  .ticks span { position: absolute; transform: translateX(-50%); white-space: nowrap; }
  .row { display: flex; gap: 6px; align-items: center; justify-content: space-between; }
  select { font: 11.5px var(--f-mono); background: var(--panel); color: var(--fg); border: 1px solid var(--rule); border-radius: 4px; padding: 3px 4px; }
  .hint { margin: 0; font-size: 11px; color: var(--muted); }
</style>
