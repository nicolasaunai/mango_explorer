import { describe, expect, it } from 'vitest';
import { SHELL_GRID, binShell, depthBin, shellCellAt, shellField } from './shell';
import { normalizedCoords } from './geometry';
import { FLAG } from './compute';
import { grid } from './grid';

const b = { rMp: () => 10, rBs: () => 14 };
const [nd, nt, nphi] = grid.spatialShape;

describe('depth shell', () => {
  it('depth bin of a continuous D, with D = 1 in the last bin', () => {
    expect(depthBin(0)).toBe(0);
    expect(depthBin(0.35)).toBe(3);
    expect(depthBin(0.999)).toBe(nd - 1);
    expect(depthBin(1)).toBe(nd - 1);
  });

  it('evaluates nodes on the surface of constant D, theta rows by phi columns', () => {
    const seen: [number, number, number][] = [];
    const s = shellField((p) => { seen.push(p); return { v: p[2], flag: FLAG.OK }; }, 0.35, b);
    expect(s.nTheta).toBe(SHELL_GRID.nTheta);
    expect(s.nPhi).toBe(SHELL_GRID.nPhi);
    expect(s.values).toHaveLength(SHELL_GRID.nTheta * SHELL_GRID.nPhi);
    for (const p of seen) expect(normalizedCoords(p, b).d).toBeCloseTo(0.35, 9);
    // node (j, k) sits at the centre of its theta and phi steps
    const j = 7, k = 20, at = j * s.nPhi + k;
    const n = normalizedCoords(seen[at], b);
    expect(n.thetaDeg).toBeCloseTo((j + 0.5) * (SHELL_GRID.thetaMax / s.nTheta), 9);
    expect(n.phiDeg).toBeCloseTo((k + 0.5) * (360 / s.nPhi), 9);
    expect(s.values[at]).toBeCloseTo(seen[at][2], 5);
    expect(s.flags[at]).toBe(FLAG.OK);
  });

  it('bins: the shell is the depth bin that holds D, in the cell layout', () => {
    const values = Float32Array.from({ length: grid.nCells }, (_, c) => c);
    const flags = new Uint8Array(grid.nCells).fill(FLAG.OK);
    const s = binShell(values, flags, 0.35);
    expect([s.nTheta, s.nPhi]).toEqual([nt, nphi]);
    expect(s.values[0]).toBe(3 * nt * nphi);
    expect(s.values[nt * nphi - 1]).toBe(4 * nt * nphi - 1);
  });

  it('a (theta, phi) on the shell maps to the grid cell at that depth', () => {
    expect(shellCellAt(0.35, 3, 7)).toBe((3 * nt + 0) * nphi + 0);
    expect(shellCellAt(1, 119, 359)).toBe(grid.nCells - 1);
    expect(shellCellAt(0.5, 130, 10)).toBeNull();
  });
});
