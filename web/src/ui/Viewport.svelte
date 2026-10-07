<script lang="ts">
  import { onMount } from 'svelte';
  import { SceneView, type CameraPreset } from '../render/scene';
  import { app, patch } from '../state/app.svelte';
  import { data } from '../state/data.svelte';
  import { probe, stats } from '../state/stats.svelte';
  import { BOUNDARIES, BOUNDARY_NOTE } from '../state/boundaries';
  import { VIEWS, clockUndefined } from '../state/schema';
  import { grid } from '../core/grid';
  import { cellAt, cellCenter } from '../core/geometry';
  import { isLogScale } from '../core/compute';
  import Inspector from './Inspector.svelte';
  import { exportPng } from './exportPng';
  import { conditionSummary, quantityTitle } from './format';

  let canvas: HTMLCanvasElement;
  let view = $state<SceneView | null>(null);
  let glError = $state('');

  /** Circular mean of the selected 30° sectors; null when it carries no direction. */
  function representativeClock(sectors: number[]): number | null {
    if (sectors.length === 12 || clockUndefined(app.cone)) return null;
    let x = 0, y = 0;
    for (const k of sectors) { const a = ((k + 0.5) * 30 * Math.PI) / 180; x += Math.sin(a); y += Math.cos(a); }
    if (Math.hypot(x, y) / sectors.length < 0.2) return null;
    return ((Math.atan2(x, y) * 180) / Math.PI + 360) % 360;
  }
  const coneEdges = grid.conditionEdges('cone_deg');
  const representativeCone = (bins: number[]) =>
    bins.reduce((s, b) => s + (coneEdges[b] + coneEdges[b + 1]) / 2, 0) / bins.length;

  onMount(() => {
    try {
      view = new SceneView(canvas);
      view.onPick = (p) => patch({ probe: cellAt(p, BOUNDARIES) ?? -1 });
    } catch (e) {
      console.error(e);
      glError = 'WebGL is unavailable in this browser.';
    }
    return () => view?.dispose();
  });

  $effect(() => {
    view?.update({
      frame: app.frame,
      clockDeg: representativeClock(app.clock),
      coneDeg: representativeCone(app.cone),
      showMp: app.layers.includes('mp'),
      showBs: app.layers.includes('bs'),
      tint: app.layers.includes('tint'),
      shells: app.layers.includes('shells'),
      rMp: BOUNDARIES.rMp, rBs: BOUNDARIES.rBs,
    });
  });
  $effect(() => view?.setView(app.view as CameraPreset));
  $effect(() => {
    const r = stats.result;
    if (!view || !r) return;
    view.setSlice({ values: r.values, flags: r.flags, range: app.range ?? r.range, lut: app.lut, plane: app.plane, visible: app.layers.includes('slice') });
  });
  $effect(() => {
    const cell = app.probe;
    view?.setMarker(cell >= 0 ? cellCenter(cell, BOUNDARIES) : null);
    if (stats.result) probe(cell >= 0 ? cell : null);
  });

  const fmt = new Intl.NumberFormat('en-US');
  function savePng() {
    const r = stats.result;
    if (!view || !r) return;
    const totals = data.hours?.counts({ clock_deg: app.clock, cone_deg: app.cone, Ma_sw: app.ma });
    const tmp = document.createElement('div');
    tmp.innerHTML = quantityTitle(app.quantity, app.stat);
    exportPng(view, {
      title: tmp.textContent ?? '',
      conditions: conditionSummary(app),
      counts: totals ? `N_eff ${fmt.format(totals.neff)} spacecraft-hours · N ${fmt.format(totals.n)} samples` : '',
      provenance: `MANGO atlas ${data.manifest?.grid ?? ''} (${data.manifest?.source?.kind ?? ''}) · ${data.manifest?.created ?? ''} · ${BOUNDARY_NOTE}`,
      lut: app.lut, range: app.range ?? r.range, log: isLogScale(app.quantity, app.stat),
    });
  }
  const frameLabel = $derived(app.frame === 'PGSM_fold' ? 'PGSM · IMF polarity folded' : app.frame);
</script>

<div class="stage">
  <canvas bind:this={canvas} aria-label="3D view of Earth, magnetopause and bow shock. Drag to orbit, scroll to zoom." tabindex="0"></canvas>
  {#if glError}<div class="nogl">{glError}</div>{/if}
  <div class="hud top">
    <span class="tag">{frameLabel}</span>
    <span class="tag muted">boundaries: Shue 98 / Jelínek 12 at P<sub>d</sub> = 2 nPa · illustrative</span>
  </div>
  <div class="side">
    {#if stats.pending}<span class="tag muted">updating…</span>{/if}
    {#if stats.error}<span class="tag warn">{stats.error}</span>{/if}
    <Inspector />
  </div>
  <div class="hud bottom">
    <div class="legend tag">
      <span><i style="background:#4FD1E8"></i>magnetopause</span>
      <span><i style="background:#F2A541"></i>bow shock</span>
      {#if app.frame === 'PGSM_fold' && app.layers.includes('tint')}
        <span><i style="background:#E58467"></i>θ<sub>Bn</sub> &lt; 45° (Q∥)</span>
        <span><i style="background:#7FA0D0"></i>θ<sub>Bn</sub> &gt; 45° (Q⊥)</span>
      {/if}
    </div>
    <div class="cams" role="group" aria-label="Camera presets">
      <button type="button" class="png" disabled={!stats.result} onclick={savePng} title="Save the view as PNG, with the conditions and colour scale">PNG</button>
      {#each VIEWS as v (v)}
        <button type="button" aria-pressed={app.view === v} onclick={() => { patch({ view: v }); view?.setView(v); }}>{v}</button>
      {/each}
    </div>
  </div>
</div>

<style>
  .stage { position: relative; height: 100%; min-height: 320px; background: var(--screen); overflow: hidden; }
  canvas { display: block; width: 100%; height: 100%; outline: none; }
  .hud { position: absolute; left: 10px; right: 10px; display: flex; justify-content: space-between; gap: 8px; flex-wrap: wrap; pointer-events: none; }
  .top { top: 10px; }
  .bottom { bottom: 10px; align-items: flex-end; }
  .tag { font: 11px var(--f-mono); color: #D7DEE6; background: rgba(10, 14, 19, 0.75); border: 1px solid #243040; padding: 4px 8px; border-radius: 3px; }
  .tag.muted { color: #8B98A6; }
  .legend { display: grid; gap: 3px; }
  .legend i { display: inline-block; width: 10px; height: 10px; border-radius: 2px; margin-right: 6px; vertical-align: -1px; }
  .cams { display: flex; gap: 4px; flex-wrap: wrap; pointer-events: auto; }
  .cams button { font: 11px var(--f-mono); color: #D7DEE6; background: rgba(10, 14, 19, 0.8); border: 1px solid #243040; border-radius: 3px; padding: 4px 8px; cursor: pointer; text-transform: capitalize; }
  .cams button[aria-pressed='true'] { border-color: #4FD1E8; color: #4FD1E8; }
  .side { position: absolute; top: 44px; right: 10px; display: grid; gap: 6px; justify-items: end; pointer-events: none; }
  .tag.warn { color: #E8C547; }
  .cams .png { margin-right: 8px; color: #4FD1E8; }
  .cams button:disabled { opacity: 0.4; cursor: not-allowed; }
  @media (max-width: 720px) {
    .legend, .top .tag.muted { display: none; }
    .side { top: 40px; }
  }
  .nogl { position: absolute; inset: 0; display: grid; place-items: center; color: #D7DEE6; font: 12px var(--f-mono); }
</style>
