// Loads the static atlas served next to the app (./atlas/manifest.json) if there is one.
import { httpFetcher, loadManifest, loadSections, type Manifest } from '../core/atlas';
import type { FrameName } from '../core/grid';
import { HourTable } from '../core/hours';
import { startWorker } from './stats.svelte';

type Status = 'loading' | 'ready' | 'missing' | 'error';

export const data = $state<{ status: Status; message: string; manifest: Manifest | null; hours: Partial<Record<FrameName, HourTable>> }>({
  status: 'loading', message: '', manifest: null, hours: {},
});

export async function loadAtlas(base = new URL('atlas/', document.baseURI).href) {
  const fetchBytes = httpFetcher(base);
  try {
    const manifest = await loadManifest(fetchBytes);
    for (const h of manifest.hours) data.hours[h.frame] = new HourTable(await loadSections(fetchBytes, h));
    await startWorker(base);
    data.manifest = manifest;
    data.status = 'ready';
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    data.status = /HTTP 404|JSON/.test(msg) ? 'missing' : 'error';
    data.message = msg;
  }
}

export { selectionOf } from './selection';
