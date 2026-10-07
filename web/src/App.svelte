<script lang="ts">
  import { onMount } from 'svelte';
  import ConditionsPanel from './ui/ConditionsPanel.svelte';
  import QuantityPanel from './ui/QuantityPanel.svelte';
  import Viewport from './ui/Viewport.svelte';
  import { app, patch, syncHash } from './state/app.svelte';
  import { data, loadAtlas, selectionOf } from './state/data.svelte';
  import { runKnn, runQuery } from './state/stats.svelte';
  import Colorbar from './ui/Colorbar.svelte';
  import ThetaPhiMap from './ui/ThetaPhiMap.svelte';
  import DepthProfile from './ui/DepthProfile.svelte';
  import Cite from './ui/Cite.svelte';

  syncHash();
  onMount(() => { loadAtlas(); });

  // Re-run the statistics whenever anything they depend on changes; the worker answers the latest.
  $effect(() => {
    if (data.status !== 'ready' || app.source !== 'bins') return;
    runQuery(app.frame, app.quantity, app.stat, selectionOf(app), app.neff);
  });
  $effect(() => {
    if (data.status !== 'ready' || app.source !== 'knn') return;
    runKnn(app.frame, app.quantity, app.stat, selectionOf(app), app.planes, app.shell, app.k, app.cap, app.neff);
  });
  $effect(() => {
    if (data.status !== 'ready' || !app.pinA || app.source !== 'bins') return;
    runQuery(app.frame, app.quantity, app.stat, selectionOf(app.pinA), app.neff, 'A');
  });

  let tab = $state<'cond' | 'qty' | 'views'>('cond');
  const pgsm = $derived(app.frame !== 'GSM');
  const setFrame = (f: 'GSM' | 'PGSM') => patch({ frame: f === 'GSM' ? 'GSM' : 'PGSM_fold' });
  const toggleFold = () => patch({ frame: app.frame === 'PGSM_fold' ? 'PGSM' : 'PGSM_fold' });
</script>

<div class="shell">
  <header class="top">
    <div class="brand"><span class="name">MANGO</span><span class="sub">magnetosheath explorer</span></div>
    <div class="frame" role="group" aria-label="Coordinate frame">
      <div class="seg">
        <button type="button" aria-pressed={!pgsm} onclick={() => setFrame('GSM')} title="Geocentric solar magnetospheric">GSM</button>
        <button type="button" aria-pressed={pgsm} onclick={() => setFrame('PGSM')} title="GSM rotated about X so the IMF points to +Z">PGSM</button>
      </div>
      <label class="fold" class:off={!pgsm} title="Samples with Bx < 0 are flipped (B → −B) and turned 180° about X, so the quasi-parallel side is always +Z">
        <input type="checkbox" checked={app.frame === 'PGSM_fold'} disabled={!pgsm} onchange={toggleFold} /> fold IMF polarity
      </label>
    </div>
    <div class="status mono">
      {#if data.status === 'ready' && data.manifest?.source?.kind === 'synthetic'}<span class="synthetic">synthetic data · not MANGO</span>
      {:else if data.status === 'ready' && data.manifest?.source?.kind === 'mango-api'}<Cite />
      {:else if data.status === 'ready'}atlas {data.manifest?.grid} · {data.manifest?.source?.kind}
      {:else if data.status === 'missing'}no atlas · geometry only
      {:else if data.status === 'error'}atlas error{:else}loading…{/if}
    </div>
  </header>

  <aside class="left" class:active={tab === 'cond'}><ConditionsPanel /></aside>
  <main class="view"><Viewport /></main>
  <aside class="right" class:active={tab === 'qty'}><QuantityPanel /></aside>

  <section class="strip" class:active={tab === 'views'} aria-label="Linked views">
    {#if data.status === 'ready'}
      <div class="cbwrap"><Colorbar /></div>
      <ThetaPhiMap />
      <DepthProfile />
    {:else}
      <p class="muted small">{data.status === 'missing' ? 'No atlas found next to the app: the view shows geometry only. Build one with python -m mango_explorer.atlas build and copy it to web/public/atlas.' : data.status === 'error' ? `The atlas could not be loaded: ${data.message}` : 'Loading the atlas…'}</p>
    {/if}
  </section>

  <nav class="tabs" aria-label="Panels">
    <button type="button" aria-pressed={tab === 'cond'} onclick={() => (tab = 'cond')}>Conditions</button>
    <button type="button" aria-pressed={tab === 'qty'} onclick={() => (tab = 'qty')}>Quantity</button>
    <button type="button" aria-pressed={tab === 'views'} onclick={() => (tab = 'views')}>Views</button>
  </nav>
</div>

<style>
  .shell {
    height: 100%;
    display: grid;
    grid-template-columns: 260px minmax(0, 1fr) 240px;
    grid-template-rows: auto minmax(0, 1fr) 150px;
    grid-template-areas: 'top top top' 'left view right' 'left strip right';
  }
  .top { grid-area: top; display: flex; align-items: center; justify-content: space-between; gap: 16px; flex-wrap: wrap;
    padding: 8px 16px; border-bottom: 1px solid var(--rule); background: var(--panel); }
  .brand { display: flex; align-items: baseline; gap: 10px; }
  .name { font: 800 20px/1 var(--f-display); font-stretch: 75%; letter-spacing: 0.04em; }
  .sub { font: 12px var(--f-mono); color: var(--muted); letter-spacing: 0.06em; text-transform: uppercase; }
  .frame { display: flex; align-items: center; gap: 12px; }
  .fold { display: flex; align-items: center; gap: 6px; font-size: 12.5px; cursor: pointer; }
  .fold.off { opacity: 0.45; }
  .fold input { accent-color: var(--mp); }
  .status { font-size: 11px; color: var(--muted); }
  .synthetic { color: var(--approx); border: 1px solid var(--approx); border-radius: 3px; padding: 2px 6px; text-transform: uppercase; letter-spacing: 0.06em; }
  .left, .right { overflow-y: auto; padding: 16px; background: var(--panel); }
  .left { grid-area: left; border-right: 1px solid var(--rule); }
  .right { grid-area: right; border-left: 1px solid var(--rule); }
  .view { grid-area: view; min-height: 0; }
  .strip { grid-area: strip; display: grid; grid-template-columns: minmax(0, 0.8fr) minmax(0, 1.2fr) minmax(0, 1fr); gap: 16px; padding: 10px 14px; border-top: 1px solid var(--rule); align-items: start; background: var(--panel); overflow: hidden; }
  .cbwrap { min-width: 0; }
  .small { font-size: 12px; margin: 0; align-self: center; }
  .tabs { display: none; }

  @media (max-width: 1100px) {
    .shell { grid-template-columns: 240px minmax(0, 1fr); grid-template-rows: auto minmax(0, 1fr) auto;
      grid-template-areas: 'top top' 'left view' 'right strip'; }
    .right { border-left: 0; border-top: 1px solid var(--rule); border-right: 1px solid var(--rule); max-height: 40vh; }
    .strip { grid-template-columns: 1fr 1fr; overflow-y: auto; }
    .cbwrap { grid-column: 1 / -1; }
  }
  @media (max-width: 720px) {
    .shell { grid-template-columns: minmax(0, 1fr); grid-template-rows: auto minmax(300px, 52vh) minmax(0, 1fr) auto;
      grid-template-areas: 'top' 'view' 'panel' 'tabs'; }
    .left, .right { grid-area: panel; display: none; border: 0; border-top: 1px solid var(--rule); }
    .left.active, .right.active { display: block; }
    .strip { grid-area: panel; display: none; grid-template-columns: minmax(0, 1fr); border: 0; overflow-y: auto; }
    .strip.active { display: grid; }
    .tabs { grid-area: tabs; display: flex; border-top: 1px solid var(--rule); background: var(--panel);
      padding-bottom: env(safe-area-inset-bottom, 0px); }
    .tabs button { flex: 1; padding: 12px; background: none; border: 0; color: var(--muted); font: 13px var(--f-body); }
    .tabs button[aria-pressed='true'] { color: var(--fg); box-shadow: inset 0 2px 0 var(--mp); }
    .top { padding: 8px 12px; }
    .status { display: none; }
  }
</style>
