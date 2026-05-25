import * as THREE from 'three';

export class SliceLayer {
  constructor(scene, extent = 25, n = 256) {
    this.scene = scene;
    this.extent = extent;
    this.n = n;
    this.texture = new THREE.DataTexture(
      new Uint8Array(n * n * 4), n, n, THREE.RGBAFormat
    );
    this.texture.needsUpdate = true;
    const geo = new THREE.PlaneGeometry(extent * 2, extent * 2);
    const mat = new THREE.MeshBasicMaterial({
      map: this.texture, transparent: true, opacity: 0.8,
      side: THREE.DoubleSide, depthWrite: false,
    });
    this.mesh = new THREE.Mesh(geo, mat);
  }
  show() { this.scene.add(this.mesh); }
  hide() { this.scene.remove(this.mesh); }
  setOpacity(a) { this.mesh.material.opacity = a; }
  setPlane(plane, position) {
    this.mesh.rotation.set(0, 0, 0);
    this.mesh.position.set(0, 0, 0);
    if (plane === 'xy') this.mesh.position.z = position;
    else if (plane === 'xz') { this.mesh.rotation.x = -Math.PI / 2; this.mesh.position.y = position; }
    else { this.mesh.rotation.y = Math.PI / 2; this.mesh.position.x = position; }
  }
  updateData(rgbaFloat32) {
    const flat = rgbaFloat32 instanceof Float32Array
      ? rgbaFloat32
      : new Float32Array(rgbaFloat32.flat ? rgbaFloat32.flat(Infinity) : rgbaFloat32);
    const u8 = this.texture.image.data;
    for (let i = 0; i < u8.length; i++) {
      u8[i] = Math.max(0, Math.min(255, Math.round(flat[i] * 255)));
    }
    this.texture.needsUpdate = true;
  }
}
