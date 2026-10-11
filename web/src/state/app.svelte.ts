// Reactive application state, kept in sync with the URL hash.
import { DEFAULT_STATE, decodeHash, encodeHash, type ViewState } from './schema';

export const app = $state<ViewState>(
  typeof location !== 'undefined' ? decodeHash(location.hash) : structuredClone(DEFAULT_STATE),
);

export function patch(p: Partial<ViewState>) {
  Object.assign(app, p);
}

export function toggleLayer(l: ViewState['layers'][number]) {
  app.layers = app.layers.includes(l) ? app.layers.filter((x) => x !== l) : [...app.layers, l];
}

/** Mirror state into the hash (replaceState: no history entry per slider move). */
export function syncHash() {
  $effect(() => {
    const h = encodeHash(app);
    if (h !== location.hash) history.replaceState(null, '', h);
  });
}
