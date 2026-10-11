// One depth shell of the magnetosheath: the surface of constant D_msh between the reference boundaries,
// sampled on a (theta, phi) grid. The 3D shell surface and the theta-phi map both draw this grid.
import { grid as defaultGrid, type Grid } from './grid';
import type { Boundaries } from './geometry';
import { depthIndex, spatialCell } from './binning';
import { positionAt } from './knn';

/** theta rows by phi columns, row-major (theta, phi); theta from 0 down to thetaMax. */
export type ShellGrid = { nTheta: number; nPhi: number; values: Float32Array; flags: Uint8Array };

/** k-NN shells are evaluated on 2 deg x 5 deg nodes. */
export const SHELL_GRID = { nTheta: 60, nPhi: 72, thetaMax: defaultGrid.thetaEdges[defaultGrid.thetaEdges.length - 1] };

/** Depth bin holding D (D = 1 belongs to the last bin). */
export const depthBin = (d: number, g: Grid = defaultGrid) => depthIndex(d, g);

/** Evaluate a node function at the centre of every (theta, phi) step of the shell at depth `d`. */
export function shellField(evaluate: (p: [number, number, number]) => { v: number; flag: number }, d: number,
  b: Boundaries): ShellGrid {
  const { nTheta, nPhi, thetaMax } = SHELL_GRID;
  const values = new Float32Array(nTheta * nPhi).fill(NaN), flags = new Uint8Array(nTheta * nPhi);
  for (let j = 0; j < nTheta; j++)
    for (let k = 0; k < nPhi; k++) {
      const r = evaluate(positionAt(d, ((j + 0.5) * thetaMax) / nTheta, ((k + 0.5) * 360) / nPhi, b));
      values[j * nPhi + k] = r.v;
      flags[j * nPhi + k] = r.flag;
    }
  return { nTheta, nPhi, values, flags };
}

/** Binned statistics: the shell is the depth bin holding `d`, cut out of the (D, theta, phi) cell layout. */
export function binShell(values: Float32Array, flags: Uint8Array, d: number, g: Grid = defaultGrid): ShellGrid {
  const [, nt, nphi] = g.spatialShape, i = depthBin(d, g), n = nt * nphi;
  return { nTheta: nt, nPhi: nphi, values: values.subarray(i * n, (i + 1) * n), flags: flags.subarray(i * n, (i + 1) * n) };
}

/** Grid cell of a point (theta, phi in degrees) on the shell at depth `d`, or null outside the grid. */
export function shellCellAt(d: number, thetaDeg: number, phiDeg: number, g: Grid = defaultGrid): number | null {
  const c = spatialCell(d, thetaDeg, phiDeg, g);
  return c < 0 ? null : c;
}
