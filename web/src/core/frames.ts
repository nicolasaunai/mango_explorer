// PGSM display rotation and the IMF direction; Python reference: src/mango_explorer/atlas/view.py.
// The atlas holds PGSM at grid.atlasClockDeg. PGSM at a target clock is the rigid rotation
// R(a): (Y, Z) -> (Y cos a + Z sin a, -Y sin a + Z cos a) of it, a = clock - atlas clock
// (space_mango, checked to 1e-13): data rotate, the axes stay fixed. GSM is never rotated.
export type Vec3 = [number, number, number];
const RAD = Math.PI / 180;

/** Floor modulo, matching Python's % on floats. */
export const mod = (a: number, n: number) => a - n * Math.floor(a / n);

/** Atlas coordinates -> displayed coordinates for a rotation of `rotationDeg`. */
export function rotateClock(p: Vec3, rotationDeg: number): Vec3 {
  const c = Math.cos(rotationDeg * RAD), s = Math.sin(rotationDeg * RAD);
  return [p[0], p[1] * c + p[2] * s, -p[1] * s + p[2] * c];
}

/** Displayed coordinates -> atlas coordinates. */
export const unrotateClock = (p: Vec3, rotationDeg: number): Vec3 => rotateClock(p, -rotationDeg);

/** Azimuth atan2(Z, Y) in the atlas of a displayed azimuth (degrees, [0, 360)). */
export const atlasPhiDeg = (displayPhiDeg: number, rotationDeg: number) => mod(displayPhiDeg + rotationDeg, 360);

/** IMF unit vector: clock atan2(By, Bz) (0 = northward, 90 = +Y), cone arccos(Bx/|B|) (0 = sunward). */
export function imfDirection(clockDeg: number, coneDeg: number): Vec3 {
  const c = clockDeg * RAD, t = coneDeg * RAD;
  return [Math.cos(t), Math.sin(t) * Math.sin(c), Math.sin(t) * Math.cos(c)];
}
