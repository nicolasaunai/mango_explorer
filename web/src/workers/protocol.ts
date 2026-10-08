import type { Manifest, Selection } from '../core/atlas';
import type { FrameName, QuantityName } from '../core/grid';
import type { ProfilePoint, Stat } from '../core/compute';
import type { Plane, PlaneField, PlaneOffsets } from '../core/knnField';
import type { KnnResult } from '../core/knn';

export type StatsRequest =
  | { type: 'init'; id: number; base: string }
  | { type: 'query'; id: number; slot: Slot; frame: FrameName; quantity: QuantityName; stat: Stat; selection: Selection; profileThetaMax: number; useNeff: boolean }
  | { type: 'probe'; id: number; cell: number }
  | { type: 'knn'; id: number; frame: FrameName; quantity: QuantityName; stat: Stat; selection: Selection;
      planes: Plane[]; offsets: PlaneOffsets; k: number; cap: number; useNeff: boolean }
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
  type: 'knn'; id: number; frame: FrameName; quantity: QuantityName; stat: Stat;
  /** slice fields, and every depth shell in the grid cell layout */
  fields: PlaneField[]; shellValues: Float32Array; shellFlags: Uint8Array;
  profile: ProfilePoint[]; range: [number, number]; nSamples: number; ms: number;
  /** k as requested (neighbours in the full dataset) and as searched in the random sample */
  k: number; kSearched: number; fraction: number;
};
export type KnnProbeReply = { type: 'knnProbe'; id: number; cell: number; quantity: QuantityName; result: KnnResult; values: number[];
  k: number; kSearched: number; /** set for full-data voxel means: number of voxels used */ voxels?: number };
export type StatsReply =
  | { type: 'ready'; id: number; manifest: Manifest }
  | KnnReply
  | KnnProbeReply
  | QueryReply
  | ProbeReply
  | { type: 'error'; id: number; message: string };
