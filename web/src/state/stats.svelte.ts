// Client side of the stats and lines workers. Only the latest query's answer is kept.
import type { KnnProbeReply, KnnReply, LineKind, LinesReply, LinesRequest, LinesWorkerReply, ProbeReply, QueryReply, Slot,
  StatsReply, StatsRequest } from '../workers/protocol';
import type { ShellGrid } from '../core/shell';
import type { Plane, PlaneOffsets } from '../core/knnField';
import type { Selection } from '../core/atlas';
import type { FrameName, QuantityName } from '../core/grid';
import type { Stat } from '../core/compute';

export const PROFILE_THETA_MAX = 30;

export const stats = $state<{
  pending: boolean; error: string; result: QueryReply | null; resultA: QueryReply | null; probe: ProbeReply | null;
  knn: KnnReply | null; knnProbe: KnnProbeReply | null;
  /** k-NN mode: the shell at depth `d` on the fine (theta, phi) grid */
  knnShell: { d: number; shell: ShellGrid } | null;
  lines: { flow: LinesReply | null; field: LinesReply | null }; linesError: string;
  /** a newer set of lines of that kind is on its way (the shown one is stale) */
  linesPending: { flow: boolean; field: boolean };
}>({ pending: false, error: '', result: null, resultA: null, probe: null, knn: null, knnProbe: null, knnShell: null,
  lines: { flow: null, field: null }, linesError: '', linesPending: { flow: false, field: false } });

let worker: Worker | null = null;
/** Lines are traced in a worker of their own: a cold request takes seconds and must not hold the maps. */
let linesWorker: Worker | null = null;
let nextId = 1;
const latestQuery: Record<Slot, number> = { A: 0, B: 0 };
let latestProbe = 0;

type WithoutId<T> = T extends unknown ? Omit<T, 'id'> : never;

/** Request/reply over a worker: each request gets a fresh id and resolves with the reply carrying it. */
function channel<Req, Rep extends { id: number }>(w: Worker) {
  const waiters = new Map<number, (r: Rep) => void>();
  w.onmessage = (e: MessageEvent<Rep>) => {
    const f = waiters.get(e.data.id);
    waiters.delete(e.data.id);
    f?.(e.data);
  };
  return (msg: WithoutId<Req>): Promise<Rep> => {
    const id = nextId++;
    return new Promise((resolve) => {
      waiters.set(id, resolve);
      w.postMessage({ ...msg, id });
    });
  };
}
let send: (msg: WithoutId<StatsRequest>) => Promise<StatsReply>;
let sendLines: (msg: WithoutId<Extract<LinesRequest, { id: number }>>) => Promise<LinesWorkerReply>;

export async function startWorker(base: string) {
  worker = new Worker(new URL('../workers/stats.worker.ts', import.meta.url), { type: 'module' });
  linesWorker = new Worker(new URL('../workers/lines.worker.ts', import.meta.url), { type: 'module' });
  send = channel<StatsRequest, StatsReply>(worker);
  sendLines = channel<Extract<LinesRequest, { id: number }>, LinesWorkerReply>(linesWorker);
  const [r, rl] = await Promise.all([send({ type: 'init', base }), sendLines({ type: 'init', base })]);
  if (r.type === 'error') throw new Error(r.message);
  if (rl.type === 'error') throw new Error(rl.message);
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
/** Depth of the newest shell asked for: an older answer (full k-NN or shell alone) must not replace it. */
let shellWanted = NaN;

/** k-NN statistics; debounced because each request searches every displayed node. */
export function runKnn(frame: FrameName, quantity: QuantityName, stat: Stat, selection: Selection,
  planes: Plane[], offsets: PlaneOffsets, k: number, cap: number, useNeff: boolean, shellD: number) {
  if (!worker) return;
  const snap = $state.snapshot(selection);
  stats.pending = true;
  clearTimeout(knnTimer);
  knnTimer = setTimeout(async () => {
    const id = (latestKnn = nextId);
    shellWanted = shellD;
    const r = await send({ type: 'knn', frame, quantity, stat, selection: snap, planes: [...planes], offsets: { ...offsets }, k, cap, useNeff, shellD });
    if (id !== latestKnn) return;
    stats.pending = false;
    if (r.type === 'knn') {
      stats.knn = r; stats.error = '';
      if (r.shellD === shellWanted) stats.knnShell = { d: r.shellD, shell: r.shell };
    } else if (r.type === 'error') stats.error = r.message;
  }, 180);
}

let latestShell = 0;
let shellTimer: ReturnType<typeof setTimeout> | undefined;

/** Only the depth moved: evaluate the shell alone with the samples of the current k-NN query. */
export function runKnnShell(frame: FrameName, quantity: QuantityName, stat: Stat, selection: Selection,
  k: number, cap: number, useNeff: boolean, shellD: number) {
  if (!worker) return;
  const snap = $state.snapshot(selection);
  shellWanted = shellD;
  clearTimeout(shellTimer);
  shellTimer = setTimeout(async () => {
    const id = (latestShell = nextId);
    const r = await send({ type: 'knnShell', frame, quantity, stat, selection: snap, k, cap, useNeff, shellD });
    if (id !== latestShell) return;
    if (r.type === 'knnShell' && r.shellD === shellWanted) stats.knnShell = { d: r.shellD, shell: r.shell };
    else if (r.type === 'error') stats.error = r.message;
  }, 60);
}

const latestLines: Record<LineKind, number> = { flow: 0, field: 0 };
const linesTimer: Partial<Record<LineKind, ReturnType<typeof setTimeout>>> = {};

/** Flow or field lines for the current parameters; debounced, the latest request per kind wins. A missing
 * vector atlas only affects the lines (linesError), not the maps. */
export function runLines(kind: LineKind, frame: FrameName, selection: Selection, k: number, cap: number,
  density: number, depth: number) {
  if (!linesWorker) return;
  const snap = $state.snapshot(selection);
  stats.linesPending[kind] = true;
  clearTimeout(linesTimer[kind]);
  linesTimer[kind] = setTimeout(async () => {
    const id = (latestLines[kind] = nextId);
    const r = await sendLines({ type: 'lines', kind, frame, selection: snap, k, cap, density, depth });
    if (id !== latestLines[kind] || r.type === 'superseded') return;
    stats.linesPending[kind] = false;
    if (r.type === 'lines') { stats.lines[kind] = r; stats.linesError = ''; }
    else if (r.type === 'error') stats.linesError = r.message;
  }, 180);
}

/** The layer was turned off: forget the scheduled request, the pending one and any answer on its way. */
export function cancelLines(kind: LineKind) {
  clearTimeout(linesTimer[kind]);
  latestLines[kind] = 0;
  stats.linesPending[kind] = false;
  linesWorker?.postMessage({ type: 'cancel', kind } satisfies LinesRequest);
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
