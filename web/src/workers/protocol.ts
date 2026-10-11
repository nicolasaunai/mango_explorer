import type { Manifest, Selection } from '../core/atlas';
import type { FrameName, QuantityName } from '../core/grid';
import type { ProfilePoint, Stat } from '../core/compute';
import type { Plane, PlaneField, PlaneOffsets } from '../core/knnField';
import type { KnnResult } from '../core/knn';
import type { ShellGrid } from '../core/shell';
import type { Seeding } from '../core/lines';

export type LineKind = 'flow' | 'field';

export type StatsRequest =
  | { type: 'init'; id: number; base: string }
  | { type: 'query'; id: number; slot: Slot; frame: FrameName; quantity: QuantityName; stat: Stat; selection: Selection; profileThetaMax: number; useNeff: boolean }
  | { type: 'probe'; id: number; cell: number }
  | { type: 'knn'; id: number; frame: FrameName; quantity: QuantityName; stat: Stat; selection: Selection;
      planes: Plane[]; offsets: PlaneOffsets; k: number; cap: number; useNeff: boolean; shellD: number; rotationDeg: number }
  | { type: 'knnShell'; id: number; frame: FrameName; quantity: QuantityName; stat: Stat; selection: Selection;
      k: number; cap: number; useNeff: boolean; shellD: number }
  | { type: 'knnProbe'; id: number; point: [number, number, number]; cell: number };

/** The lines worker: init, then line requests (only the newest pending one per kind is traced); `cancel`
 * drops the pending request of a kind (no reply of its own). */
export type LinesRequest =
  | { type: 'init'; id: number; base: string }
  | { type: 'lines'; id: number; kind: LineKind; frame: FrameName; selection: Selection; k: number; cap: number;
      seeding: Seeding }
  | { type: 'cancel'; kind: LineKind };

export type Slot = 'A' | 'B';
export type QueryReply = {
  type: 'query'; id: number; slot: Slot; frame: FrameName; quantity: QuantityName; stat: Stat;
  values: Float32Array; flags: Uint8Array; n: Uint32Array; neffUpper: Uint32Array; spread: Float32Array;
  range: [number, number]; profile: ProfilePoint[]; ms: number;
};
export type ProbeReply = {
  type: 'probe'; id: number; cell: number; quantity: QuantityName;
  hist: Uint32Array; n: number; neffUpper: number; q25: number; q50: number; q75: number;
  spacecraft: { name: string; n: number }[];
};
export type KnnReply = {
  type: 'knn'; id: number; frame: FrameName; quantity: QuantityName; stat: Stat;
  /** slice fields, and every depth shell in the grid cell layout */
  fields: PlaneField[]; shellValues: Float32Array; shellFlags: Uint8Array;
  /** the shell at depth shellD on the fine (theta, phi) grid */
  shell: ShellGrid; shellD: number;
  profile: ProfilePoint[]; range: [number, number]; nSamples: number; ms: number;
  /** k as requested (neighbours in the full dataset) and as searched in the random sample */
  k: number; kSearched: number; fraction: number;
};
export type KnnProbeReply = { type: 'knnProbe'; id: number; cell: number; quantity: QuantityName; result: KnnResult; values: number[];
  k: number; kSearched: number; /** set for full-data voxel means: number of voxels used */ voxels?: number };
export type KnnShellReply = { type: 'knnShell'; id: number; shell: ShellGrid; shellD: number; ms: number };
/** `seeds`: the seed positions in plane mode (x, y, z interleaved), empty in volume mode. */
export type LinesReply = { type: 'lines'; id: number; kind: LineKind; points: Float32Array; offsets: Uint32Array; seeds: Float32Array; ms: number };
/** `superseded`: a newer request of the same kind (or a cancel) replaced it before it was traced. */
export type LinesWorkerReply =
  | { type: 'ready'; id: number }
  | LinesReply
  | { type: 'superseded'; id: number }
  | { type: 'error'; id: number; message: string };
export type StatsReply =
  | { type: 'ready'; id: number; manifest: Manifest }
  | KnnShellReply
  | KnnReply
  | KnnProbeReply
  | QueryReply
  | ProbeReply
  | { type: 'error'; id: number; message: string };
