import { describe, expect, it } from 'vitest';
import golden from '$golden/core.json';
import { atlasPhiDeg, imfDirection, mod, rotateClock, unrotateClock, type Vec3 } from './frames';
import { cellAtDisplay, cellCenter } from './geometry';
import { DISPLAY_BOUNDARIES } from './display';

const close = (a: number, b: number, tol = 1e-9) => expect(Math.abs(a - b)).toBeLessThanOrEqual(tol * (1 + Math.abs(b)));

describe('PGSM display rotation', () => {
  const r = golden.rotation;
  it('matches the Python reference', () => {
    r.clock_deg.forEach((c, k) => r.points.forEach((p, i) => rotateClock(p as Vec3, c).forEach((x, a) => close(x, r.rotated[k][i][a]))));
  });
  it('IMF direction matches the Python reference', () => {
    for (const e of r.imf) imfDirection(e.clock_deg, e.cone_deg).forEach((x, a) => close(x, e.dir[a]));
  });
  it('unrotate undoes rotate', () => {
    const p: Vec3 = [3, -7, 11];
    unrotateClock(rotateClock(p, 123.4), 123.4).forEach((x, a) => close(x, p[a]));
  });
  it('maps a display azimuth back to the atlas', () => {
    const p: Vec3 = [1, 4, -2];
    const disp = mod((Math.atan2(rotateClock(p, 70)[2], rotateClock(p, 70)[1]) * 180) / Math.PI, 360);
    close(atlasPhiDeg(disp, 70), mod((Math.atan2(p[2], p[1]) * 180) / Math.PI, 360));
  });
  it('a click on the drawn (rotated) cell picks that cell', () => {
    for (const cell of [123, 2047, 3333]) {
      const shown = rotateClock(cellCenter(cell, DISPLAY_BOUNDARIES), 200);
      expect(cellAtDisplay(shown, DISPLAY_BOUNDARIES, 200)).toBe(cell);
    }
  });
});
