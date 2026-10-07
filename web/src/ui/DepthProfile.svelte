<script lang="ts">
  // Median and interquartile band vs depth, from the magnetopause (D = 0) to the bow shock (D = 1).
  import { app } from '../state/app.svelte';
  import { PROFILE_THETA_MAX, stats } from '../state/stats.svelte';
  import { formatValue, ticks } from '../core/compute';
  import { grid } from '../core/grid';
  import { richText } from './format';

  const W = 300, H = 110, L = 38, R = 8, T = 8, B = 18;
  const profile = $derived((stats.result?.profile ?? []).filter((p) => p.n > 0));
  const log = $derived(grid.isLog(app.quantity));
  const yr = $derived.by(() => {
    const v = profile.flatMap((p) => [p.q25, p.q75]).filter(Number.isFinite);
    if (!v.length) return [0, 1] as [number, number];
    const lo = Math.min(...v), hi = Math.max(...v), pad = (hi - lo) * 0.08 || 0.1;
    return [lo - pad, hi + pad] as [number, number];
  });
  const x = (d: number) => L + d * (W - L - R);
  const y = (v: number) => T + (1 - (v - yr[0]) / (yr[1] - yr[0])) * (H - T - B);
  const mid = (p: { d0: number; d1: number }) => (p.d0 + p.d1) / 2;
  const band = $derived(profile.length
    ? `M${profile.map((p) => `${x(mid(p))},${y(p.q75)}`).join('L')}L${[...profile].reverse().map((p) => `${x(mid(p))},${y(p.q25)}`).join('L')}Z` : '');
  const line = $derived(profile.length ? `M${profile.map((p) => `${x(mid(p))},${y(p.q50)}`).join('L')}` : '');
  const yt = $derived(ticks(yr[0], yr[1], log, 4));
</script>

<div class="view">
  <div class="head"><span class="eyebrow">Depth profile · θ &lt; {PROFILE_THETA_MAX}°</span><span class="muted small">{@html richText(grid.raw.quantities[app.quantity].label)}</span></div>
  <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Median and interquartile range against depth between magnetopause and bow shock">
    {#each yt as t (t)}
      <line x1={L} x2={W - R} y1={y(t)} y2={y(t)} class="grid" />
      <text x={L - 4} y={y(t) + 3} text-anchor="end">{formatValue(log ? 10 ** t : t, 2)}</text>
    {/each}
    <path d={band} class="band" />
    <path d={line} class="line" />
    {#each profile as p (p.d0)}<circle cx={x(mid(p))} cy={y(p.q50)} r="2" class="dot" />{/each}
    <text x={x(0)} y={H - 4} class="mp">MP 0</text>
    <text x={x(1)} y={H - 4} text-anchor="end" class="bs">1 BS</text>
    <text x={(x(0) + x(1)) / 2} y={H - 4} text-anchor="middle">D<tspan dy="2" font-size="8">msh</tspan></text>
  </svg>
</div>

<style>
  .view { display: grid; gap: 4px; min-width: 0; }
  .head { display: flex; justify-content: space-between; gap: 8px; align-items: baseline; }
  .small { font-size: 11px; }
  svg { width: 100%; height: auto; max-height: 100px; }
  text { font: 9px var(--f-mono); fill: var(--muted); }
  .grid { stroke: var(--rule); stroke-width: 0.6; }
  .band { fill: var(--mp); fill-opacity: 0.18; }
  .line { fill: none; stroke: var(--mp); stroke-width: 1.6; }
  .dot { fill: var(--mp); }
  .mp { fill: var(--mp); }
  .bs { fill: var(--bs); }
</style>
