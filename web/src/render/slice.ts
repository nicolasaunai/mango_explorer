// A cut plane through the magnetosheath, coloured by a per-cell statistic.
// The fragment shader turns each pixel into (D_msh, theta, phi) using the same boundary
// functions as the drawn surfaces, so the data always sit between the drawn MP and BS.
import * as THREE from 'three';
import { grid } from '../core/grid';
import type { RadiusFn } from './geometry';
import { lutTexture, type LutName } from './lut';

export type Plane = 'XY' | 'XZ' | 'YZ';
const N_BOUNDS = 512;

const VS = /* glsl */ `
out vec3 vW;
void main() {
  vec4 w = modelMatrix * vec4(position, 1.0);
  vW = w.xyz;
  gl_Position = projectionMatrix * viewMatrix * w;
}`;

const FS = /* glsl */ `
precision highp float;
precision highp sampler3D;
uniform sampler3D uData;     // (phi, theta, D) cells: r = value, g = flag (0 empty, 1 weak, 2 ok)
uniform sampler2D uBounds;   // r = R_mp(theta), g = R_bs(theta), theta in [0, 180] deg
uniform sampler2D uLut;
uniform vec2 uRange;
uniform vec3 uStep;          // phi, theta, D bin widths
uniform ivec3 uShape;        // n_phi, n_theta, n_D
uniform float uOpacity;
uniform vec3 uHatch;
in vec3 vW;
out vec4 fragColor;
void main() {
  vec3 P = vec3(vW.x, -vW.z, vW.y);            // three.js -> physics (X, Y, Z)
  float r = length(P);
  if (r < 1.0) discard;
  float th = degrees(acos(clamp(P.x / r, -1.0, 1.0)));
  float thMax = uStep.y * float(uShape.y);
  if (th >= thMax) discard;
  float ph = mod(degrees(atan(P.z, P.y)), 360.0);
  vec2 b = texelFetch(uBounds, ivec2(int(th / 180.0 * ${N_BOUNDS - 1}.0 + 0.5), 0), 0).rg;
  float D = (r - b.r) / (b.g - b.r);
  if (D < 0.0 || D > 1.0) discard;
  ivec3 c = min(ivec3(int(ph / uStep.x), int(th / uStep.y), int(D / uStep.z)), uShape - 1);
  vec2 v = texelFetch(uData, c, 0).rg;
  if (v.g < 0.5) { fragColor = vec4(uHatch, 0.10 * uOpacity); return; }
  float t = clamp((v.r - uRange.x) / (uRange.y - uRange.x), 0.0, 1.0);
  vec3 col = texture(uLut, vec2(t, 0.5)).rgb;
  if (v.g < 1.5) {
    col = mix(col, vec3(dot(col, vec3(0.3, 0.59, 0.11))), 0.65);
    if (mod(gl_FragCoord.x + gl_FragCoord.y, 7.0) < 1.6) col = uHatch;
  }
  fragColor = vec4(col, uOpacity);
}`;

export class SliceLayer {
  readonly mesh: THREE.Mesh;
  private data: THREE.Data3DTexture;
  private bounds: THREE.DataTexture;
  private material: THREE.ShaderMaterial;

  constructor() {
    const [nd, nt, nphi] = grid.spatialShape;
    const uniform = (e: number[]) => e.every((x, i) => i === 0 || Math.abs(x - e[i - 1] - (e[1] - e[0])) < 1e-9);
    if (!uniform(grid.dEdges) || !uniform(grid.thetaEdges) || !uniform(grid.phiEdges))
      throw new Error('the slice shader assumes uniform bins');
    this.data = new THREE.Data3DTexture(new Float32Array(nphi * nt * nd * 2), nphi, nt, nd);
    this.data.format = THREE.RGFormat;
    this.data.type = THREE.FloatType;
    this.data.minFilter = this.data.magFilter = THREE.NearestFilter;
    this.data.needsUpdate = true;
    this.bounds = new THREE.DataTexture(new Float32Array(N_BOUNDS * 2), N_BOUNDS, 1, THREE.RGFormat, THREE.FloatType);
    this.bounds.minFilter = this.bounds.magFilter = THREE.NearestFilter;
    this.material = new THREE.ShaderMaterial({
      glslVersion: THREE.GLSL3, vertexShader: VS, fragmentShader: FS,
      transparent: true, side: THREE.DoubleSide, depthWrite: true,
      uniforms: {
        uData: { value: this.data }, uBounds: { value: this.bounds }, uLut: { value: lutTexture('batlow') },
        uRange: { value: new THREE.Vector2(0, 1) },
        uStep: { value: new THREE.Vector3(grid.phiEdges[1] - grid.phiEdges[0], grid.thetaEdges[1] - grid.thetaEdges[0], grid.dEdges[1] - grid.dEdges[0]) },
        uShape: { value: new Int32Array([nphi, nt, nd]) },
        uOpacity: { value: 0.94 }, uHatch: { value: new THREE.Color('#3A4655') },
      },
    });
    this.mesh = new THREE.Mesh(new THREE.PlaneGeometry(64, 64), this.material);
    this.mesh.renderOrder = 0;
    this.mesh.visible = false;
  }

  setBoundaries(rMp: RadiusFn, rBs: RadiusFn) {
    const a = this.bounds.image.data as Float32Array;
    for (let i = 0; i < N_BOUNDS; i++) {
      const t = (Math.PI * i) / (N_BOUNDS - 1);
      a[2 * i] = rMp(t);
      a[2 * i + 1] = rBs(t);
    }
    this.bounds.needsUpdate = true;
  }

  setData(values: Float32Array, flags: Uint8Array) {
    const a = this.data.image.data as unknown as Float32Array;
    for (let c = 0; c < values.length; c++) {
      a[2 * c] = Number.isFinite(values[c]) ? values[c] : 0;
      a[2 * c + 1] = Number.isFinite(values[c]) ? flags[c] : 0;
    }
    this.data.needsUpdate = true;
    this.mesh.visible = true;
  }

  setRange(lo: number, hi: number) {
    this.material.uniforms.uRange.value.set(lo, hi === lo ? lo + 1 : hi);
  }

  setLut(name: LutName) {
    this.material.uniforms.uLut.value.dispose();
    this.material.uniforms.uLut.value = lutTexture(name);
  }

  /** Orient the plane: XZ is the noon-midnight meridian (contains the IMF in PGSM). */
  setPlane(plane: Plane) {
    this.mesh.rotation.set(0, 0, 0);
    if (plane === 'XY') this.mesh.rotation.x = -Math.PI / 2;
    if (plane === 'YZ') this.mesh.rotation.y = Math.PI / 2;
    this.mesh.updateMatrixWorld();
  }
}
