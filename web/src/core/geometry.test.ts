import { describe, expect, it } from 'vitest';
import { cellAt, cellBounds, cellCenter, normalizedCoords } from './geometry';
import { grid } from './grid';

const b = { rMp: () => 10, rBs: () => 14 };

describe('cell geometry', () => {
  it('subsolar point halfway between boundaries', () => {
    const n = normalizedCoords([12, 0, 0], b);
    expect(n.d).toBeCloseTo(0.5);
    expect(n.thetaDeg).toBeCloseTo(0);
  });
  it('phi is measured from +Y towards +Z', () => {
    expect(normalizedCoords([0, 0, 12], b).phiDeg).toBeCloseTo(90);
    expect(normalizedCoords([0, -12, 0], b).phiDeg).toBeCloseTo(180);
  });
  it('points outside the sheath have no cell', () => {
    expect(cellAt([9, 0, 0], b)).toBeNull();
    expect(cellAt([-5, 0, 11], b)).not.toBeNull();
  });
  it('cell centre maps back to its own cell', () => {
    for (const cell of [0, 777, 2401, grid.nCells - 1]) {
      expect(cellAt(cellCenter(cell, b), b)).toBe(cell);
      const { d } = cellBounds(cell);
      expect(d[1] - d[0]).toBeCloseTo(0.1);
    }
  });
});
