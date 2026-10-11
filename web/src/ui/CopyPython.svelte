<script lang="ts">
  import { app } from '../state/app.svelte';
  import { pythonSnippet } from './pythonSnippet';

  const code = $derived(pythonSnippet(app));
  let copied = $state(false);
  let open = $state(false);
  let pre: HTMLPreElement | undefined = $state();

  async function copy() {
    try {
      await navigator.clipboard.writeText(code);
      copied = true;
      setTimeout(() => (copied = false), 1600);
    } catch {
      open = true; // clipboard refused: show the code selected so the user can copy it
      queueMicrotask(() => { if (pre) getSelection()?.selectAllChildren(pre); });
    }
  }
</script>

<div class="ctl">
  <span class="eyebrow">Reproduce in Python</span>
  <div class="row">
    <button type="button" class="chip" onclick={copy}>{copied ? 'Copied' : 'Copy Python'}</button>
    <button type="button" class="link" aria-expanded={open} onclick={() => (open = !open)}>{open ? 'hide' : 'show'}</button>
  </div>
  {#if open}<pre bind:this={pre}>{code}</pre>{/if}
</div>

<style>
  .ctl { display: grid; gap: 6px; }
  .row { display: flex; gap: 8px; align-items: center; }
  .link { background: none; border: 0; color: var(--muted); font: 11px var(--f-mono); cursor: pointer; text-decoration: underline; }
  pre { margin: 0; font: 10.5px/1.45 var(--f-mono); background: var(--chip); border-radius: 4px; padding: 8px; overflow-x: auto; white-space: pre; max-width: 100%; }
</style>
