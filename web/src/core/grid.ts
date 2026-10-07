// The binning contract shared with the Python pipeline (src/mango_explorer/spec/grid-v2.json).
import spec from '$spec/grid-v2.json';

type EdgeSpec = { edges?: number[]; edges_range?: number[] };
export type QuantityName = keyof typeof spec.quantities;
export type ConditionName = keyof typeof spec.conditions;
export type FrameName = keyof typeof spec.frames;

/** Same values as numpy: explicit edges, or arange(lo, hi + step/2, step). */
export function edgesOf(s: EdgeSpec): number[] {
  if (s.edges) return s.edges;
  const [lo, hi, step] = s.edges_range!;
  const out: number[] = [];
  for (let i = 0; lo + i * step <= hi + step / 2; i++) out.push(lo + i * step);
  return out;
}

export class Grid {
  readonly raw = spec;
  readonly dEdges = edgesOf(spec.spatial.D_msh);
  readonly dClip = spec.spatial.D_msh.clip as [number, number];
  readonly thetaEdges = edgesOf(spec.spatial.theta_deg);
  readonly phiEdges = edgesOf(spec.spatial.phi_deg);
  readonly spatialShape: [number, number, number] = [
    this.dEdges.length - 1, this.thetaEdges.length - 1, this.phiEdges.length - 1,
  ];
  readonly nCells = this.spatialShape[0] * this.spatialShape[1] * this.spatialShape[2];
  readonly nHist = spec.histogram.n_bins;
  readonly quantityNames = Object.keys(spec.quantities) as QuantityName[];
  readonly conditionNames = Object.keys(spec.conditions) as ConditionName[];
  readonly frames = Object.keys(spec.frames) as FrameName[];
  readonly spacecraft = spec.spacecraft;
  readonly reliability = spec.reliability;

  conditionEdges(name: ConditionName): number[] {
    return edgesOf(spec.conditions[name] as EdgeSpec);
  }
  conditionIsPeriodic(name: ConditionName): boolean {
    return Boolean((spec.conditions[name] as { periodic?: boolean }).periodic);
  }
  cubeDims(id: string): ConditionName[] {
    const c = spec.cubes.find((c) => c.id === id);
    if (!c) throw new Error(`unknown cube ${id}`);
    return c.dims as ConditionName[];
  }
  cubeShape(id: string): number[] {
    return this.cubeDims(id).map((d) => this.conditionEdges(d).length - 1);
  }
  isLog(q: QuantityName): boolean {
    return spec.quantities[q].scale === 'log';
  }
  /** Histogram edges in axis space (log10 of the value for log quantities). */
  histAxisRange(q: QuantityName): [number, number] {
    const [lo, hi] = spec.quantities[q].range;
    return this.isLog(q) ? [Math.log10(lo), Math.log10(hi)] : [lo, hi];
  }
  histAxisEdges(q: QuantityName): number[] {
    const [lo, hi] = this.histAxisRange(q);
    return Array.from({ length: this.nHist + 1 }, (_, i) =>
      i === this.nHist ? hi : lo + ((hi - lo) * i) / this.nHist);
  }
}

export const grid = new Grid();
