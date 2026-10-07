// Frames, all rotations about X_GSM; Python reference: src/mango_explorer/atlas/frames.py
import type { FrameName } from './grid';

export type Vec3 = [number, number, number];
const DEG = 180 / Math.PI;

/** Floor modulo, matching Python's % on floats. */
export const mod = (a: number, n: number) => a - n * Math.floor(a / n);

export const clockAngleDeg = (by: number, bz: number) => mod(Math.atan2(by, bz) * DEG, 360);

export function coneAngleDeg(bx: number, by: number, bz: number): number {
  const b = Math.hypot(bx, by, bz);
  return Math.acos(Math.min(1, Math.max(0, Math.abs(bx) / b))) * DEG;
}

export function rotateAboutX(y: number, z: number, angle: number): [number, number] {
  const c = Math.cos(angle), s = Math.sin(angle);
  return [y * c - z * s, y * s + z * c];
}

/** Rotation angle about X taking GSM to `frame`, and whether magnetic vectors flip sign. */
export function frameAngle(frame: FrameName, imf: Vec3): { angle: number; flip: boolean } {
  if (frame === 'GSM') return { angle: 0, flip: false };
  const clock = Math.atan2(imf[1], imf[2]);
  if (frame === 'PGSM') return { angle: clock, flip: false };
  const flip = imf[0] < 0;
  return { angle: clock + (flip ? Math.PI : 0), flip };
}

export function vectorToFrame(frame: FrameName, v: Vec3, imf: Vec3, magnetic: boolean): Vec3 {
  const { angle, flip } = frameAngle(frame, imf);
  const [y, z] = rotateAboutX(v[1], v[2], angle);
  const s = magnetic && flip ? -1 : 1;
  return [v[0] * s, y * s, z * s];
}

export function azimuthInFrameDeg(frame: FrameName, y: number, z: number, imf: Vec3): number {
  return mod((Math.atan2(z, y) + frameAngle(frame, imf).angle) * DEG, 360);
}

/** IMF unit vector for a representative (clock, cone, sign of Bx), expressed in `frame`. */
export function imfDirection(frame: FrameName, clockDeg: number, coneDeg: number, bxSign: 1 | -1): Vec3 {
  const c = clockDeg / DEG, t = coneDeg / DEG;
  const gsm: Vec3 = [bxSign * Math.cos(t), Math.sin(t) * Math.sin(c), Math.sin(t) * Math.cos(c)];
  return vectorToFrame(frame, gsm, gsm, true);
}

/** Where Z_GSM points once a sample with this IMF is expressed in `frame`. */
export function zGsmDirection(frame: FrameName, clockDeg: number, bxSign: 1 | -1): Vec3 {
  const c = clockDeg / DEG;
  const imf: Vec3 = [bxSign, Math.sin(c), Math.cos(c)];
  return vectorToFrame(frame, [0, 0, 1], imf, false);
}
