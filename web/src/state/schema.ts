// Everything a view depends on, serialized in the URL hash so a link reproduces the view.
import { z } from 'zod';
import { grid, type QuantityName } from '../core/grid';
import { LUT_NAMES, type LutName } from '../render/lut';

const bins = (n: number) => z.array(z.number().int().min(0).max(n - 1)).min(1);
const range = (n: number) => Array.from({ length: n }, (_, i) => i);
export const N_CLOCK = grid.conditionEdges('clock_deg').length - 1;
export const N_CONE = grid.conditionEdges('cone_deg').length - 1;
export const N_MA = grid.conditionEdges('Ma_sw').length - 1;

export const VIEWS = ['iso', 'sun', 'dusk', 'north', 'tail'] as const;
export const STATS = ['median', 'q25', 'q75', 'iqr_rel', 'n', 'neff'] as const;
export const PLANES = ['XY', 'XZ', 'YZ'] as const;
export const LAYERS = ['mp', 'bs', 'tint', 'shells', 'slice'] as const;

export const ViewState = z.object({
  frame: z.enum(['GSM', 'PGSM', 'PGSM_fold']),
  clock: bins(N_CLOCK),
  cone: bins(N_CONE),
  ma: bins(N_MA),
  quantity: z.enum(grid.quantityNames as [QuantityName, ...QuantityName[]]),
  stat: z.enum(STATS),
  plane: z.enum(PLANES),
  view: z.enum(VIEWS),
  layers: z.array(z.enum(LAYERS)),
  lut: z.enum(LUT_NAMES as [LutName, ...LutName[]]),
  shell: z.number().int().min(0).max(grid.spatialShape[0] - 1),
  probe: z.number().int().min(-1).max(grid.nCells - 1),
  range: z.tuple([z.number(), z.number()]).nullable(),
  pinA: z.object({ clock: bins(N_CLOCK), cone: bins(N_CONE), ma: bins(N_MA) }).nullable(),
  cmp: z.enum(['A', 'B', 'diff']),
});
export type ViewState = z.infer<typeof ViewState>;

/** Landing view chosen by the physics panel: Parker-spiral IMF, folded PGSM, density compression. */
export const DEFAULT_STATE: ViewState = {
  frame: 'PGSM_fold',
  clock: range(N_CLOCK),
  cone: [2, 3],
  ma: [2, 3],
  quantity: 'Np_ratio',
  stat: 'median',
  plane: 'XZ',
  view: 'iso',
  layers: ['mp', 'bs', 'tint', 'slice'],
  lut: 'batlow',
  shell: 5,
  probe: -1,
  range: null,
  pinA: null,
  cmp: 'B',
};

export const PRESETS: { id: string; label: string; hint: string; state: Partial<ViewState> }[] = [
  { id: 'parker', label: 'Parker spiral', hint: 'cone 30–60°, M_A 6–12', state: { clock: range(N_CLOCK), cone: [2, 3], ma: [2, 3] } },
  { id: 'north', label: 'Northward', hint: 'clock 330–30°, cone ≥ 60°, M_A < 8', state: { clock: [11, 0], cone: [4, 5], ma: [0, 1, 2] } },
  { id: 'south', label: 'Southward', hint: 'clock 150–210°, cone ≥ 45°', state: { clock: [5, 6], cone: [3, 4, 5], ma: range(N_MA) } },
  { id: 'radial', label: 'Radial IMF', hint: 'cone < 30°', state: { clock: range(N_CLOCK), cone: [0, 1], ma: range(N_MA) } },
  { id: 'lowmach', label: 'Low Mach', hint: 'M_A < 4', state: { clock: range(N_CLOCK), cone: range(N_CONE), ma: [0] } },
];

const list = (a: number[]) => a.join('.');
const unlist = (s: string | null) => (s ? s.split('.').filter(Boolean).map(Number) : undefined);

export function encodeHash(s: ViewState): string {
  const p = new URLSearchParams({
    f: s.frame, clk: list(s.clock), cone: list(s.cone), ma: list(s.ma),
    q: s.quantity, st: s.stat, pl: s.plane, v: s.view, ly: s.layers.join('.'),
    cm: s.lut, sh: String(s.shell),
  });
  if (s.probe >= 0) p.set('pr', String(s.probe));
  if (s.range) p.set('cr', s.range.map((x) => +x.toPrecision(5)).join('~'));
  if (s.pinA) { p.set('pa', [s.pinA.clock, s.pinA.cone, s.pinA.ma].map(list).join('~')); p.set('cmp', s.cmp); }
  return '#' + p.toString();
}

/** Parse a hash; anything missing or invalid falls back to the default for that field. */
export function decodeHash(hash: string): ViewState {
  const p = new URLSearchParams(hash.replace(/^#/, ''));
  const candidate = {
    frame: p.get('f') ?? undefined, clock: unlist(p.get('clk')), cone: unlist(p.get('cone')),
    ma: unlist(p.get('ma')), quantity: p.get('q') ?? undefined, stat: p.get('st') ?? undefined,
    plane: p.get('pl') ?? undefined, view: p.get('v') ?? undefined,
    layers: p.has('ly') ? (p.get('ly') || '').split('.').filter(Boolean) : undefined,
    lut: p.get('cm') ?? undefined,
    shell: p.has('sh') ? Number(p.get('sh')) : undefined,
    probe: p.has('pr') ? Number(p.get('pr')) : undefined,
    range: p.has('cr') ? p.get('cr')!.split('~').map(Number) : undefined,
    pinA: p.has('pa') ? (([clock, cone, ma]) => ({ clock: unlist(clock), cone: unlist(cone), ma: unlist(ma) }))(p.get('pa')!.split('~')) : undefined,
    cmp: p.get('cmp') ?? undefined,
  };
  const out = { ...DEFAULT_STATE } as Record<string, unknown>;
  for (const [k, v] of Object.entries(candidate)) {
    if (v === undefined) continue;
    const r = ViewState.shape[k as keyof ViewState].safeParse(v);
    if (r.success) out[k] = r.data;
  }
  return out as ViewState;
}

/** True when every selected cone bin is below 30°, where the clock angle is ill-defined. */
export const clockUndefined = (cone: number[]) => cone.every((b) => grid.conditionEdges('cone_deg')[b + 1] <= 30);
