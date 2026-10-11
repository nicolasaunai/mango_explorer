// Traces flow and field lines in a worker of its own, so the maps, shell and probes never wait for them.
// Only the newest pending request per kind is traced; older ones are answered `superseded`.
import { httpFetcher, loadManifest, type FetchBytes, type Manifest } from '../core/atlas';
import { VoxelFrame, voxelVectorAt, type VectorName, type VectorVoxelSet } from '../core/voxels';
import { LINE, insideSheath, latticeField, pack, seedsFor, traceBoth, type VectorField } from '../core/lines';
import { DISPLAY_BOUNDARIES } from '../core/display';
import { grid } from '../core/grid';
import type { LineKind, LinesRequest, LinesWorkerReply } from './protocol';

type LinesMsg = Extract<LinesRequest, { type: 'lines' }>;

let fetchBytes: FetchBytes;
let manifest: Manifest;
const KNN = grid.raw.knn;
const post = (msg: LinesWorkerReply, transfer: Transferable[] = []) => (self as unknown as Worker).postMessage(msg, transfer);

const voxelFrames = new Map<string, Promise<VoxelFrame>>();
/** Per kind: the summed vector voxels of (frame, selection, cap), kept when only k changes ... */
const sets = new Map<LineKind, { key: string; set: VectorVoxelSet }>();
/** ... and the lattice field of that set and k, kept when only the seeding changes. */
const fields = new Map<LineKind, { key: string; field: VectorField }>();

function voxelFrame(frame: string) {
  if (!voxelFrames.has(frame)) {
    const load = VoxelFrame.load(manifest, frame, fetchBytes);
    voxelFrames.set(frame, load);
    load.catch(() => voxelFrames.delete(frame));
  }
  return voxelFrames.get(frame)!;
}

async function vectorField(m: LinesMsg) {
  const setKey = JSON.stringify([m.frame, m.selection, m.cap]), fieldKey = JSON.stringify([setKey, m.k]);
  const hit = fields.get(m.kind);
  if (hit?.key === fieldKey) return hit.field;
  let s = sets.get(m.kind);
  if (s?.key !== setKey) {
    const name: VectorName = m.kind === 'flow' ? 'V_vec' : 'B_vec';
    s = { key: setKey, set: await (await voxelFrame(m.frame)).selectVector(name, m.selection, m.cap / 2) };
    sets.set(m.kind, s);
  }
  const set = s.set;
  const field = latticeField((p) => voxelVectorAt(set, p, m.k, m.cap, KNN.search_factor));
  fields.set(m.kind, { key: fieldKey, field });
  return field;
}

async function traceLines(m: LinesMsg) {
  try {
    const t0 = performance.now();
    const field = await vectorField(m);
    const o = { step: LINE.step, maxSteps: LINE.maxSteps, inside: insideSheath(DISPLAY_BOUNDARIES) };
    // seeds may sit anywhere in the sheath: trace both ways, for flow lines too
    const starts = seedsFor(m.seeding, DISPLAY_BOUNDARIES);
    const { points, offsets } = pack(starts.map((s) => traceBoth(field, s, o)));
    const seeds = new Float32Array(m.seeding.mode === 'plane' ? starts.flat() : []);
    post({ type: 'lines', id: m.id, kind: m.kind, points, offsets, seeds, ms: performance.now() - t0 },
      [points.buffer, offsets.buffer, seeds.buffer]);
  } catch (err) {
    post({ type: 'error', id: m.id, message: err instanceof Error ? err.message : String(err) });
  }
}

const pending: Partial<Record<LineKind, LinesMsg>> = {};
let busy = false;

/** Trace the pending requests one by one, oldest first; between two, let newer messages replace them. */
async function drain() {
  if (busy) return;
  busy = true;
  try {
    for (;;) {
      await new Promise((r) => setTimeout(r, 0));
      const next = Object.values(pending).sort((a, b) => a.id - b.id)[0];
      if (!next) return;
      delete pending[next.kind];
      await traceLines(next);
    }
  } finally {
    busy = false;
  }
}

function drop(kind: LineKind) {
  const old = pending[kind];
  if (old) { post({ type: 'superseded', id: old.id }); delete pending[kind]; }
}

self.onmessage = async (e: MessageEvent<LinesRequest>) => {
  const m = e.data;
  if (m.type === 'init') {
    try {
      fetchBytes = httpFetcher(m.base);
      manifest = await loadManifest(fetchBytes);
      post({ type: 'ready', id: m.id });
    } catch (err) {
      post({ type: 'error', id: m.id, message: err instanceof Error ? err.message : String(err) });
    }
  } else if (m.type === 'cancel') {
    drop(m.kind);
  } else {
    drop(m.kind);
    pending[m.kind] = m;
    drain();
  }
};
