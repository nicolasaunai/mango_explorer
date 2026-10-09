// The 3D view: Earth, fixed axes labelled by frame, magnetopause and bow shock, IMF arrows.
// In PGSM the data (slices, shell, lines) rotate rigidly about X with the target clock; the axes do not.
// Renders on demand: only when the camera moves or the inputs change.
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import type { FrameName } from '../core/grid';
import { imfDirection } from '../core/frames';
import { graticule, revolutionGeometry, toThree, type RadiusFn } from './geometry';
import { PALETTE, boundaryMaterial, earthMaterial, label } from './materials';
import { SliceLayer, normalOf, type Plane } from './slice';
import { clockRotationX } from './rotation';
import { ShellSurface } from './shell';
import { LinesLayer } from './lines';
import type { ShellGrid } from '../core/shell';
import { normalizedCoords } from '../core/geometry';
import type { LutName } from './lut';

export type SceneInputs = {
  frame: FrameName;
  /** clock angle of the drawn IMF arrow, null when it has no direction */
  imfClockDeg: number | null;
  /** cone of the IMF arrow, and of a fainter second arrow (180° − cone) when the selection spans 90° */
  imfCone: { cone: number; ghost: number | null };
  /** rotation (degrees) from the atlas to the display: the data rotate about X, the axes stay */
  rotationDeg: number;
  showMp: boolean;
  showBs: boolean;
  tint: boolean;
  /** draw the coloured depth shell (data come through setShell) */
  shells: boolean;
  /** its depth D_msh */
  shellD: number;
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
  private shell = new ShellSurface(120);
  private flowLines = new LinesLayer(PALETTE.flow);
  private fieldLines = new LinesLayer(PALETTE.field);
  private imf = new THREE.ArrowHelper(new THREE.Vector3(1, 0, 0), new THREE.Vector3(21, 0, 0), 6.5, PALETTE.imf, 1.5, 0.8);
  private imfGhost = new THREE.ArrowHelper(new THREE.Vector3(1, 0, 0), new THREE.Vector3(21, 0, 0), 6.5, PALETTE.imf, 1.5, 0.8);
  private labels: Record<string, THREE.Sprite> = {};
  /** slices, depth shell and lines: drawn in atlas coordinates, rotated to the display */
  private rotating = new THREE.Group();
  private ro: ResizeObserver;
  private frameRequested = false;
  private lastShape?: [RadiusFn, RadiusFn];
  readonly slices: Record<Plane, SliceLayer> = { XY: new SliceLayer(), XZ: new SliceLayer(), YZ: new SliceLayer() };
  private marker = new THREE.Mesh(new THREE.SphereGeometry(0.35, 16, 12), new THREE.MeshBasicMaterial({ color: PALETTE.fg }));
  private raycaster = new THREE.Raycaster();
  /** Called with the physics position (X, Y, Z) of a click on a slice or on the depth shell. */
  onPick: ((p: [number, number, number], onShell: boolean) => void) | null = null;
  /** Called while a slice is dragged along its normal (done = false) and on release (done = true). */
  onPlaneDrag: ((plane: Plane, offset: number, done: boolean) => void) | null = null;

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
    this.rotating.add(this.shell.group, this.flowLines.group, this.fieldLines.group);
    this.scene.add(this.rotating);
    this.scene.add(this.marker);
    this.marker.visible = false;
    this.listenForPicks();
  }

  private rayAt(e: PointerEvent) {
    const r = this.canvas.getBoundingClientRect();
    const ndc = new THREE.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    this.raycaster.setFromCamera(ndc, this.camera);
    return this.raycaster.ray;
  }

  /** The nearest visible slice or shell under the pointer; slices count only where they show the
   * magnetosheath. `slice` is null when the shell is in front. */
  private pickUnder(e: PointerEvent): { slice: SliceLayer | null; point: THREE.Vector3 } | null {
    this.rayAt(e);
    const visible = Object.values(this.slices).filter((s) => s.mesh.visible);
    const shellOn = this.shell.group.visible && this.shell.mesh.visible;
    const meshes = [...visible.map((s) => s.mesh), ...(shellOn ? [this.shell.mesh] : [])];
    for (const hit of this.raycaster.intersectObjects(meshes, false)) {
      if (hit.object === this.shell.mesh) return { slice: null, point: hit.point.clone() };
      const slice = visible.find((s) => s.mesh === hit.object)!;
      const p: [number, number, number] = [hit.point.x, -hit.point.z, hit.point.y];
      if (!this.lastShape) continue;
      const { d, thetaDeg } = normalizedCoords(p, { rMp: this.lastShape[0], rBs: this.lastShape[1] });
      if (d >= 0 && d <= 1 && thetaDeg < 120) return { slice, point: hit.point.clone() };
    }
    return null;
  }

  /** The slice under the pointer, if no shell is in front of it. */
  private sliceUnder(e: PointerEvent) {
    const hit = this.pickUnder(e);
    return hit?.slice ? { slice: hit.slice, point: hit.point } : null;
  }

  private listenForPicks() {
    type Drag = { slice: SliceLayer; start: number; origin: THREE.Vector3; x: number; y: number; moved: boolean };
    let drag: Drag | null = null;
    let click: { x: number; y: number } | null = null;
    // capture phase: runs before OrbitControls, so a slice drag does not also orbit the camera
    this.canvas.addEventListener('pointerdown', (e) => {
      click = { x: e.clientX, y: e.clientY };
      const hit = e.button === 0 ? this.sliceUnder(e) : null;
      if (!hit) return;
      drag = { slice: hit.slice, start: hit.slice.offset, origin: hit.point, x: e.clientX, y: e.clientY, moved: false };
      this.controls.enabled = false;
      this.canvas.setPointerCapture(e.pointerId);
      this.canvas.style.cursor = 'grabbing';
    }, { capture: true });
    this.canvas.addEventListener('pointermove', (e) => {
      if (!drag) {
        if (e.buttons === 0) this.canvas.style.cursor = this.sliceUnder(e) ? 'grab' : '';
        return;
      }
      if (!drag.moved && Math.hypot(e.clientX - drag.x, e.clientY - drag.y) < 4) return;
      drag.moved = true;
      // slide along the normal: intersect the pointer ray with the plane that contains the normal
      // axis through the grab point and faces the camera as much as possible
      const axis = normalOf(drag.slice.plane);
      const view = this.camera.getWorldDirection(new THREE.Vector3());
      const facing = view.clone().sub(axis.clone().multiplyScalar(view.dot(axis)));
      if (facing.lengthSq() < 1e-6) return;  // looking straight down the normal
      const target = new THREE.Vector3();
      if (!this.rayAt(e).intersectPlane(new THREE.Plane().setFromNormalAndCoplanarPoint(facing.normalize(), drag.origin), target)) return;
      const offset = Math.max(-30, Math.min(30, Math.round((drag.start + target.sub(drag.origin).dot(axis)) * 20) / 20));
      drag.slice.setOffset(offset);
      this.requestRender();
      this.onPlaneDrag?.(drag.slice.plane, offset, false);
    });
    this.canvas.addEventListener('pointerup', (e) => {
      if (drag) {
        const d = drag;
        drag = null;
        this.controls.enabled = true;
        this.canvas.style.cursor = 'grab';
        if (d.moved) { this.onPlaneDrag?.(d.slice.plane, d.slice.offset, true); return; }
      }
      if (!click || Math.hypot(e.clientX - click.x, e.clientY - click.y) > 4) return;
      const hit = this.pickUnder(e);
      if (hit) this.onPick?.([hit.point.x, -hit.point.z, hit.point.y], !hit.slice);
    });
  }

  setOffsets(offsets: Record<Plane, number>) {
    for (const [plane, s] of Object.entries(this.slices) as [Plane, SliceLayer][]) s.setOffset(offsets[plane]);
    this.requestRender();
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

  /** Colour the depth shell with its (theta, phi) grid. */
  setShell(grid: ShellGrid | null, range: [number, number], lut: LutName) {
    this.shell.setGrid(grid, range, lut);
    this.requestRender();
  }

  /** Flow or field lines (physics coordinates), or null to hide them. */
  setLines(kind: 'flow' | 'field', p: { points: Float32Array; offsets: Uint32Array } | null) {
    (kind === 'flow' ? this.flowLines : this.fieldLines).set(p);
    this.requestRender();
  }

  /** Dim a kind of lines while newer ones are on their way. */
  setLinesDimmed(kind: 'flow' | 'field', dim: boolean) {
    (kind === 'flow' ? this.flowLines : this.fieldLines).setDimmed(dim);
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
    this.labels.imf = label('IMF', PALETTE.imf, 1.3);
    this.labels.qpar = label('Q∥', PALETTE.qpar, 1.5);
    this.labels.qperp = label('Q⊥', PALETTE.qperp, 1.5);
    Object.values(this.labels).forEach((l) => s.add(l));
    this.imfGhost.line.material = new THREE.LineBasicMaterial({ color: PALETTE.imf, transparent: true, opacity: 0.35 });
    (this.imfGhost.cone.material as THREE.MeshBasicMaterial).transparent = true;
    (this.imfGhost.cone.material as THREE.MeshBasicMaterial).opacity = 0.35;
    s.add(this.imf, this.imfGhost);
  }

  private shellD = NaN;
  private buildShell(dMsh: number) {
    if (!this.lastShape) return;
    this.shell.setShape(this.lastShape[0], this.lastShape[1], dMsh);
    this.shellD = dMsh;
  }

  private axisLabels: THREE.Sprite[] = [];
  private axisFrame = '';
  private setAxisLabels(frame: FrameName) {
    if (frame === this.axisFrame) return;
    this.axisFrame = frame;
    for (const l of this.axisLabels) { this.scene.remove(l); l.material.map?.dispose(); l.material.dispose(); }
    const make = (text: string, x: number, y: number, z: number) => { const l = label(text, PALETTE.fg, 1.3); l.position.set(x, y, z); this.scene.add(l); return l; };
    this.axisLabels = [
      make(`+X ${frame} · Sun`, 28, 0, 0),
      make(frame === 'GSM' ? '+Y GSM · dusk' : '+Y PGSM', 0, 0, -18),
      make(`+Z ${frame}`, 0, 18.5, 0),
    ];
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
    this.shellD = NaN;  // rebuilt on the next update
  }

  update(p: SceneInputs) {
    if (!this.lastShape || this.lastShape[0] !== p.rMp || this.lastShape[1] !== p.rBs) {
      this.buildBoundaries(p.rMp, p.rBs);
      this.lastShape = [p.rMp, p.rBs];
      this.shellD = NaN;  // the shell sits between the boundaries: rebuild it too
    }
    this.setAxisLabels(p.frame);
    this.mp!.visible = p.showMp;
    this.bs!.visible = p.showBs;
    if (p.shells && p.shellD !== this.shellD) this.buildShell(p.shellD);
    this.shell.group.visible = p.shells;

    this.rotating.rotation.x = clockRotationX(p.rotationDeg);
    for (const s of Object.values(this.slices)) s.setClock(p.rotationDeg);
    // the IMF arrows, the tint and the Q∥/Q⊥ labels are not in `rotating`: already in display coordinates
    const show = p.imfClockDeg !== null;
    const b = toThree(imfDirection(p.imfClockDeg ?? 0, p.imfCone.cone)).normalize();
    this.imf.visible = this.labels.imf.visible = show;
    this.imf.setDirection(b);
    this.imfGhost.visible = show && p.imfCone.ghost !== null;
    if (p.imfCone.ghost !== null) this.imfGhost.setDirection(toThree(imfDirection(p.imfClockDeg ?? 0, p.imfCone.ghost)).normalize());
    this.labels.imf.position.copy(new THREE.Vector3(21, 0, 0).add(b.clone().multiplyScalar(8.4)));
    const tint = p.tint && show;
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
