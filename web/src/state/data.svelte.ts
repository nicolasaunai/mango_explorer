// Loads the static atlas served next to the app (./atlas/manifest.json) if there is one.
import { httpFetcher, loadManifest, loadSections, type Manifest, type Selection } from '../core/atlas';
import { HourTable } from '../core/hours';
import type { ViewState } from './schema';
import { startWorker } from './stats.svelte';

type Status = 'loading' | 'ready' | 'missing' | 'error';

export const data = $state<{ status: Status; message: string; manifest: Manifest | null; hours: HourTable | null }>({
  status: 'loading', message: '', manifest: null, hours: null,
});

export async function loadAtlas(base = new URL('atlas/', document.baseURI).href) {
  const fetchBytes = httpFetcher(base);
  try {
    const manifest = await loadManifest(fetchBytes);
    data.hours = new HourTable(await loadSections(fetchBytes, manifest.hours));
    await startWorker(base);
    data.manifest = manifest;
    data.status = 'ready';
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    data.status = /HTTP 404|JSON/.test(msg) ? 'missing' : 'error';
    data.message = msg;
  }
}

export const selectionOf = (s: ViewState): Selection => ({ clock_deg: s.clock, cone_deg: s.cone, Ma_sw: s.ma });
