import { describe, expect, it } from 'vitest';
import { LINE, fieldSeeds, flowSeeds, insideSheath, latticeField, pack, seeds, trace, traceBoth, type Vec3 } from './lines';
import { normalizedCoords } from './geometry';

const b = { rMp: () => 10, rBs: () => 14 };
const always = { step: 0.1, maxSteps: 10, inside: () => true };

describe('seeds', () => {
  it('n seeds on the shell at depth d, spread evenly in solid angle', () => {
    const s = seeds(400, 0.3, 60, b);
    expect(s).toHaveLength(400);
    for (const p of s) expect(normalizedCoords(p, b).d).toBeCloseTo(0.3, 9);
    const inner = s.filter((p) => normalizedCoords(p, b).thetaDeg < 30).length / s.length;
    expect(inner).toBeCloseTo((1 - Math.cos(Math.PI / 6)) / (1 - Math.cos(Math.PI / 3)), 1);
  });
  it('flow seeds sit just inside the bow shock on the dayside; field seeds on the chosen shell', () => {
    for (const p of flowSeeds(50, b)) {
      const n = normalizedCoords(p, b);
      expect(n.d).toBeCloseTo(LINE.flowDepth, 9);
      expect(n.thetaDeg).toBeLessThan(LINE.flowThetaMax);
    }
    expect(fieldSeeds(50, 0.4, b).every((p) => Math.abs(normalizedCoords(p, b).d - 0.4) < 1e-9)).toBe(true);
  });
});

describe('lattice field', () => {
  it('reproduces a linear field exactly between lattice nodes, evaluating each node once', () => {
    const f = latticeField((p) => [2 * p[0] + 1, -p[1], 3 * p[2] - p[0]], 0.5);
    const v = f([0.37, -1.12, 2.05])!;
    expect(v[0]).toBeCloseTo(2 * 0.37 + 1, 12);
    expect(v[1]).toBeCloseTo(1.12, 12);
    expect(v[2]).toBeCloseTo(3 * 2.05 - 0.37, 12);
    const once = f.evaluations();
    f([0.38, -1.11, 2.06]);
    expect(f.evaluations()).toBe(once);
  });
  it('is missing where any corner is missing', () => {
    const f = latticeField((p) => (p[0] >= 1 ? null : [1, 0, 0]), 0.5);
    expect(f([0.2, 0, 0])).not.toBeNull();
    expect(f([0.9, 0, 0])).toBeNull();
  });
});

describe('tracer', () => {
  it('a uniform field gives a straight line of maxSteps steps', () => {
    const line = trace(() => [3, 0, 0], [0, 0, 0], 1, always);
    expect(line).toHaveLength(11);
    expect(line[10][0]).toBeCloseTo(1.0, 12);
  });
  it('a circular field about X keeps its radius and closes on itself', () => {
    const steps = Math.round((2 * Math.PI * 5) / 0.05);
    const line = trace((p) => [0, -p[2], p[1]], [0, 5, 0], 1, { step: 0.05, maxSteps: steps, inside: () => true });
    for (const p of line) expect(Math.hypot(p[1], p[2])).toBeCloseTo(5, 6);
    const end = line[line.length - 1];
    expect(Math.hypot(end[1] - 5, end[2])).toBeLessThan(0.05);
  });
  it('stops at the edge of the region and where the field is missing', () => {
    const edge = trace(() => [1, 0, 0], [0, 0, 0], 1, { step: 0.1, maxSteps: 100, inside: (p) => p[0] < 0.55 });
    expect(edge[edge.length - 1][0]).toBeLessThan(0.55);
    expect(edge[edge.length - 1][0]).toBeGreaterThan(0.4);
    const hole = trace((p) => (p[0] > 0.3 ? null : [1, 0, 0]), [0, 0, 0], 1, { step: 0.1, maxSteps: 100, inside: () => true });
    expect(hole[hole.length - 1][0]).toBeLessThanOrEqual(0.3 + 1e-9);
  });
  it('stays finite around a stagnation point', () => {
    const line = trace((p) => [-p[0], -p[1], -p[2]], [0.3, 0.2, 0], 1, { step: 0.1, maxSteps: 200, inside: () => true });
    expect(line.length).toBeLessThanOrEqual(201);
    expect(line.flat().every(Number.isFinite)).toBe(true);
  });
  it('traces both ways from the seed, in one line', () => {
    const line = traceBoth(() => [1, 0, 0], [0, 0, 0], { step: 0.1, maxSteps: 5, inside: () => true });
    expect(line).toHaveLength(11);
    expect(line[0][0]).toBeCloseTo(-0.5, 12);
    expect(line[10][0]).toBeCloseTo(0.5, 12);
  });
  it('insideSheath accepts the sheath only', () => {
    const inside = insideSheath(b);
    expect(inside([12, 0, 0])).toBe(true);
    expect(inside([9, 0, 0])).toBe(false);
    expect(inside([15, 0, 0])).toBe(false);
  });
});

describe('pack', () => {
  it('packs lines into one buffer and drops lines without a segment', () => {
    const p = pack([[[0, 0, 0], [1, 0, 0]], [[5, 5, 5]], [[0, 1, 0], [0, 2, 0], [0, 3, 0]]] as Vec3[][]);
    expect(Array.from(p.offsets)).toEqual([0, 2, 5]);
    expect(p.points).toHaveLength(15);
    expect(Array.from(p.points.slice(6, 9))).toEqual([0, 1, 0]);
  });
});
