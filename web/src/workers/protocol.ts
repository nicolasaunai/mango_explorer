import type { Manifest, Selection } from '../core/atlas';
import type { FrameName, QuantityName } from '../core/grid';
import type { ProfilePoint, Stat } from '../core/compute';
import type { Plane } from '../core/knnField';
import type { KnnResult } from '../core/knn';

export type StatsRequest =
  | { type: 'init'; id: number; base: string }
  | { type: 'query'; id: number; slot: Slot; frame: FrameName; quantity: QuantityName; stat: Stat; selection: Selection; profileThetaMax: number; useNeff: boolean }
  | { type: 'probe'; id: number; cell: number }
  | { type: 'knn'; id: number; frame: FrameName; quantity: QuantityName; stat: Stat; selection: Selection;
      plane: Plane; shell: number; k: number; cap: number; useNeff: boolean }
  | { type: 'knnProbe'; id: number; point: [number, number, number]; cell: number };

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
  type: 'knn'; id: number; frame: FrameName; quantity: QuantityName; stat: Stat; plane: Plane; shell: number;
  field: Float32Array; fieldFlags: Uint8Array; shellValues: Float32Array; shellFlags: Uint8Array;
  profile: ProfilePoint[]; range: [number, number]; nSamples: number; ms: number;
};
export type KnnProbeReply = { type: 'knnProbe'; id: number; cell: number; quantity: QuantityName; result: KnnResult; values: number[] };
export type StatsReply =
  | { type: 'ready'; id: number; manifest: Manifest }
  | KnnReply
  | KnnProbeReply
  | QueryReply
  | ProbeReply
  | { type: 'error'; id: number; message: string };
