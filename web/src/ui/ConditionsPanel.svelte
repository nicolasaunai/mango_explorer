<script lang="ts">
  import ClockDial from './ClockDial.svelte';
  import BinBar from './BinBar.svelte';
  import { app, patch } from '../state/app.svelte';
  import { data, selectionOf } from '../state/data.svelte';
  import { PRESETS, clockUndefined } from '../state/schema';
  import { conditionSummary } from './format';
  import { grid, type ConditionName } from '../core/grid';

  const labelsOf = (name: ConditionName) => {
    const e = grid.conditionEdges(name);
    return e.slice(0, -1).map((lo, i) => (e[i + 1] >= 1e8 ? `>${lo}` : `${lo}–${e[i + 1]}`));
  };
  const coneLabels = labelsOf('cone_deg');
  const maLabels = labelsOf('Ma_sw');

  const sel = $derived(selectionOf(app));
  const totals = $derived(data.hours?.counts(sel) ?? null);
  const marg = (dim: ConditionName) => data.hours?.marginal(dim, sel).map((c) => c.neff) ?? null;
  const clockAvail = $derived(marg('clock_deg'));
  const coneAvail = $derived(marg('cone_deg'));
  const maAvail = $derived(marg('Ma_sw'));
  const radial = $derived(clockUndefined(app.cone));
  const weak = $derived(totals !== null && (totals.neff < 30 || totals.n < 10_000));
  const fmt = new Intl.NumberFormat('en-US');
</script>

<section class="panel" aria-label="Solar wind and IMF conditions">
  <header><span class="eyebrow">Conditions</span><span class="mono muted">3 / 3 active</span></header>

  <div class="presets">
    {#each PRESETS as p (p.id)}
      <button type="button" class="chip" title={p.hint} onclick={() => patch(p.state)}>{p.label}</button>
    {/each}
  </div>

  <div class="ctl">
    <div class="row"><span class="eyebrow">IMF clock angle</span>
      <span class="mono muted">{radial ? 'undefined' : app.clock.length === 12 ? 'all' : `${app.clock.length} × 30°`}</span></div>
    <ClockDial selected={app.clock} availability={clockAvail} disabled={radial} onchange={(clock) => patch({ clock })} />
    {#if radial}<p class="note">The clock angle is undefined for radial IMF (cone &lt; 30°), so it is not applied.</p>{/if}
  </div>

  <div class="ctl">
    <div class="row"><span class="eyebrow">Cone angle (°)</span></div>
    <BinBar labels={coneLabels} selected={app.cone} availability={coneAvail} ariaLabel="cone angle bins" onchange={(cone) => patch({ cone })} />
  </div>

  <div class="ctl">
    <div class="row"><span class="eyebrow">Alfvén Mach M<sub>A</sub></span></div>
    <BinBar labels={maLabels} selected={app.ma} availability={maAvail} ariaLabel="Alfvén Mach number bins" onchange={(ma) => patch({ ma })} />
  </div>

  <div class="pin">
    {#if app.pinA}
      <div class="achip"><span class="tagA">A</span><span class="mono small">{conditionSummary({ ...app.pinA, frame: app.frame }).split(' · ').slice(1).join(' · ')}</span></div>
      <div class="row2">
        <button type="button" class="chip" onclick={() => patch({ pinA: { clock: [...app.clock], cone: [...app.cone], ma: [...app.ma] } })}>re-pin current as A</button>
        <button type="button" class="chip" onclick={() => patch({ pinA: null, cmp: 'B', range: null })}>unpin</button>
      </div>
      <p class="note">The controls now set B. Switch between A, B and B / A above the view.</p>
    {:else}
      <button type="button" class="chip" onclick={() => patch({ pinA: { clock: [...app.clock], cone: [...app.cone], ma: [...app.ma] }, cmp: 'B' })} title="Freeze these conditions as A, then change the controls to define B">Pin as A to compare</button>
    {/if}
  </div>

  <footer class:weak>
    {#if data.status === 'ready' && totals}
      <div><span class="big mono">{fmt.format(totals.neff)}</span> <span class="muted">spacecraft-hours (N<sub>eff</sub>)</span></div>
      <div class="mono muted">{fmt.format(totals.n)} samples · 5 s</div>
      {#if weak}<div class="warn">Thin selection: widen a condition for more coverage.</div>{/if}
    {:else if data.status === 'loading'}
      <div class="muted">Loading coverage…</div>
    {:else}
      <div class="muted">No atlas loaded: counts unavailable.</div>
    {/if}
  </footer>
</section>

<style>
  .panel { display: grid; gap: 16px; align-content: start; }
  header, .row { display: flex; flex-wrap: nowrap; white-space: nowrap; justify-content: space-between; align-items: baseline; gap: 8px; }
  .ctl { display: grid; gap: 6px; }
  .presets { display: flex; flex-wrap: wrap; gap: 4px; }
  .note { font-size: 12px; color: var(--muted); margin: 0; }
  footer { border-top: 1px solid var(--rule); padding-top: 10px; display: grid; gap: 2px; font-size: 12px; }
  .big { font-size: 20px; color: var(--fg); }
  .weak .big { color: var(--approx); }
  .warn { color: var(--approx); }
  .pin { display: grid; gap: 6px; }
  .achip { display: flex; gap: 8px; align-items: baseline; }
  .tagA { font: 600 11px var(--f-mono); color: var(--bg); background: var(--bs); border-radius: 3px; padding: 1px 6px; }
  .row2 { display: flex; gap: 6px; flex-wrap: wrap; }
  .small { font-size: 11px; }
</style>
