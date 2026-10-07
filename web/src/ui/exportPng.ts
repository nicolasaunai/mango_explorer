// PNG of the 3D view with the conditions, colour scale, N_eff and data provenance burned in.
import type { SceneView } from '../render/scene';
import { lutBytes, lutColor, type LutName } from '../render/lut';
import { formatValue } from '../core/compute';

export type ExportInfo = {
  title: string; conditions: string; counts: string; provenance: string;
  lut: LutName; range: [number, number]; log: boolean;
};

export function exportPng(view: SceneView, info: ExportInfo) {
  const scene = view.capture();
  const s = scene.width / scene.clientWidth || 2;
  const c = document.createElement('canvas');
  c.width = scene.width; c.height = scene.height;
  const ctx = c.getContext('2d')!;
  ctx.drawImage(scene, 0, 0);
  const pad = 14 * s, w = 360 * s, h = 112 * s, x = pad, y = c.height - h - pad;
  ctx.fillStyle = 'rgba(10,14,19,0.82)';
  ctx.fillRect(x, y, w, h);
  ctx.fillStyle = '#D7DEE6';
  ctx.font = `600 ${13 * s}px "IBM Plex Sans", sans-serif`;
  ctx.fillText(info.title, x + 10 * s, y + 20 * s);
  ctx.font = `${11 * s}px "IBM Plex Mono", monospace`;
  ctx.fillStyle = '#8B98A6';
  ctx.fillText(info.conditions, x + 10 * s, y + 38 * s);
  ctx.fillText(info.counts, x + 10 * s, y + 54 * s);
  const bytes = lutBytes(info.lut), bx = x + 10 * s, bw = w - 20 * s, by = y + 64 * s;
  for (let i = 0; i < bw; i++) { ctx.fillStyle = lutColor(bytes, i / bw); ctx.fillRect(bx + i, by, 1.5, 10 * s); }
  const lab = (v: number) => formatValue(info.log ? 10 ** v : v, 3);
  ctx.fillStyle = '#D7DEE6';
  ctx.fillText(lab(info.range[0]), bx, by + 24 * s);
  const hi = lab(info.range[1]);
  ctx.fillText(hi, bx + bw - ctx.measureText(hi).width, by + 24 * s);
  ctx.fillStyle = '#8B98A6';
  ctx.font = `${9.5 * s}px "IBM Plex Mono", monospace`;
  ctx.fillText(info.provenance, bx, y + h - 6 * s);
  const a = document.createElement('a');
  a.download = 'mango-explorer.png';
  a.href = c.toDataURL('image/png');
  a.click();
}
