<script lang="ts">
  import { onMount } from 'svelte';
  import { SceneView, type CameraPreset } from '../render/scene';
  import { app, patch } from '../state/app.svelte';
  import { data, selectionOf } from '../state/data.svelte';
  import { hasVectors } from '../core/atlas';
  import { probe, probeKnn, stats } from '../state/stats.svelte';
  import { BOUNDARIES, BOUNDARY_NOTE } from '../state/boundaries';
  import { VIEWS } from '../state/schema';
  import { imfClockOf, mixesPolarity, representativeCone, rotationOf, tintAvailable } from '../state/imf';
  import { rotateClock, unrotateClock } from '../core/frames';
  import { cellAtDisplay, cellCenter, normalizedCoords } from '../core/geometry';
  import { shellCellAt } from '../core/shell';
  import Inspector from './Inspector.svelte';
  import { display } from '../state/display.svelte';
  import { exportPng } from './exportPng';
  import { conditionSummary, quantityTitle } from './format';

  let canvas: HTMLCanvasElement;
  let view = $state<SceneView | null>(null);
  let glError = $state('');
  let dragging = $state<{ plane: string; offset: number } | null>(null);
  const axisOf: Record<string, string> = { XY: 'Z', XZ: 'Y', YZ: 'X' };

  const rot = $derived(rotationOf(app));

  onMount(() => {
    try {
      view = new SceneView(canvas);
      view.onPick = (p, onShell) => {
        // p is displayed; cells are atlas cells. On the shell, the depth is the shell's (the clicked
        // point sits on a chord of the curved surface).
        const pa = unrotateClock(p, rotationOf(app));
        const n = normalizedCoords(pa, BOUNDARIES);
        patch({ probe: (onShell ? shellCellAt(app.depth, n.thetaDeg, n.phiDeg) : cellAtDisplay(p, BOUNDARIES, rotationOf(app))) ?? -1 });
      };
      view.onPlaneDrag = (plane, offset, done) => {
        dragging = done ? null : { plane, offset };
        patch({ offsets: { ...app.offsets, [plane]: offset } });
      };
    } catch (e) {
      console.error(e);
      glError = 'WebGL is unavailable in this browser.';
    }
    return () => view?.dispose();
  });

  $effect(() => {
    view?.update({
      frame: app.frame, imfClockDeg: imfClockOf(app), imfCone: representativeCone(app.cone), rotationDeg: rot,
      showMp: app.layers.includes('mp'), showBs: app.layers.includes('bs'),
      tint: app.layers.includes('tint') && tintAvailable(app.frame, app.clock, app.cone),
      shells: app.layers.includes('shells'), shellD: app.depth, rMp: BOUNDARIES.rMp, rBs: BOUNDARIES.rBs,
    });
  });
  // a layer in the URL is ignored when the atlas has no vector sums (its toggle is disabled)
  const vectors = $derived(hasVectors(data.manifest));
  const flowOn = $derived(vectors && app.layers.includes('flow'));
  const fieldOn = $derived(vectors && app.layers.includes('field'));
  $effect(() => { view?.setLines('flow', flowOn ? stats.lines.flow : null); });
  $effect(() => { view?.setLines('field', fieldOn ? stats.lines.field : null); });
  $effect(() => { view?.setLinesDimmed('flow', stats.linesPending.flow); });
  $effect(() => { view?.setLinesDimmed('field', stats.linesPending.field); });
  const linesOn = $derived(flowOn || fieldOn);
  const linesUpdating = $derived((flowOn && stats.linesPending.flow) || (fieldOn && stats.linesPending.field));
  $effect(() => {
    const d = display.shown, s = display.shell;
    if (view && d) view.setShell(s, d.range, d.lut);
  });
  $effect(() => view?.setView(app.view as CameraPreset));
  $effect(() => { const o = { ...app.offsets }; view?.setOffsets(o); });
  $effect(() => {
    const d = display.shown;
    if (!view || !d) return;
    view.setSlices({ planes: app.planes, values: d.values, flags: d.flags, range: d.range, lut: d.lut, visible: app.layers.includes('slice'), field: d.field });
  });
  const setCmp = (cmp: 'A' | 'B' | 'diff') => patch({ cmp, range: null });
  $effect(() => {
    const cell = app.probe;
    const center = cell >= 0 ? cellCenter(cell, BOUNDARIES) : null;
    // the marker is drawn displayed; the k-NN probe gets the atlas centre (its samples are in atlas coordinates)
    view?.setMarker(center ? rotateClock(center, rot) : null);
    if (app.source === 'knn') { if (stats.knn) probeKnn(center, cell); }
    else if (stats.result) probe(cell >= 0 ? cell : null);
  });

  const fmt = new Intl.NumberFormat('en-US');
  function savePng() {
    const d = display.shown;
    if (!view || !d) return;
    const totals = data.hours[app.frame]?.counts(selectionOf(app.frame, app));
    const tmp = document.createElement('div');
    tmp.innerHTML = quantityTitle(app.quantity, app.stat);
    exportPng(view, {
      title: (d.mode === 'diff' ? 'B / A: ' : d.mode === 'A' ? 'A: ' : '') + (tmp.textContent ?? ''),
      conditions: (d.mode === 'B' || !app.pinA ? '' : `A: ${conditionSummary({ ...app.pinA, frame: app.frame, clockDeg: app.clockDeg })}  |  B: `) + conditionSummary(app),
      counts: totals ? `N_eff ${fmt.format(totals.neff)} spacecraft-hours · N ${fmt.format(totals.n)} samples` : '',
      provenance: `MANGO atlas ${data.manifest?.grid ?? ''} (${data.manifest?.source?.kind ?? ''}) · ${data.manifest?.created ?? ''} · ${BOUNDARY_NOTE}`,
      lut: d.lut, range: d.range, log: d.log,
    });
  }
  const frameLabel = $derived(app.frame === 'PGSM' ? `PGSM · clock ${app.clockDeg}°` : 'GSM');
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
    {#if dragging}<span class="tag">{dragging.plane} plane · {axisOf[dragging.plane]} = {dragging.offset.toFixed(2)} R<sub>E</sub></span>{/if}
    {#if stats.pending}<span class="tag muted">updating…</span>{/if}
    {#if stats.error}<span class="tag warn">{stats.error}</span>{/if}
    {#if linesUpdating}<span class="tag muted">lines updating…</span>{/if}
    {#if linesOn}<span class="tag muted">lines: k-NN 1/d mean, k = {app.k}, cap {app.cap} R<sub>E</sub> · vectors mapped to normalized space</span>{/if}
    {#if fieldOn && mixesPolarity(app.frame, app.clock, app.cone)}<span class="tag warn">field lines average opposite IMF orientations</span>{/if}
    {#if linesOn && stats.linesError}<span class="tag warn">lines: {stats.linesError}</span>{/if}
    <Inspector />
  </div>
  <div class="hud bottom">
    <div class="legend tag">
      <span><i style="background:#4FD1E8"></i>magnetopause</span>
      <span><i style="background:#F2A541"></i>bow shock</span>
      {#if flowOn}<span><i style="background:#7EE0C3"></i>flow lines (V)</span>{/if}
      {#if fieldOn}<span><i style="background:#C49BF2"></i>field lines (B)</span>{/if}
      {#if app.layers.includes('tint') && tintAvailable(app.frame, app.clock, app.cone)}
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
