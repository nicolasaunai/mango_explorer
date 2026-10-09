<script lang="ts">
  // The PGSM target IMF clock angle, seen from the Sun: +Z up, +Y right. Click or drag to set it.
  type Props = { value: number; onchange: (deg: number) => void };
  let { value, onchange }: Props = $props();
  const R = 96;
  let svg: SVGSVGElement;
  let dragging = false;
  const wrap = (d: number) => ((Math.round(d) % 360) + 360) % 360;

  function at(e: PointerEvent) {
    const b = svg.getBoundingClientRect();
    const x = e.clientX - (b.left + b.width / 2), y = e.clientY - (b.top + b.height / 2);
    onchange(wrap((Math.atan2(x, -y) * 180) / Math.PI));
  }
  function key(e: KeyboardEvent) {
    const step = e.shiftKey ? 15 : 1;
    if (e.key === 'ArrowRight' || e.key === 'ArrowUp') { e.preventDefault(); onchange(wrap(value + step)); }
    if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') { e.preventDefault(); onchange(wrap(value - step)); }
  }
  const tip = $derived([R * Math.sin((value * Math.PI) / 180), -R * Math.cos((value * Math.PI) / 180)]);
</script>

<div class="dial">
  <svg bind:this={svg} viewBox="-118 -118 236 236" role="slider" tabindex="0" aria-label="IMF clock angle, seen from the Sun"
    aria-valuemin="0" aria-valuemax="359" aria-valuenow={value} onkeydown={key}
    onpointerdown={(e) => { dragging = true; svg.setPointerCapture(e.pointerId); at(e); }}
    onpointermove={(e) => dragging && at(e)} onpointerup={() => (dragging = false)}>
    <circle r={R} class="ring" />
    {#each [0, 90, 180, 270] as a (a)}
      <line class="tick" x1={0} y1={-R} x2={0} y2={-R + 8} transform={`rotate(${a})`} />
    {/each}
    <line class="needle" x1="0" y1="0" x2={tip[0]} y2={tip[1]} />
    <circle class="hub" r="4" />
    <text x="0" y="-104" text-anchor="middle">+Z</text>
    <text x="106" y="4" text-anchor="middle">+Y</text>
    <text x="0" y="114" text-anchor="middle">−Z</text>
    <text x="-106" y="4" text-anchor="middle">−Y</text>
  </svg>
  <label class="num">clock <input type="number" min="0" max="359" step="1" value={value} class="mono"
    onchange={(e) => { const v = Number((e.currentTarget as HTMLInputElement).value); if (Number.isFinite(v)) onchange(wrap(v)); }} />°</label>
</div>

<style>
  .dial { display: grid; justify-items: center; gap: 4px; }
  svg { width: 100%; max-width: 200px; height: auto; touch-action: none; cursor: pointer; outline: none; }
  svg:focus-visible .ring { stroke: var(--fg); }
  .ring { fill: color-mix(in srgb, var(--mp) 10%, transparent); stroke: var(--rule); stroke-width: 1.5; }
  .tick { stroke: var(--muted); stroke-width: 1.5; }
  .needle { stroke: var(--approx); stroke-width: 3; stroke-linecap: round; }
  .hub { fill: var(--approx); }
  text { font: 10px var(--f-mono); fill: var(--muted); pointer-events: none; }
  .num { font: 12px var(--f-mono); display: flex; gap: 6px; align-items: center; }
  .num input { width: 4.5em; font-size: 12px; padding: 3px 6px; border: 1px solid var(--rule); border-radius: 4px; background: var(--panel); color: var(--fg); }
</style>
