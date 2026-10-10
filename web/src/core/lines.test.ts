import { describe, expect, it } from 'vitest';
import { LINE, insideSheath, latticeField, pack, planeSeeds, seedsFor, trace, traceBoth, volumeSeeds, type Vec3 } from './lines';
import { normalizedCoords } from './geometry';

const b = { rMp: () => 10, rBs: () => 14 };
const always = { step: 0.1, maxSteps: 10, inside: () => true };

describe('seeds', () => {
  const inSheath = (p: Vec3) => { const n = normalizedCoords(p, b); return n.d >= LINE.seedDepthMin - 1e-9 && n.d <= LINE.seedDepthMax + 1e-9 && n.thetaDeg < LINE.thetaMax; };
  it('volume: n seeds through the sheath, spread evenly in depth and solid angle, always the same', () => {
    const s = volumeSeeds(2000, b);
    expect(s).toHaveLength(2000);
    expect(s.every(inSheath)).toBe(true);
    const cMax = Math.cos((LINE.thetaMax * Math.PI) / 180);
    const dayside = s.filter((p) => normalizedCoords(p, b).thetaDeg < 60).length / s.length;
    expect(dayside).toBeCloseTo((1 - Math.cos(Math.PI / 3)) / (1 - cMax), 1);
    const deep = s.filter((p) => normalizedCoords(p, b).d < 0.5).length / s.length;
    expect(deep).toBeCloseTo(0.5, 1);
    expect(volumeSeeds(2000, b)).toEqual(s);
  });
  it('plane: about n seeds on the plane, inside the sheath only, always the same', () => {
    for (const [plane, axis] of [['XY', 2], ['XZ', 1], ['YZ', 0]] as const) {
      const s = planeSeeds(150, plane, 3, b);
      expect(s.length).toBeGreaterThan(150 * 0.75);
      expect(s.length).toBeLessThan(150 * 1.25);
      for (const p of s) expect(p[axis]).toBe(3);
      expect(s.every(inSheath)).toBe(true);
      expect(planeSeeds(150, plane, 3, b)).toEqual(s);
    }
  });
  it('plane: no seeds where the plane misses the sheath', () => {
    expect(planeSeeds(150, 'YZ', 25, b)).toEqual([]);
  });
  it('seedsFor picks the mode', () => {
    expect(seedsFor({ mode: 'volume', plane: 'XZ', offset: 0, n: 80 }, b)).toEqual(volumeSeeds(80, b));
    expect(seedsFor({ mode: 'plane', plane: 'YZ', offset: 5, n: 80 }, b)).toEqual(planeSeeds(80, 'YZ', 5, b));
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
