<script lang="ts">
  // IMF clock-angle sectors, seen from the Sun: +Z up, +Y right. Sector fill = N_eff available.
  type Props = {
    selected: number[];
    availability: number[] | null;
    disabled: boolean;
    onchange: (sel: number[]) => void;
  };
  let { selected, availability, disabled, onchange }: Props = $props();
  const N = 12, R0 = 38, R1 = 96;
  let anchor = $state<number | null>(null);

  function path(k: number) {
    const a0 = (k * 360 / N) * Math.PI / 180, a1 = ((k + 1) * 360 / N) * Math.PI / 180;
    const p = (a: number, r: number) => `${(r * Math.sin(a)).toFixed(2)} ${(-r * Math.cos(a)).toFixed(2)}`;
    return `M${p(a0, R1)} A${R1} ${R1} 0 0 1 ${p(a1, R1)} L${p(a1, R0)} A${R0} ${R0} 0 0 0 ${p(a0, R0)}Z`;
  }
  const maxAvail = $derived(availability ? Math.max(1, ...availability) : 1);

  function pick(k: number, e: MouseEvent | KeyboardEvent) {
    if (disabled) return;
    let next: number[];
    if (e.shiftKey && anchor !== null) {
      next = [];
      for (let i = anchor; ; i = (i + 1) % N) { next.push(i); if (i === k) break; }
    } else if (selected.includes(k)) {
      next = selected.length > 1 ? selected.filter((s) => s !== k) : selected;
    } else {
      next = [...selected, k];
    }
    anchor = k;
    onchange(next.sort((a, b) => a - b));
  }
  const all = () => onchange(Array.from({ length: N }, (_, i) => i));
</script>

<div class="dial" class:disabled>
  <svg viewBox="-118 -118 236 236" role="group" aria-label="IMF clock angle, seen from the Sun">
    {#each Array.from({ length: N }, (_, k) => k) as k (k)}
      {@const on = selected.includes(k)}
      {@const a = availability ? availability[k] / maxAvail : 0.5}
      <path
        d={path(k)}
        class="sector"
        class:on
        style:--a={(0.12 + 0.5 * a).toFixed(3)}
        role="button"
        tabindex={disabled ? -1 : 0}
        aria-pressed={on}
        aria-label={`clock ${k * 30}–${k * 30 + 30}°${availability ? `, N_eff ${availability[k]}` : ''}`}
        onclick={(e) => pick(k, e)}
        onkeydown={(e) => (e.key === 'Enter' || e.key === ' ') && (e.preventDefault(), pick(k, e))}
      />
    {/each}
    <text x="0" y="-104" text-anchor="middle">+Z</text>
    <text x="106" y="4" text-anchor="middle">+Y</text>
    <text x="0" y="114" text-anchor="middle">−Z</text>
    <text x="-106" y="4" text-anchor="middle">−Y</text>
    <text class="center" x="0" y="4" text-anchor="middle">{disabled ? 'radial' : selected.length === N ? 'all' : `${selected.length}×30°`}</text>
  </svg>
  <button type="button" class="link" onclick={all} {disabled}>all clock angles</button>
</div>

<style>
  .dial { display: grid; justify-items: center; gap: 4px; }
  svg { width: 100%; max-width: 200px; height: auto; touch-action: manipulation; }
  .sector { fill: var(--mp); fill-opacity: var(--a); stroke: var(--panel); stroke-width: 1.5; cursor: pointer; }
  .sector.on { fill: var(--mp); fill-opacity: 0.95; }
  .sector:focus-visible { outline: none; stroke: var(--fg); stroke-width: 2.5; }
  .disabled .sector { fill: var(--hatch); fill-opacity: 0.35; cursor: not-allowed; }
  text { font: 10px var(--f-mono); fill: var(--muted); pointer-events: none; }
  .center { fill: var(--fg); font-size: 11px; }
  .link { background: none; border: 0; color: var(--muted); font: 11px var(--f-mono); cursor: pointer; text-decoration: underline; }
  .link:disabled { opacity: 0.4; cursor: not-allowed; }
</style>
