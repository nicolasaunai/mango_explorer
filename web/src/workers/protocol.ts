import type { Manifest, Selection } from '../core/atlas';
import type { FrameName, QuantityName } from '../core/grid';
import type { ProfilePoint, Stat } from '../core/compute';

export type StatsRequest =
  | { type: 'init'; id: number; base: string }
  | { type: 'query'; id: number; slot: Slot; frame: FrameName; quantity: QuantityName; stat: Stat; selection: Selection; profileThetaMax: number }
  | { type: 'probe'; id: number; cell: number };

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
export type StatsReply =
  | { type: 'ready'; id: number; manifest: Manifest }
  | QueryReply
  | ProbeReply
  | { type: 'error'; id: number; message: string };
