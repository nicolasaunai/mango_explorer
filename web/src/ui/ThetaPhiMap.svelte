<script lang="ts">
  // The statistic on one D_msh shell, unrolled: azimuth phi across, angle from the Sun-Earth line down.
  import { app, patch } from '../state/app.svelte';
  import { display } from '../state/display.svelte';
  import { FLAG } from '../core/compute';
  import { grid } from '../core/grid';
  import { lutBytes, lutColor } from '../render/lut';

  const [nd, nt, nphi] = grid.spatialShape;
  let canvas: HTMLCanvasElement;

  $effect(() => {
    const r = display.shown, ctx = canvas?.getContext('2d');
    if (!ctx) return;
    const W = canvas.width, H = canvas.height, cw = W / nphi, ch = H / nt;
    const bytes = lutBytes(r?.lut ?? app.lut), [lo, hi] = r?.range ?? [0, 1];
    ctx.clearRect(0, 0, W, H);
    if (!r) return;
    for (let j = 0; j < nt; j++)
      for (let k = 0; k < nphi; k++) {
        const at = (app.shell * nt + j) * nphi + k;
        const vals = r.shell?.values ?? r.values, flags = r.shell?.flags ?? r.flags;  // k-NN shells share the cell layout
        const f = flags[at];
        const x = k * cw, y = j * ch;
        if (f === FLAG.EMPTY) continue;
        ctx.fillStyle = lutColor(bytes, (vals[at] - lo) / (hi - lo));
        ctx.fillRect(x, y, cw + 0.5, ch + 0.5);
        if (f === FLAG.WEAK) {
          ctx.fillStyle = 'rgba(58,70,85,0.75)';
          ctx.fillRect(x, y, cw + 0.5, ch + 0.5);
          ctx.strokeStyle = 'rgba(215,222,230,0.35)';
          ctx.beginPath(); ctx.moveTo(x, y + ch); ctx.lineTo(x + cw, y); ctx.stroke();
        }
      }
    if (app.probe >= 0 && Math.floor(app.probe / (nt * nphi)) === app.shell) {
      const j = Math.floor(app.probe / nphi) % nt, k = app.probe % nphi;
      ctx.strokeStyle = '#D7DEE6'; ctx.lineWidth = 2;
      ctx.strokeRect(k * cw + 1, j * ch + 1, cw - 2, ch - 2);
    }
  });

  function pick(e: MouseEvent) {
    const b = canvas.getBoundingClientRect();
    const k = Math.floor(((e.clientX - b.left) / b.width) * nphi), j = Math.floor(((e.clientY - b.top) / b.height) * nt);
    const cell = (app.shell * nt + j) * nphi + k;
    const s = display.shown;
    if (s && (s.shell?.flags ?? s.flags)[cell] !== FLAG.EMPTY) patch({ probe: cell });
  }
  const pgsm = $derived(app.frame !== 'GSM');
</script>

<div class="view">
  <div class="head">
    <span class="eyebrow" title="The map unrolls one depth layer of the magnetosheath: D = 0 at the magnetopause, 1 at the bow shock. Azimuth across, angle from the Sun–Earth line down. Only this map changes.">Depth D<sub>msh</sub> {grid.dEdges[app.shell].toFixed(1)}–{grid.dEdges[app.shell + 1].toFixed(1)}</span>
    <input type="range" min="0" max={nd - 1} value={app.shell} aria-label="Shell depth"
      oninput={(e) => patch({ shell: Number((e.currentTarget as HTMLInputElement).value) })} />
  </div>
  <div class="plot">
    <span class="yl">θ 0°</span><span class="yl bottom">120°</span>
    <canvas bind:this={canvas} width={nphi * 12} height={nt * 6} onclick={pick} aria-label="Map of the selected shell: azimuth across, angle from the Sun-Earth line down. Click a cell to inspect it."></canvas>
    <div class="xl"><span>0° +Y</span><span>90° +Z{pgsm ? ' (IMF)' : ''}</span><span>180° −Y</span><span>270° −Z</span><span>360°</span></div>
  </div>
</div>

<style>
  .view { display: grid; gap: 4px; min-width: 0; }
  .head { display: flex; justify-content: space-between; align-items: center; gap: 8px; }
  .head input { width: 40%; accent-color: var(--mp); }
  .plot { position: relative; padding-left: 34px; }
  canvas { width: 100%; height: 72px; display: block; image-rendering: pixelated; cursor: crosshair; background: repeating-linear-gradient(45deg, transparent 0 5px, color-mix(in srgb, var(--hatch) 30%, transparent) 5px 6px); border: 1px solid var(--rule); }
  .yl { position: absolute; left: 0; top: 0; font: 9.5px var(--f-mono); color: var(--muted); }
  .yl.bottom { top: auto; bottom: 14px; }
  .xl { display: flex; justify-content: space-between; font: 9.5px var(--f-mono); color: var(--muted); }
</style>
