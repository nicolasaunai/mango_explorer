// Physical position <-> grid cell, for picking and for placing probe markers.
import { grid as defaultGrid, type Grid } from './grid';
import { cellCoords, spatialCell } from './binning';
import { mod, unrotateClock, type Vec3 } from './frames';

export type RadiusFn = (theta: number) => number;
export type Boundaries = { rMp: RadiusFn; rBs: RadiusFn };
const DEG = 180 / Math.PI;

/** (D_msh, theta, phi in degrees) of a position given in the frame's coordinates. */
export function normalizedCoords(p: [number, number, number], b: Boundaries) {
  const r = Math.hypot(...p);
  const theta = Math.acos(Math.max(-1, Math.min(1, p[0] / r)));
  const d = (r - b.rMp(theta)) / (b.rBs(theta) - b.rMp(theta));
  return { d, thetaDeg: theta * DEG, phiDeg: mod(Math.atan2(p[2], p[1]) * DEG, 360) };
}

/** Grid cell holding a position, or null outside the sheath or the theta range. */
export function cellAt(p: [number, number, number], b: Boundaries, g: Grid = defaultGrid): number | null {
  const { d, thetaDeg, phiDeg } = normalizedCoords(p, b);
  if (!(d >= 0 && d <= 1)) return null;
  const c = spatialCell(d, thetaDeg, phiDeg, g);
  return c < 0 ? null : c;
}

/** Grid cell under a displayed position (PGSM shown at a rotation), or null outside the sheath. */
export function cellAtDisplay(p: Vec3, b: Boundaries, rotationDeg: number, g: Grid = defaultGrid): number | null {
  return cellAt(unrotateClock(p, rotationDeg), b, g);
}

/** Bin ranges of a cell. */
export function cellBounds(cell: number, g: Grid = defaultGrid) {
  const [i, j, k] = cellCoords(cell, g);
  return {
    d: [g.dEdges[i], g.dEdges[i + 1]] as const,
    theta: [g.thetaEdges[j], g.thetaEdges[j + 1]] as const,
    phi: [g.phiEdges[k], g.phiEdges[k + 1]] as const,
  };
}

/** Position of a cell's centre between the given boundaries. */
export function cellCenter(cell: number, b: Boundaries, g: Grid = defaultGrid): [number, number, number] {
  const { d, theta, phi } = cellBounds(cell, g);
  const t = (theta[0] + theta[1]) / 2 / DEG, p = (phi[0] + phi[1]) / 2 / DEG, dm = (d[0] + d[1]) / 2;
  const r = b.rMp(t) + dm * (b.rBs(t) - b.rMp(t));
  return [r * Math.cos(t), r * Math.sin(t) * Math.cos(p), r * Math.sin(t) * Math.sin(p)];
}
