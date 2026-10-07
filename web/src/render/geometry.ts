// Axisymmetric boundary surfaces. Physics frame (X sunward, Y, Z) maps to three.js as (X, Z, -Y),
// so +Z (north / IMF in PGSM) is "up" on screen.
import * as THREE from 'three';
import type { Vec3 } from '../core/frames';

export const toThree = (v: Vec3) => new THREE.Vector3(v[0], v[2], -v[1]);

export type RadiusFn = (theta: number) => number;

/** Surface of revolution r(θ) about X, cut at x = xMin, with analytic normals. */
export function revolutionGeometry(r: RadiusFn, xMin: number, nTheta = 96, nPhi = 96) {
  let tMax = 0;
  for (let t = 0; t < Math.PI * 0.98; t += 0.002) {
    if (r(t) * Math.cos(t) < xMin) break;
    tMax = t;
  }
  const pos = new Float32Array((nTheta + 1) * (nPhi + 1) * 3);
  const nor = new Float32Array(pos.length);
  const h = 1e-4;
  for (let i = 0; i <= nTheta; i++) {
    const t = (tMax * i) / nTheta, ri = r(t);
    const x = ri * Math.cos(t), rho = ri * Math.sin(t);
    const r2 = r(t + h);
    const dx = (r2 * Math.cos(t + h) - x) / h, drho = (r2 * Math.sin(t + h) - rho) / h;
    const L = Math.hypot(dx, drho) || 1;
    const nx = drho / L, nr = -dx / L;
    for (let j = 0; j <= nPhi; j++) {
      const p = (2 * Math.PI * j) / nPhi, cp = Math.cos(p), sp = Math.sin(p);
      const o = (i * (nPhi + 1) + j) * 3;
      pos[o] = x; pos[o + 1] = rho * sp; pos[o + 2] = -rho * cp;
      nor[o] = nx; nor[o + 1] = nr * sp; nor[o + 2] = -nr * cp;
    }
  }
  const idx: number[] = [];
  for (let i = 0; i < nTheta; i++)
    for (let j = 0; j < nPhi; j++) {
      const a = i * (nPhi + 1) + j, b = a + nPhi + 1;
      idx.push(a, b, a + 1, b, b + 1, a + 1);
    }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  g.setIndex(idx);
  g.userData.tMax = tMax;
  return g;
}

/** Iso-θ rings every `stepDeg` and meridians every 45°, as one LineSegments object. */
export function graticule(r: RadiusFn, tMax: number, stepDeg = 15) {
  const pts: number[] = [];
  const at = (t: number, p: number) => {
    const ri = r(t), rho = ri * Math.sin(t);
    return [ri * Math.cos(t), rho * Math.sin(p), -rho * Math.cos(p)];
  };
  for (let d = stepDeg; (d * Math.PI) / 180 < tMax; d += stepDeg) {
    const t = (d * Math.PI) / 180;
    for (let j = 0; j < 96; j++) pts.push(...at(t, (2 * Math.PI * j) / 96), ...at(t, (2 * Math.PI * (j + 1)) / 96));
  }
  for (let k = 0; k < 8; k++) {
    const p = (k * Math.PI) / 4;
    for (let i = 0; i < 80; i++) pts.push(...at((tMax * i) / 80, p), ...at((tMax * (i + 1)) / 80, p));
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
  return g;
}
