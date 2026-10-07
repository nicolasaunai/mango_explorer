<script lang="ts">
  import { onMount } from 'svelte';
  import { SceneView, type CameraPreset } from '../render/scene';
  import { app, patch } from '../state/app.svelte';
  import { data } from '../state/data.svelte';
  import { probe, probeKnn, stats } from '../state/stats.svelte';
  import { BOUNDARIES, BOUNDARY_NOTE } from '../state/boundaries';
  import { VIEWS, clockUndefined } from '../state/schema';
  import { grid } from '../core/grid';
  import { cellAt, cellCenter } from '../core/geometry';
  import Inspector from './Inspector.svelte';
  import { display } from '../state/display.svelte';
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
    const d = display.shown;
    if (!view || !d) return;
    view.setSlice({ values: d.values, flags: d.flags, range: d.range, lut: d.lut, plane: app.plane, visible: app.layers.includes('slice'), field: d.field });
  });
  const setCmp = (cmp: 'A' | 'B' | 'diff') => patch({ cmp, range: null });
  $effect(() => {
    const cell = app.probe;
    const center = cell >= 0 ? cellCenter(cell, BOUNDARIES) : null;
    view?.setMarker(center);
    if (app.source === 'knn') { if (stats.knn) probeKnn(center, cell); }
    else if (stats.result) probe(cell >= 0 ? cell : null);
  });

  const fmt = new Intl.NumberFormat('en-US');
  function savePng() {
    const d = display.shown;
    if (!view || !d) return;
    const totals = data.hours?.counts({ clock_deg: app.clock, cone_deg: app.cone, Ma_sw: app.ma });
    const tmp = document.createElement('div');
    tmp.innerHTML = quantityTitle(app.quantity, app.stat);
    exportPng(view, {
      title: (d.mode === 'diff' ? 'B / A: ' : d.mode === 'A' ? 'A: ' : '') + (tmp.textContent ?? ''),
      conditions: (d.mode === 'B' || !app.pinA ? '' : `A: ${conditionSummary({ ...app.pinA, frame: app.frame })}  |  B: `) + conditionSummary(app),
      counts: totals ? `N_eff ${fmt.format(totals.neff)} spacecraft-hours · N ${fmt.format(totals.n)} samples` : '',
      provenance: `MANGO atlas ${data.manifest?.grid ?? ''} (${data.manifest?.source?.kind ?? ''}) · ${data.manifest?.created ?? ''} · ${BOUNDARY_NOTE}`,
      lut: d.lut, range: d.range, log: d.log,
    });
  }
  const frameLabel = $derived(app.frame === 'PGSM_fold' ? 'PGSM · IMF polarity folded' : app.frame);
</script>

<div class="stage">
  <canvas bind:this={canvas} aria-label="3D view of Earth, magnetopause and bow shock. Drag to orbit, scroll to zoom." tabindex="0"></canvas>
  {#if glError}<div class="nogl">{glError}</div>{/if}
  <div class="hud top">
    <span class="tag">{frameLabel}</span>
    {#if app.pinA}
      <div class="ab" role="group" aria-label="Compare pinned conditions A with current conditions B">
        <button type="button" aria-pressed={display.mode === 'A'} onclick={() => setCmp('A')}>A</button>
        <button type="button" aria-pressed={display.mode === 'B'} onclick={() => setCmp('B')}>B</button>
        <button type="button" aria-pressed={display.mode === 'diff'} disabled={!display.canDiff} onclick={() => setCmp('diff')} title={display.canDiff ? 'B / A per cell; hatched where unreliable or |z| < 2 (approximate)' : 'Choose a value statistic to compare'}>B / A</button>
      </div>
    {/if}
    <span class="tag muted">boundaries: {BOUNDARY_NOTE}</span>
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
  .ab { display: flex; pointer-events: auto; border: 1px solid #243040; border-radius: 3px; overflow: hidden; }
  .ab button { font: 11px var(--f-mono); color: #D7DEE6; background: rgba(10, 14, 19, 0.85); border: 0; border-right: 1px solid #243040; padding: 4px 10px; cursor: pointer; }
  .ab button:last-child { border-right: 0; }
  .ab button[aria-pressed='true'] { background: #D7DEE6; color: #0A0E13; }
  .ab button:disabled { opacity: 0.4; cursor: not-allowed; }
  .side { position: absolute; top: 44px; right: 10px; display: grid; gap: 6px; justify-items: end; pointer-events: none; }
  .tag.warn { color: #E8C547; }
  .cams .png { margin-right: 8px; color: #4FD1E8; }
  .cams button:disabled { opacity: 0.4; cursor: not-allowed; }
  @media (max-width: 720px) {
    .legend, .top .tag.muted { display: none; }
    .ab { display: flex; pointer-events: auto; border: 1px solid #243040; border-radius: 3px; overflow: hidden; }
  .ab button { font: 11px var(--f-mono); color: #D7DEE6; background: rgba(10, 14, 19, 0.85); border: 0; border-right: 1px solid #243040; padding: 4px 10px; cursor: pointer; }
  .ab button:last-child { border-right: 0; }
  .ab button[aria-pressed='true'] { background: #D7DEE6; color: #0A0E13; }
  .ab button:disabled { opacity: 0.4; cursor: not-allowed; }
  .side { top: 40px; }
  }
  .nogl { position: absolute; inset: 0; display: grid; place-items: center; color: #D7DEE6; font: 12px var(--f-mono); }
</style>
