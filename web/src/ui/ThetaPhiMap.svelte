<script lang="ts">
  // The statistic on one D_msh shell, unrolled: azimuth phi across, angle from the Sun-Earth line down.
  // The same shell is drawn in 3D (layer "shells"); one depth control moves both.
  import { app, patch } from '../state/app.svelte';
  import { display } from '../state/display.svelte';
  import { FLAG } from '../core/compute';
  import { grid } from '../core/grid';
  import { cellBounds } from '../core/geometry';
  import { depthBin, shellCellAt, SHELL_GRID } from '../core/shell';
  import { lutBytes, lutColor } from '../render/lut';

  const W = 288, H = 120, TH_MAX = SHELL_GRID.thetaMax;
  let canvas: HTMLCanvasElement;

  $effect(() => {
    const r = display.shown, s = display.shell, ctx = canvas?.getContext('2d');
    if (!ctx) return;
    ctx.clearRect(0, 0, W, H);
    if (!r || !s) return;
    const bytes = lutBytes(r.lut), [lo, hi] = r.range;
    const cw = W / s.nPhi, ch = H / s.nTheta;
    for (let j = 0; j < s.nTheta; j++)
      for (let k = 0; k < s.nPhi; k++) {
        const at = j * s.nPhi + k, f = s.flags[at];
        const x = k * cw, y = j * ch;
        if (f === FLAG.EMPTY) continue;
        ctx.fillStyle = lutColor(bytes, (s.values[at] - lo) / (hi - lo));
        ctx.fillRect(x, y, cw + 0.5, ch + 0.5);
        if (f === FLAG.WEAK) {
          ctx.fillStyle = 'rgba(58,70,85,0.75)';
          ctx.fillRect(x, y, cw + 0.5, ch + 0.5);
          ctx.strokeStyle = 'rgba(215,222,230,0.35)';
          ctx.beginPath(); ctx.moveTo(x, y + ch); ctx.lineTo(x + cw, y); ctx.stroke();
        }
      }
    if (app.probe >= 0) {
      const b = cellBounds(app.probe);
      if (depthBin(app.depth) === depthBin((b.d[0] + b.d[1]) / 2)) {
        ctx.strokeStyle = '#D7DEE6'; ctx.lineWidth = 2;
        ctx.strokeRect((b.phi[0] / 360) * W + 1, (b.theta[0] / TH_MAX) * H + 1,
          ((b.phi[1] - b.phi[0]) / 360) * W - 2, ((b.theta[1] - b.theta[0]) / TH_MAX) * H - 2);
      }
    }
  });

  function pick(e: MouseEvent) {
    const s = display.shell;
    if (!s) return;
    const b = canvas.getBoundingClientRect();
    const u = (e.clientX - b.left) / b.width, v = (e.clientY - b.top) / b.height;
    const k = Math.min(s.nPhi - 1, Math.floor(u * s.nPhi)), j = Math.min(s.nTheta - 1, Math.floor(v * s.nTheta));
    if (s.flags[j * s.nPhi + k] === FLAG.EMPTY) return;
    const cell = shellCellAt(app.depth, v * TH_MAX, u * 360);
    if (cell !== null) patch({ probe: cell });
  }
  const pgsm = $derived(app.frame !== 'GSM');
  const bin = $derived(depthBin(app.depth));
  const depthLabel = $derived(app.source === 'knn' ? `D = ${app.depth.toFixed(2)}`
    : `${grid.dEdges[bin].toFixed(1)}–${grid.dEdges[bin + 1].toFixed(1)}`);
</script>

<div class="view">
  <div class="head">
    <span class="eyebrow" title="The map unrolls one depth layer of the magnetosheath: D = 0 at the magnetopause, 1 at the bow shock. Azimuth across, angle from the Sun–Earth line down. The same layer is drawn in 3D with the shells layer. Binned statistics show the depth bin that holds D.">Depth D<sub>msh</sub> {depthLabel}</span>
    <input type="range" min="0" max="1" step="0.01" value={app.depth} aria-label="Shell depth"
      oninput={(e) => patch({ depth: Number((e.currentTarget as HTMLInputElement).value) })} />
  </div>
  <div class="plot">
    <span class="yl">θ 0°</span><span class="yl bottom">{TH_MAX}°</span>
    <canvas bind:this={canvas} width={W} height={H} onclick={pick} aria-label="Map of the selected shell: azimuth across, angle from the Sun-Earth line down. Click a cell to inspect it."></canvas>
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
