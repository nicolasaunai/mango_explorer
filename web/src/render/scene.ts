// The 3D view: Earth, axes, magnetopause and bow shock, IMF and Z_GSM arrows.
// Renders on demand: only when the camera moves or the inputs change.
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import type { FrameName } from '../core/grid';
import { imfDirection, zGsmDirection } from '../core/frames';
import { graticule, revolutionGeometry, toThree, type RadiusFn } from './geometry';
import { PALETTE, boundaryMaterial, earthMaterial, label } from './materials';
import { SliceLayer, type Plane } from './slice';
import type { LutName } from './lut';

export type SceneInputs = {
  frame: FrameName;
  clockDeg: number | null; // representative clock angle, null when undefined (radial IMF)
  coneDeg: number;
  showMp: boolean;
  showBs: boolean;
  tint: boolean;
  shells: boolean;
  rMp: RadiusFn;
  rBs: RadiusFn;
};

export type CameraPreset = 'iso' | 'sun' | 'dusk' | 'north' | 'tail';
const X_MIN = -16;

export class SceneView {
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera = new THREE.PerspectiveCamera(34, 1, 0.1, 800);
  private controls: OrbitControls;
  private mp?: THREE.Group;
  private bs?: THREE.Group;
  private bsMat = boundaryMaterial(PALETTE.bs, 0.07, 0.6);
  private mpMat = boundaryMaterial(PALETTE.mp, 0.05, 0.55);
  private shell?: THREE.LineSegments;
  private imf = new THREE.ArrowHelper(new THREE.Vector3(1, 0, 0), new THREE.Vector3(21, 0, 0), 6.5, PALETTE.imf, 1.5, 0.8);
  private imfGhost = new THREE.ArrowHelper(new THREE.Vector3(1, 0, 0), new THREE.Vector3(21, 0, 0), 6.5, PALETTE.imf, 1.5, 0.8);
  private zArrow = new THREE.ArrowHelper(new THREE.Vector3(0, 1, 0), new THREE.Vector3(), 7, PALETTE.fg, 1.2, 0.6);
  private labels: Record<string, THREE.Sprite> = {};
  private ro: ResizeObserver;
  private frameRequested = false;
  private lastShape?: [RadiusFn, RadiusFn];
  readonly slices: Record<Plane, SliceLayer> = { XY: new SliceLayer(), XZ: new SliceLayer(), YZ: new SliceLayer() };
  private marker = new THREE.Mesh(new THREE.SphereGeometry(0.35, 16, 12), new THREE.MeshBasicMaterial({ color: PALETTE.fg }));
  private raycaster = new THREE.Raycaster();
  /** Called with the physics position (X, Y, Z) of a click on the slice. */
  onPick: ((p: [number, number, number]) => void) | null = null;

  constructor(private canvas: HTMLCanvasElement) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.setClearColor(PALETTE.screen, 1);
    this.controls = new OrbitControls(this.camera, canvas);
    this.controls.enableDamping = true;
    this.controls.minDistance = 20;
    this.controls.maxDistance = 220;
    this.controls.target.set(-3, 0, 0);
    this.controls.addEventListener('change', () => this.requestRender());
    this.buildStatic();
    this.setView('iso');
    this.ro = new ResizeObserver(() => this.resize());
    this.ro.observe(canvas.parentElement!);
    for (const [plane, s] of Object.entries(this.slices) as [Plane, SliceLayer][]) {
      s.setPlane(plane);
      this.scene.add(s.mesh);
    }
    this.scene.add(this.marker);
    this.marker.visible = false;
    this.listenForPicks();
  }

  private listenForPicks() {
    let down: { x: number; y: number } | null = null;
    this.canvas.addEventListener('pointerdown', (e) => (down = { x: e.clientX, y: e.clientY }));
    this.canvas.addEventListener('pointerup', (e) => {
      if (!down || Math.hypot(e.clientX - down.x, e.clientY - down.y) > 4) return;
      const r = this.canvas.getBoundingClientRect();
      const ndc = new THREE.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
      this.raycaster.setFromCamera(ndc, this.camera);
      const meshes = Object.values(this.slices).map((s) => s.mesh).filter((m) => m.visible);
      const hit = this.raycaster.intersectObjects(meshes, false)[0];
      if (hit) this.onPick?.([hit.point.x, -hit.point.z, hit.point.y]);
    });
  }

  /** Show the statistic on each requested plane: grid cells (bins) or a field per plane (k-NN). */
  setSlices(p: { planes: Plane[]; values: Float32Array; flags: Uint8Array; range: [number, number]; lut: LutName; visible: boolean;
    field?: { n: number; half: number; planes: { plane: Plane; values: Float32Array; flags: Uint8Array }[] } }) {
    for (const [plane, s] of Object.entries(this.slices) as [Plane, SliceLayer][]) {
      const on = p.visible && p.planes.includes(plane);
      if (on) {
        const f = p.field?.planes.find((x) => x.plane === plane);
        if (p.field && !f) { s.mesh.visible = false; continue; }  // field not computed yet
        if (f) s.setField(f.values, f.flags, p.field!.n, p.field!.half);
        else s.setData(p.values, p.flags);
        s.setRange(p.range[0], p.range[1]);
        s.setLut(p.lut);
      }
      s.mesh.visible = on;
    }
    this.requestRender();
  }

  setMarker(p: [number, number, number] | null) {
    this.marker.visible = !!p;
    if (p) this.marker.position.set(p[0], p[2], -p[1]);
    this.requestRender();
  }

  /** PNG of the current view; render and read back in the same task so the buffer is intact. */
  capture(): HTMLCanvasElement {
    this.controls.update();
    this.renderer.render(this.scene, this.camera);
    const c = document.createElement('canvas');
    c.width = this.canvas.width;
    c.height = this.canvas.height;
    c.getContext('2d')!.drawImage(this.canvas, 0, 0);
    return c;
  }

  private buildStatic() {
    const s = this.scene;
    // stars (deterministic)
    let seed = 7;
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    const star: number[] = [];
    for (let i = 0; i < 800; i++) {
      const u = rnd() * 2 - 1, a = rnd() * Math.PI * 2, k = Math.sqrt(1 - u * u);
      star.push(400 * k * Math.cos(a), 400 * u, 400 * k * Math.sin(a));
    }
    const sg = new THREE.BufferGeometry();
    sg.setAttribute('position', new THREE.Float32BufferAttribute(star, 3));
    s.add(new THREE.Points(sg, new THREE.PointsMaterial({ color: PALETTE.muted, size: 1, sizeAttenuation: false, transparent: true, opacity: 0.5 })));

    s.add(new THREE.Mesh(new THREE.SphereGeometry(1, 48, 32), earthMaterial()));
    const axMat = new THREE.LineBasicMaterial({ color: PALETTE.muted, transparent: true, opacity: 0.45 });
    const axes = new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(-20, 0, 0), new THREE.Vector3(26, 0, 0),
      new THREE.Vector3(0, 0, 16), new THREE.Vector3(0, 0, -16),
      new THREE.Vector3(0, -15, 0), new THREE.Vector3(0, 17, 0),
    ]);
    s.add(new THREE.LineSegments(axes, axMat));
    this.labels.x = label('+X  Sun', PALETTE.fg, 1.3); this.labels.x.position.set(28, 0, 0);
    this.labels.y = label('+Y  dusk', PALETTE.fg, 1.3); this.labels.y.position.set(0, 0, -18);
    this.labels.imf = label('IMF', PALETTE.imf, 1.3);
    this.labels.zgsm = label('Z_GSM', PALETTE.fg, 1.1);
    this.labels.qpar = label('Q∥', PALETTE.qpar, 1.5);
    this.labels.qperp = label('Q⊥', PALETTE.qperp, 1.5);
    Object.values(this.labels).forEach((l) => s.add(l));
    this.imfGhost.line.material = new THREE.LineBasicMaterial({ color: PALETTE.imf, transparent: true, opacity: 0.35 });
    (this.imfGhost.cone.material as THREE.MeshBasicMaterial).transparent = true;
    (this.imfGhost.cone.material as THREE.MeshBasicMaterial).opacity = 0.35;
    (this.zArrow.line.material as THREE.LineBasicMaterial).transparent = true;
    (this.zArrow.line.material as THREE.LineBasicMaterial).opacity = 0.6;
    s.add(this.imf, this.imfGhost, this.zArrow);
  }

  private zLabel?: THREE.Sprite;
  private setZLabel(frame: FrameName) {
    if (this.zLabel) {
      this.scene.remove(this.zLabel);
      this.zLabel.material.map?.dispose();
      this.zLabel.material.dispose();
    }
    this.zLabel = label(frame === 'GSM' ? '+Z GSM' : '+Z PGSM (IMF⊥)', PALETTE.fg, 1.3);
    this.zLabel.position.set(0, 18.5, 0);
    this.scene.add(this.zLabel);
  }

  private buildBoundaries(rMp: RadiusFn, rBs: RadiusFn) {
    for (const g of [this.mp, this.bs]) if (g) { this.scene.remove(g); g.traverse((o) => (o as THREE.Mesh).geometry?.dispose()); }
    const make = (r: RadiusFn, mat: THREE.ShaderMaterial, color: string, opacity: number, order: number) => {
      const geo = revolutionGeometry(r, X_MIN);
      const mesh = new THREE.Mesh(geo, mat);
      mesh.renderOrder = order;
      const lines = new THREE.LineSegments(graticule(r, geo.userData.tMax),
        new THREE.LineBasicMaterial({ color, transparent: true, opacity, depthWrite: false }));
      const grp = new THREE.Group();
      grp.add(mesh, lines);
      grp.userData.geo = geo;
      return grp;
    };
    for (const s of Object.values(this.slices)) s.setBoundaries(rMp, rBs);
    this.mp = make(rMp, this.mpMat, PALETTE.mp, 0.2, 1);
    this.bs = make(rBs, this.bsMat, PALETTE.bs, 0.15, 2);
    this.scene.add(this.mp, this.bs);
    if (this.shell) { this.scene.remove(this.shell); this.shell.geometry.dispose(); }
    const mid: RadiusFn = (t) => rMp(t) + 0.5 * (rBs(t) - rMp(t));
    this.shell = new THREE.LineSegments(graticule(mid, revolutionGeometry(mid, X_MIN + 2, 8, 8).userData.tMax, 10),
      new THREE.LineBasicMaterial({ color: PALETTE.fg, transparent: true, opacity: 0.18, depthWrite: false }));
    this.scene.add(this.shell);
  }

  update(p: SceneInputs) {
    if (!this.lastShape || this.lastShape[0] !== p.rMp || this.lastShape[1] !== p.rBs) {
      this.buildBoundaries(p.rMp, p.rBs);
      this.lastShape = [p.rMp, p.rBs];
    }
    this.setZLabel(p.frame);
    this.mp!.visible = p.showMp;
    this.bs!.visible = p.showBs;
    this.shell!.visible = p.shells;

    const clock = p.clockDeg ?? 0;
    const b = toThree(imfDirection(p.frame, clock, p.coneDeg, 1)).normalize();
    const bNeg = toThree(imfDirection(p.frame, clock, p.coneDeg, -1)).normalize();
    // A folded frame has one IMF orientation; the others mix both signs of Bx.
    const unique = p.frame === 'PGSM_fold';
    const showClock = p.clockDeg !== null || p.frame !== 'GSM';
    this.imf.visible = showClock;
    this.imf.setDirection(b);
    this.imfGhost.visible = showClock && !unique;
    this.imfGhost.setDirection(bNeg);
    this.labels.imf.visible = showClock;
    this.labels.imf.position.copy(new THREE.Vector3(21, 0, 0).add(b.clone().multiplyScalar(8.4)));

    const z = p.frame === 'GSM' || p.clockDeg === null ? null : toThree(zGsmDirection(p.frame, clock, 1)).normalize();
    this.zArrow.visible = this.labels.zgsm.visible = !!z;
    if (z) { this.zArrow.setDirection(z); this.labels.zgsm.position.copy(z.multiplyScalar(9)); }

    const tint = p.tint && unique;
    this.bsMat.uniforms.uTint.value = tint ? 1 : 0;
    this.bsMat.uniforms.uB.value.copy(b);
    this.labels.qpar.visible = this.labels.qperp.visible = tint && p.showBs;
    if (tint) this.placeShockLabels(b);
    this.requestRender();
  }

  private placeShockLabels(b: THREE.Vector3) {
    const geo = this.bs!.userData.geo as THREE.BufferGeometry;
    const pos = geo.attributes.position.array as Float32Array, nor = geo.attributes.normal.array as Float32Array;
    let minA = Infinity, maxA = -1, iMin = 0, iMax = 0;
    for (let i = 0; i < pos.length; i += 3) {
      if (pos[i] < -3) continue;
      const a = Math.acos(Math.min(1, Math.abs(nor[i] * b.x + nor[i + 1] * b.y + nor[i + 2] * b.z)));
      if (a < minA) { minA = a; iMin = i; }
      if (a > maxA) { maxA = a; iMax = i; }
    }
    this.labels.qpar.position.set(pos[iMin] * 1.12, pos[iMin + 1] * 1.12, pos[iMin + 2] * 1.12);
    this.labels.qperp.position.set(pos[iMax] * 1.12, pos[iMax + 1] * 1.12, pos[iMax + 2] * 1.12);
  }

  setView(v: CameraPreset) {
    const R = 105, t = this.controls.target;
    const dir: Record<CameraPreset, [number, number, number]> = {
      iso: [0.55, 0.42, 0.72], sun: [1, 0, 0], dusk: [0, 0, -1], north: [0.02, 1, 0.001], tail: [-1, 0.08, 0],
    };
    const d = new THREE.Vector3(...dir[v]).normalize().multiplyScalar(R);
    this.camera.position.copy(t).add(d);
    this.camera.up.set(0, 1, 0);
    this.controls.update();
    this.requestRender();
  }

  private resize() {
    const r = this.canvas.parentElement!.getBoundingClientRect();
    this.renderer.setSize(r.width, r.height, false);
    this.camera.aspect = r.width / Math.max(1, r.height);
    this.camera.updateProjectionMatrix();
    this.requestRender();
  }

  requestRender() {
    if (this.frameRequested) return;
    this.frameRequested = true;
    requestAnimationFrame(() => {
      this.frameRequested = false;
      // damping keeps emitting 'change' until the camera settles
      this.controls.update();
      this.renderer.render(this.scene, this.camera);
    });
  }

  dispose() {
    this.ro.disconnect();
    this.controls.dispose();
    this.renderer.dispose();
  }
}
