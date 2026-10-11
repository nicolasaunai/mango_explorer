// Flow or field lines in 3D: thin polylines with small arrowheads showing the direction, and dots on the seeds
// when they sit on a plane.
import * as THREE from 'three';

const ARROW_EVERY = 30;  // points between arrowheads (3 R_E at 0.1 R_E steps)
const UP = new THREE.Vector3(0, 1, 0);
const OPACITY = { line: 0.85, arrow: 1, dimmed: 0.3 };

export class LinesLayer {
  readonly group = new THREE.Group();
  private lines: THREE.LineSegments;
  private arrows: THREE.InstancedMesh | null = null;
  private cone = new THREE.ConeGeometry(0.18, 0.55, 8);
  private lineMaterial: THREE.LineBasicMaterial;
  private arrowMaterial: THREE.MeshBasicMaterial;
  private seeds: THREE.Points;
  private seedMaterial: THREE.PointsMaterial;

  constructor(color: string) {
    this.lineMaterial = new THREE.LineBasicMaterial({ color, transparent: true, opacity: OPACITY.line });
    this.lines = new THREE.LineSegments(new THREE.BufferGeometry(), this.lineMaterial);
    this.arrowMaterial = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: OPACITY.arrow });
    this.seedMaterial = new THREE.PointsMaterial({ color, size: 3, sizeAttenuation: false, transparent: true, opacity: OPACITY.line });
    this.seeds = new THREE.Points(new THREE.BufferGeometry(), this.seedMaterial);
    this.group.add(this.lines, this.seeds);
    this.group.visible = false;
  }

  /** Dim the lines while newer ones are being computed. */
  setDimmed(dim: boolean) {
    this.lineMaterial.opacity = dim ? OPACITY.dimmed : OPACITY.line;
    this.arrowMaterial.opacity = dim ? OPACITY.dimmed : OPACITY.arrow;
    this.seedMaterial.opacity = dim ? OPACITY.dimmed : OPACITY.line;
  }

  /** Polylines in physics coordinates (X, Y, Z), and their seeds when dotted (may be empty); null hides the layer. */
  set(p: { points: Float32Array; offsets: Uint32Array; seeds?: Float32Array } | null) {
    if (!p) { this.group.visible = false; return; }
    const three = (i: number) => new THREE.Vector3(p.points[3 * i], p.points[3 * i + 2], -p.points[3 * i + 1]);
    const seg: number[] = [], heads: { at: THREE.Vector3; dir: THREE.Vector3 }[] = [];
    for (let l = 0; l + 1 < p.offsets.length; l++)
      for (let i = p.offsets[l]; i + 1 < p.offsets[l + 1]; i++) {
        const a = three(i), b = three(i + 1);
        seg.push(a.x, a.y, a.z, b.x, b.y, b.z);
        if ((i - p.offsets[l]) % ARROW_EVERY === ARROW_EVERY / 2) heads.push({ at: b, dir: b.clone().sub(a).normalize() });
      }
    this.lines.geometry.dispose();
    this.lines.geometry = new THREE.BufferGeometry();
    this.lines.geometry.setAttribute('position', new THREE.Float32BufferAttribute(seg, 3));
    const dots: number[] = [], seeds = p.seeds ?? new Float32Array();
    for (let i = 0; 3 * i < seeds.length; i++) dots.push(seeds[3 * i], seeds[3 * i + 2], -seeds[3 * i + 1]);
    this.seeds.geometry.dispose();
    this.seeds.geometry = new THREE.BufferGeometry();
    this.seeds.geometry.setAttribute('position', new THREE.Float32BufferAttribute(dots, 3));
    if (this.arrows) { this.group.remove(this.arrows); this.arrows.dispose(); }
    this.arrows = new THREE.InstancedMesh(this.cone, this.arrowMaterial, Math.max(1, heads.length));
    this.arrows.count = heads.length;
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), one = new THREE.Vector3(1, 1, 1);
    heads.forEach((h, i) => this.arrows!.setMatrixAt(i, m.compose(h.at, q.setFromUnitVectors(UP, h.dir), one)));
    this.arrows.instanceMatrix.needsUpdate = true;
    this.group.add(this.arrows);
    this.group.visible = true;
  }
}
