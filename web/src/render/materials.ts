import * as THREE from 'three';

const VS = /* glsl */ `
varying vec3 vN; varying vec3 vP;
void main() {
  vN = normalize(mat3(modelMatrix) * normal);
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vP = wp.xyz;
  gl_Position = projectionMatrix * viewMatrix * wp;
}`;

// Fresnel rim lighting; optional tint by the shock-normal angle θBn (Q∥ warm, Q⊥ cool).
const FS = /* glsl */ `
uniform vec3 uColor; uniform vec3 uB; uniform float uTint;
uniform vec3 uQpar; uniform vec3 uQperp; uniform float uBase; uniform float uRim;
varying vec3 vN; varying vec3 vP;
void main() {
  vec3 n = normalize(vN);
  vec3 v = normalize(cameraPosition - vP);
  float f = pow(1.0 - abs(dot(n, v)), 2.0);
  vec3 col = uColor;
  if (uTint > 0.5) {
    float tbn = degrees(acos(clamp(abs(dot(n, normalize(uB))), 0.0, 1.0)));
    col = mix(uQpar, uQperp, smoothstep(38.0, 52.0, tbn));
  }
  gl_FragColor = vec4(col * (0.6 + 0.55 * f), uBase + uRim * f);
}`;

export const PALETTE = {
  mp: '#4FD1E8', bs: '#F2A541', qpar: '#E58467', qperp: '#7FA0D0', imf: '#E8C547',
  fg: '#D7DEE6', muted: '#7C8A99', screen: '#0A0E13',
};

export function boundaryMaterial(color: string, base: number, rim: number) {
  return new THREE.ShaderMaterial({
    vertexShader: VS, fragmentShader: FS, transparent: true, depthWrite: false, side: THREE.DoubleSide,
    uniforms: {
      uColor: { value: new THREE.Color(color) }, uB: { value: new THREE.Vector3(1, 0, 0) },
      uTint: { value: 0 }, uQpar: { value: new THREE.Color(PALETTE.qpar) },
      uQperp: { value: new THREE.Color(PALETTE.qperp) }, uBase: { value: base }, uRim: { value: rim },
    },
  });
}

export function earthMaterial() {
  return new THREE.ShaderMaterial({
    vertexShader: `varying vec3 vN; void main(){ vN = normalize(mat3(modelMatrix)*normal); gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.0);}`,
    fragmentShader: `varying vec3 vN; void main(){ float d = dot(normalize(vN), vec3(1.0,0.0,0.0));
      gl_FragColor = vec4(mix(vec3(0.05,0.09,0.14), vec3(0.24,0.52,0.86), smoothstep(-0.08,0.25,d)), 1.0);}`,
  });
}

/** Text sprite with a dark plate; size in world units. */
export function label(text: string, color: string, size = 1.6) {
  const dpr = 2, fs = 26 * dpr;
  const c = document.createElement('canvas');
  const ctx = c.getContext('2d')!;
  const font = `500 ${fs}px "IBM Plex Mono", ui-monospace, monospace`;
  ctx.font = font;
  const w = Math.ceil(ctx.measureText(text).width) + 16 * dpr, h = fs + 14 * dpr;
  c.width = w; c.height = h;
  ctx.font = font;
  ctx.fillStyle = 'rgba(10,14,19,0.65)';
  ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = color;
  ctx.textBaseline = 'middle';
  ctx.fillText(text, 8 * dpr, h / 2 + 1);
  const tex = new THREE.CanvasTexture(c);
  tex.minFilter = THREE.LinearFilter;
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false }));
  sprite.scale.set((size * w) / h, size, 1);
  sprite.renderOrder = 10;
  return sprite;
}
