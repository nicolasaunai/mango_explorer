import * as THREE from 'three';

const MISSION_COLOR = { MMS: 0xff4444, THEMIS: 0x44ff44, Cluster: 0xffff44 };

export function makeEventMeshes({ positions, meta }) {
  const meshes = [];
  // positions is a flat Float32Array of length 3*N (or nested rows); normalize:
  let posArr;
  if (positions instanceof Float32Array) posArr = positions;
  else if (Array.isArray(positions) && Array.isArray(positions[0])) {
    posArr = new Float32Array(positions.flat());
  } else {
    posArr = new Float32Array(positions);
  }
  const n = meta.length;
  for (let i = 0; i < n; i++) {
    const m = new THREE.Mesh(
      new THREE.SphereGeometry(0.3, 16, 16),
      new THREE.MeshBasicMaterial({ color: MISSION_COLOR[meta[i].mission] ?? 0xffffff })
    );
    m.position.set(posArr[i*3], posArr[i*3+1], posArr[i*3+2]);
    m.userData = meta[i];
    meshes.push(m);
  }
  return meshes;
}
