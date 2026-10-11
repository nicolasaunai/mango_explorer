<script lang="ts">
  // How to cite the MANGO dataset shown here (citation recorded in the atlas at build time).
  import { data } from '../state/data.svelte';

  let open = $state(false);
  let copied = $state(false);
  const src = $derived(data.manifest?.source);
  const citation = $derived(src?.citation ?? '');

  async function copy() {
    try { await navigator.clipboard.writeText(citation); copied = true; setTimeout(() => (copied = false), 1500); }
    catch { /* the text stays selectable below */ }
  }
</script>

{#if src?.kind === 'mango-api'}
  <div class="cite">
    <button type="button" class="chip" aria-expanded={open} onclick={() => (open = !open)}>MANGO {src.dataset_version} · cite</button>
    {#if open}
      <div class="pop" role="dialog" aria-label="How to cite MANGO">
        <p>Statistics computed from the MANGO dataset, version {src.dataset_version}. Please cite:</p>
        <pre>{citation}</pre>
        <div class="row">
          <button type="button" class="chip" onclick={copy}>{copied ? 'Copied' : 'Copy BibTeX'}</button>
          <a href="https://github.com/LaboratoryOfPlasmaPhysics/mango" target="_blank" rel="noreferrer">MANGO on GitHub</a>
        </div>
      </div>
    {/if}
  </div>
{/if}

<style>
  .cite { position: relative; }
  .pop { position: absolute; right: 0; top: calc(100% + 6px); z-index: 20; width: min(440px, 90vw); background: var(--panel);
    border: 1px solid var(--rule); border-radius: 6px; padding: 12px; display: grid; gap: 8px; font-size: 12.5px; box-shadow: 0 8px 24px rgba(0, 0, 0, 0.3); }
  .pop p { margin: 0; }
  pre { margin: 0; font: 10.5px/1.45 var(--f-mono); background: var(--chip); padding: 8px; border-radius: 4px; white-space: pre-wrap; user-select: all; }
  .row { display: flex; gap: 10px; align-items: center; }
  a { color: var(--mp); font-size: 12px; }
</style>
