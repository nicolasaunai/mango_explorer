// Client side of the stats worker. Only the latest query's answer is kept.
import type { KnnProbeReply, KnnReply, ProbeReply, QueryReply, Slot, StatsReply, StatsRequest } from '../workers/protocol';
import type { Plane, PlaneOffsets } from '../core/knnField';
import type { Selection } from '../core/atlas';
import type { FrameName, QuantityName } from '../core/grid';
import type { Stat } from '../core/compute';

export const PROFILE_THETA_MAX = 30;

export const stats = $state<{
  pending: boolean; error: string; result: QueryReply | null; resultA: QueryReply | null; probe: ProbeReply | null;
  knn: KnnReply | null; knnProbe: KnnProbeReply | null;
}>({ pending: false, error: '', result: null, resultA: null, probe: null, knn: null, knnProbe: null });

let worker: Worker | null = null;
let nextId = 1;
const latestQuery: Record<Slot, number> = { A: 0, B: 0 };
let latestProbe = 0;
const waiters = new Map<number, (r: StatsReply) => void>();

type WithoutId<T> = T extends unknown ? Omit<T, 'id'> : never;

function send(msg: WithoutId<StatsRequest>): Promise<StatsReply> {
  const id = nextId++;
  return new Promise((resolve) => {
    waiters.set(id, resolve);
    worker!.postMessage({ ...msg, id });
  });
}

export async function startWorker(base: string) {
  worker = new Worker(new URL('../workers/stats.worker.ts', import.meta.url), { type: 'module' });
  worker.onmessage = (e: MessageEvent<StatsReply>) => {
    const w = waiters.get(e.data.id);
    waiters.delete(e.data.id);
    w?.(e.data);
  };
  const r = await send({ type: 'init', base });
  if (r.type === 'error') throw new Error(r.message);
}

/** Statistics for the current conditions (slot B) or the pinned comparison set (slot A). */
export async function runQuery(frame: FrameName, quantity: QuantityName, stat: Stat, selection: Selection, useNeff: boolean, slot: Slot = 'B') {
  if (!worker) return;
  const id = (latestQuery[slot] = nextId);
  if (slot === 'B') stats.pending = true;
  const r = await send({ type: 'query', slot, frame, quantity, stat, selection: $state.snapshot(selection), profileThetaMax: PROFILE_THETA_MAX, useNeff });
  if (id !== latestQuery[slot]) return; // superseded by a newer request
  if (slot === 'B') stats.pending = false;
  if (r.type === 'query') {
    if (slot === 'B') stats.result = r; else stats.resultA = r;
    stats.error = '';
  } else if (r.type === 'error') stats.error = r.message;
  if (slot === 'B' && stats.probe) probe(stats.probe.cell);
}

let latestKnn = 0;
let knnTimer: ReturnType<typeof setTimeout> | undefined;

/** k-NN statistics; debounced because each request searches every displayed node. */
export function runKnn(frame: FrameName, quantity: QuantityName, stat: Stat, selection: Selection,
  planes: Plane[], offsets: PlaneOffsets, shell: number, k: number, cap: number, useNeff: boolean) {
  if (!worker) return;
  const snap = $state.snapshot(selection);
  stats.pending = true;
  clearTimeout(knnTimer);
  knnTimer = setTimeout(async () => {
    const id = (latestKnn = nextId);
    const r = await send({ type: 'knn', frame, quantity, stat, selection: snap, planes: [...planes], offsets: { ...offsets }, shell, k, cap, useNeff });
    if (id !== latestKnn) return;
    stats.pending = false;
    if (r.type === 'knn') { stats.knn = r; stats.error = ''; }
    else if (r.type === 'error') stats.error = r.message;
  }, 180);
}

let latestKnnProbe = 0;
export async function probeKnn(point: [number, number, number] | null, cell: number) {
  if (!worker || !point) { stats.knnProbe = null; return; }
  const id = (latestKnnProbe = nextId);
  const r = await send({ type: 'knnProbe', point, cell });
  if (id === latestKnnProbe && r.type === 'knnProbe') stats.knnProbe = r;
}

export async function probe(cell: number | null) {
  if (!worker || cell === null) { stats.probe = null; return; }
  const id = (latestProbe = nextId);
  const r = await send({ type: 'probe', cell });
  if (id === latestProbe && r.type === 'probe') stats.probe = r;
}
