// The depth shell in 3D: the surface of constant D_msh between the boundaries, coloured by the
// statistic sampled on its (theta, phi) grid (the same grid the theta-phi map draws).
import * as THREE from 'three';
import type { ShellGrid } from '../core/shell';
import { graticule, type RadiusFn } from './geometry';
import { lutTexture, type LutName } from './lut';
import { PALETTE } from './materials';

const VS = /* glsl */ `
in vec2 aGrid;               // (phi / 360, theta / thetaMax)
out vec2 vGrid;
void main() {
  vGrid = aGrid;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;

const FS = /* glsl */ `
precision highp float;
uniform sampler2D uGrid;     // r = value, g = flag (0 empty, 1 weak, 2 ok); x = phi, y = theta
uniform sampler2D uLut;
uniform vec2 uRange;
uniform float uOpacity;
uniform vec3 uHatch;
in vec2 vGrid;
out vec4 fragColor;
void main() {
  ivec2 n = textureSize(uGrid, 0);
  vec2 v = texelFetch(uGrid, clamp(ivec2(vGrid * vec2(n)), ivec2(0), n - 1), 0).rg;
  if (v.g < 0.5) { fragColor = vec4(uHatch, 0.10 * uOpacity); return; }
  float t = clamp((v.r - uRange.x) / (uRange.y - uRange.x), 0.0, 1.0);
  vec3 col = texture(uLut, vec2(t, 0.5)).rgb;
  if (v.g < 1.5) {
    col = mix(col, vec3(dot(col, vec3(0.3, 0.59, 0.11))), 0.65);
    if (mod(gl_FragCoord.x + gl_FragCoord.y, 7.0) < 1.6) col = uHatch;
  }
  fragColor = vec4(col, uOpacity);
}`;

/** Surface r(theta) for theta in [0, thetaMax] (radians), with (phi, theta) grid coordinates per vertex. */
function shellGeometry(r: RadiusFn, thetaMax: number, nTheta = 120, nPhi = 144) {
  const pos = new Float32Array((nTheta + 1) * (nPhi + 1) * 3), uv = new Float32Array((nTheta + 1) * (nPhi + 1) * 2);
  for (let i = 0; i <= nTheta; i++) {
    const t = (thetaMax * i) / nTheta, ri = r(t), x = ri * Math.cos(t), rho = ri * Math.sin(t);
    for (let j = 0; j <= nPhi; j++) {
      const p = (2 * Math.PI * j) / nPhi, o = i * (nPhi + 1) + j;
      // physics (X, Y, Z) = (x, rho cos p, rho sin p) -> three.js (X, Z, -Y)
      pos.set([x, rho * Math.sin(p), -rho * Math.cos(p)], 3 * o);
      uv.set([j / nPhi, i / nTheta], 2 * o);
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
  g.setAttribute('aGrid', new THREE.BufferAttribute(uv, 2));
  g.setIndex(idx);
  return g;
}

export class ShellSurface {
  readonly group = new THREE.Group();
  readonly mesh: THREE.Mesh;
  private lines: THREE.LineSegments;
  private material: THREE.ShaderMaterial;
  private lineMaterial = new THREE.LineBasicMaterial({ color: PALETTE.fg, transparent: true, opacity: 0.18, depthWrite: false });
  private texture: THREE.DataTexture | null = null;

  constructor(private thetaMaxDeg: number) {
    this.material = new THREE.ShaderMaterial({
      glslVersion: THREE.GLSL3, vertexShader: VS, fragmentShader: FS,
      transparent: true, side: THREE.DoubleSide, depthWrite: true,
      uniforms: {
        uGrid: { value: null }, uLut: { value: lutTexture('batlow') }, uRange: { value: new THREE.Vector2(0, 1) },
        uOpacity: { value: 0.92 }, uHatch: { value: new THREE.Color('#3A4655') },
      },
    });
    this.mesh = new THREE.Mesh(new THREE.BufferGeometry(), this.material);
    this.lines = new THREE.LineSegments(new THREE.BufferGeometry(), this.lineMaterial);
    this.group.add(this.mesh, this.lines);
    this.group.visible = false;
    this.mesh.visible = false;  // until data arrive
  }

  /** Place the surface at depth d between the boundaries. */
  setShape(rMp: RadiusFn, rBs: RadiusFn, d: number) {
    const r: RadiusFn = (t) => rMp(t) + d * (rBs(t) - rMp(t));
    const tMax = (this.thetaMaxDeg * Math.PI) / 180;
    this.mesh.geometry.dispose();
    this.mesh.geometry = shellGeometry(r, tMax);
    this.lines.geometry.dispose();
    this.lines.geometry = graticule(r, tMax, 15);
  }

  setGrid(s: ShellGrid | null, range: [number, number], lut: LutName) {
    if (!s) { this.mesh.visible = false; return; }
    const data = new Float32Array(s.nTheta * s.nPhi * 2);
    for (let i = 0; i < s.nTheta * s.nPhi; i++) {
      const ok = Number.isFinite(s.values[i]);
      data[2 * i] = ok ? s.values[i] : 0;
      data[2 * i + 1] = ok ? s.flags[i] : 0;
    }
    this.texture?.dispose();
    this.texture = new THREE.DataTexture(data, s.nPhi, s.nTheta, THREE.RGFormat, THREE.FloatType);
    this.texture.minFilter = this.texture.magFilter = THREE.NearestFilter;
    this.texture.needsUpdate = true;
    const u = this.material.uniforms;
    u.uGrid.value = this.texture;
    u.uRange.value.set(range[0], range[1] === range[0] ? range[0] + 1 : range[1]);
    u.uLut.value.dispose();
    u.uLut.value = lutTexture(lut);
    this.mesh.visible = true;
  }
}
