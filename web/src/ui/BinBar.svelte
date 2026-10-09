<script lang="ts">
  // A row of adjacent bins; each cell's fill shows how much data it holds.
  type Props = {
    labels: string[];
    selected: number[];
    availability: number[] | null;
    ariaLabel: string;
    onchange: (sel: number[]) => void;
  };
  let { labels, selected, availability, ariaLabel, onchange }: Props = $props();
  const maxAvail = $derived(availability ? Math.max(1, ...availability) : 1);

  function toggle(i: number, e: MouseEvent) {
    if (e.shiftKey && selected.length) {
      const lo = Math.min(i, ...selected), hi = Math.max(i, ...selected);
      onchange(Array.from({ length: hi - lo + 1 }, (_, k) => lo + k));
    } else if (selected.includes(i)) {
      if (selected.length > 1) onchange(selected.filter((s) => s !== i));
    } else {
      onchange([...selected, i].sort((a, b) => a - b));
    }
  }
</script>

<!-- at most 6 bins per row: the 12 cone bins become 0–90° (Bx > 0) over 90–180° (Bx < 0) -->
<div class="bar" role="group" aria-label={ariaLabel}
  style:grid-template-columns={`repeat(${Math.min(labels.length, 6)}, minmax(0, 1fr))`}>
  {#each labels as l, i (i)}
    {@const a = availability ? availability[i] / maxAvail : 0}
    <button type="button" aria-pressed={selected.includes(i)} onclick={(e) => toggle(i, e)}
      title={availability ? `N_eff ${availability[i]}` : undefined}>
      <span class="fill" style:height={`${(a * 100).toFixed(1)}%`}></span>
      <span class="txt">{l}</span>
    </button>
  {/each}
</div>

<style>
  .bar { display: grid; gap: 2px; }
  button { position: relative; min-width: 0; height: 34px; border: 1px solid var(--rule); border-radius: 3px;
    background: transparent; color: var(--muted); font: 10.5px var(--f-mono); cursor: pointer; overflow: hidden; padding: 0 2px; }
  .fill { position: absolute; left: 0; right: 0; bottom: 0; background: var(--mp); opacity: 0.18; }
  .txt { position: relative; }
  button[aria-pressed='true'] { border-color: var(--mp); color: var(--fg); }
  button[aria-pressed='true'] .fill { opacity: 0.55; }
  button:focus-visible { outline: 2px solid var(--mp); outline-offset: 1px; }
</style>
