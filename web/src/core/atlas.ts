// Reader for the static atlas written by src/mango_explorer/atlas/store.py.
import { grid as defaultGrid, type ConditionName, type FrameName, type Grid, type QuantityName } from './grid';

type Section = { name: string; dtype: string; length: number; offset: number };
type FileEntry = { path: string; sections: Section[] };
export type CubeEntry = {
  id: string; frame: FrameName; dims: ConditionName[]; shape: number[];
  quantities: Record<string, FileEntry>; counts: FileEntry;
  spacecraft?: FileEntry & { names: string[] };
};
export type Manifest = {
  format: string; grid: string; created: string;
  stats: Record<string, number>;
  source: { kind?: string; dataset_version?: string; citation?: string; [k: string]: unknown };
  encoding?: 'gzip';
  hours: FileEntry & { n_rows: number };
  cubes: CubeEntry[];
  samples?: { cube: string; fraction: number; n: number; base: FileEntry; quantities: Record<string, FileEntry> };
};
export type Selection = Partial<Record<ConditionName, number[] | null>>;
export type FetchBytes = (path: string) => Promise<ArrayBuffer>;

const CTORS = {
  uint32: Uint32Array, int32: Int32Array, uint16: Uint16Array, uint8: Uint8Array, float32: Float32Array,
} as const;
type Typed = InstanceType<(typeof CTORS)[keyof typeof CTORS]>;

function sections(buf: ArrayBuffer, meta: Section[]): Record<string, Typed> {
  const out: Record<string, Typed> = {};
  for (const s of meta) {
    const C = CTORS[s.dtype as keyof typeof CTORS];
    if (!C) throw new Error(`unsupported dtype ${s.dtype}`);
    out[s.name] = new C(buf, s.offset, s.length);
  }
  return out;
}

export async function loadSections(fetchBytes: FetchBytes, f: FileEntry) {
  return sections(await fetchBytes(f.path), f.sections);
}

/** Row-major flat condition indices of a per-dimension selection (missing/null = all bins). */
export function selectedConditions(dims: ConditionName[], shape: number[], sel: Selection): number[] {
  let flat = [0];
  dims.forEach((d, k) => {
    const n = shape[k];
    const bins = sel[d] ?? Array.from({ length: n }, (_, i) => i);
    const uniq = [...new Set(bins)].sort((a, b) => a - b);
    flat = flat.flatMap((f) => uniq.map((b) => f * n + b));
  });
  return flat;
}

export type QueryResult = { hist: Uint32Array; n: Uint32Array; neffUpper: Uint32Array };

/** One cube (one frame) with its count tables; quantity histograms load on demand. */
export class CubeView {
  private hist = new Map<string, Record<string, Typed>>();
  private constructor(
    readonly entry: CubeEntry,
    private counts: Record<string, Typed>,
    private fetchBytes: FetchBytes,
    readonly grid: Grid,
  ) {}

  static async load(entry: CubeEntry, fetchBytes: FetchBytes, grid: Grid = defaultGrid) {
    return new CubeView(entry, await loadSections(fetchBytes, entry.counts), fetchBytes, grid);
  }

  async ensure(q: QuantityName) {
    if (!this.hist.has(q)) this.hist.set(q, await loadSections(this.fetchBytes, this.entry.quantities[q]));
    return this.hist.get(q)!;
  }

  private sumCounts(offsets: Typed, cell: Typed, values: Typed, conds: number[]): Uint32Array {
    const out = new Uint32Array(this.grid.nCells);
    for (const c of conds) for (let i = offsets[c]; i < offsets[c + 1]; i++) out[cell[i]] += values[i];
    return out;
  }

  private sc: Record<string, Typed> | null = null;

  /** Samples per spacecraft in one cell for the selected condition bins (names in entry.spacecraft). */
  async spacecraftCounts(cell: number, sel: Selection): Promise<number[]> {
    const f = this.entry.spacecraft;
    if (!f) return [];
    this.sc ??= await loadSections(this.fetchBytes, f);
    const { cond_offsets, cell: cells, sc, n } = this.sc;
    const out = new Array(f.names.length).fill(0);
    for (const c of selectedConditions(this.entry.dims, this.entry.shape, sel))
      for (let i = cond_offsets[c]; i < cond_offsets[c + 1]; i++) if (cells[i] === cell) out[sc[i]] += n[i];
    return out;
  }

  /** Sum of the selected condition bins: per-cell histograms (nCells × nHist), N and N_eff upper bound. */
  async query(q: QuantityName, sel: Selection): Promise<QueryResult> {
    const conds = selectedConditions(this.entry.dims, this.entry.shape, sel);
    const s = await this.ensure(q);
    const nb = this.grid.nHist;
    const hist = new Uint32Array(this.grid.nCells * nb);
    const { cond_offsets, cell, hbin, count } = s;
    for (const c of conds) for (let i = cond_offsets[c]; i < cond_offsets[c + 1]; i++) hist[cell[i] * nb + hbin[i]] += count[i];
    const k = this.counts;
    return {
      hist,
      n: this.sumCounts(k.n_cond_offsets, k.n_cell, k.n, conds),
      neffUpper: this.sumCounts(k.neff_cond_offsets, k.neff_cell, k.neff, conds),
    };
  }
}

/** The k-NN sample table: rows grouped by condition bin of one cube; values in axis space. */
export class SampleTable {
  private values = new Map<string, Float32Array>();
  private constructor(readonly manifest: Manifest, readonly base: Record<string, Typed>, private fetchBytes: FetchBytes) {}

  static async load(manifest: Manifest, fetchBytes: FetchBytes) {
    if (!manifest.samples) throw new Error('this atlas has no sample table (rebuild it to use k-NN)');
    return new SampleTable(manifest, await loadSections(fetchBytes, manifest.samples.base), fetchBytes);
  }

  async quantity(q: QuantityName): Promise<Float32Array> {
    if (!this.values.has(q))
      this.values.set(q, (await loadSections(this.fetchBytes, this.manifest.samples!.quantities[q])).value as Float32Array);
    return this.values.get(q)!;
  }

  /** Row indices of the samples in the selected condition bins. */
  rows(sel: Selection): Int32Array {
    const cube = this.manifest.cubes.find((c) => c.id === this.manifest.samples!.cube)!;
    const off = this.base.cond_offsets;
    const conds = selectedConditions(cube.dims, cube.shape, sel);
    let n = 0;
    for (const c of conds) n += off[c + 1] - off[c];
    const out = new Int32Array(n);
    let j = 0;
    for (const c of conds) for (let i = off[c]; i < off[c + 1]; i++) out[j++] = i;
    return out;
  }
}

export async function loadManifest(fetchBytes: FetchBytes): Promise<Manifest> {
  const text = new TextDecoder().decode(await fetchBytes('manifest.json'));
  return JSON.parse(text) as Manifest;
}

/** Gunzip bytes that start with the gzip magic number; return anything else unchanged
 * (a host may already have decompressed a .gz file while serving it). */
export async function maybeGunzip(buf: ArrayBuffer): Promise<ArrayBuffer> {
  const head = new Uint8Array(buf, 0, Math.min(2, buf.byteLength));
  if (head[0] !== 0x1f || head[1] !== 0x8b) return buf;
  const stream = new Blob([buf]).stream().pipeThrough(new DecompressionStream('gzip'));
  return new Response(stream).arrayBuffer();
}

export const httpFetcher = (base: string): FetchBytes => async (path) => {
  const r = await fetch(new URL(path, base));
  if (!r.ok) throw new Error(`could not load ${path}: HTTP ${r.status}`);
  const buf = await r.arrayBuffer();
  return path.endsWith('.gz') ? maybeGunzip(buf) : buf;
};
