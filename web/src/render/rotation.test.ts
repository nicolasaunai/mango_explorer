import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { clockRotationX } from './rotation';
import { toThree } from './geometry';
import { rotateClock, type Vec3 } from '../core/frames';

describe('rotating the drawn data', () => {
  it('a group rotated by clockRotationX shows rotateClock of its content', () => {
    for (const deg of [0, 37.5, 90, 251.3]) {
      const p: Vec3 = [4, -6, 9];
      const got = toThree(p).applyEuler(new THREE.Euler(clockRotationX(deg), 0, 0));
      const want = toThree(rotateClock(p, deg));
      expect(got.distanceTo(want)).toBeLessThan(1e-9);
    }
  });
});
