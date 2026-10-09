// Physics (X, Y, Z) is three.js (X, Z, -Y). The display rotation R(a) of core/frames.ts (azimuth
// atan2(Z, Y) -> phi - a) is a rotation of -a about three.js x.
export const clockRotationX = (rotationDeg: number) => (-rotationDeg * Math.PI) / 180;
