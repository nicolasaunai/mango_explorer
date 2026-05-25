import * as bridge from './pyodide-bridge.js';
import * as THREE from 'three';
import { createScene } from './scene/scene.js';
import { makeBoundaryMesh } from './scene/boundaries.js';
import { makeEventMeshes } from './scene/events.js';
import { SliceLayer } from './scene/slice.js';
import { showPopup, hidePopup } from './ui/popup.js';
import { buildSidebar } from './ui/sidebar.js';

function asFloat32(a) { return a instanceof Float32Array ? a : new Float32Array(a.flat ? a.flat(Infinity) : a); }
function asUint32(a)  { return a instanceof Uint32Array  ? a : new Uint32Array(a.flat  ? a.flat(Infinity)  : a); }

const loading = document.getElementById('loading');
loading.textContent = 'Loading Pyodide…';
try {
  await bridge.init(msg => { loading.textContent = msg; });
} catch (e) {
  loading.textContent = '❌ Init failed — see console';
  loading.style.color = '#f66';
  console.error('FULL ERROR:', e.message ?? e);
  throw e;
}
loading.remove();

const { scene, camera, controls } = createScene(document.getElementById('viewport'));

let mpMesh = null, bsMesh = null;
async function rebuildBoundaries(r0) {
  if (mpMesh) scene.remove(mpMesh);
  if (bsMesh) scene.remove(bsMesh);
  const mp = await bridge.buildBoundary('mp', { r0, alpha: 0.6 });
  const bs = await bridge.buildBoundary('bs', { pd: 2.0 });
  mpMesh = makeBoundaryMesh({ positions: asFloat32(mp.positions), indices: asUint32(mp.indices) }, 0x00aaff, 0.12);
  bsMesh = makeBoundaryMesh({ positions: asFloat32(bs.positions), indices: asUint32(bs.indices) }, 0xff6600, 0.08);
  if (state['chk-mp']) scene.add(mpMesh);
  if (state['chk-bs']) scene.add(bsMesh);
}

let eventMeshes = [];
async function rebuildEvents(missions) {
  eventMeshes.forEach(m => scene.remove(m));
  const evs = await bridge.buildEvents(missions);
  eventMeshes = makeEventMeshes(evs);
  eventMeshes.forEach(m => scene.add(m));
}

const slice = new SliceLayer(scene, 25, 128);
async function refreshSlice() {
  const out = await bridge.buildSlice({
    plane: state.plane, position: state.position, variable: 'Np',
    extent: 25, n: 128, slab: 2.0,
    filters: { ma_sw_min: state.machMin, ma_sw_max: state.machMax },
  });
  slice.setPlane(state.plane, state.position);
  slice.updateData(out.rgba);
}

const state = {
  'chk-mp': true, 'chk-bs': true,
  'chk-mms': true, 'chk-themis': true, 'chk-cluster': true,
  'chk-slice': false,
  r0: 10.5, position: 0.0, opacity: 0.8,
  plane: 'xy', machMin: 1.0, machMax: 10.0,
};

function currentMissions() {
  const ms = [];
  if (state['chk-mms']) ms.push('MMS');
  if (state['chk-themis']) ms.push('THEMIS');
  if (state['chk-cluster']) ms.push('Cluster');
  return ms;
}

await rebuildBoundaries(state.r0);
await rebuildEvents(currentMissions());

buildSidebar(document.getElementById('sidebar'), state, async (key, val) => {
  if (key === 'chk-mp') { if (val) scene.add(mpMesh); else scene.remove(mpMesh); }
  else if (key === 'chk-bs') { if (val) scene.add(bsMesh); else scene.remove(bsMesh); }
  else if (key === 'r0') await rebuildBoundaries(val);
  else if (key === 'chk-mms' || key === 'chk-themis' || key === 'chk-cluster') {
    await rebuildEvents(currentMissions());
  }
  else if (key === 'chk-slice') { if (val) { slice.show(); await refreshSlice(); } else slice.hide(); }
  else if (key === 'plane' || key === 'position' || key === 'mach') {
    if (state['chk-slice']) await refreshSlice();
  }
  else if (key === 'opacity') slice.setOpacity(val);
  else if (key === 'view') {
    const d = 50;
    if (val === 'xy') camera.position.set(0, 0, d);
    if (val === 'xz') camera.position.set(0, -d, 0);
    if (val === 'yz') camera.position.set(d, 0, 0);
    controls.target.set(0, 0, 0); controls.update();
  }
});

const raycaster = new THREE.Raycaster();
const mouse = new THREE.Vector2();
document.querySelector('#viewport canvas').addEventListener('click', (e) => {
  const rect = e.target.getBoundingClientRect();
  mouse.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
  mouse.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
  raycaster.setFromCamera(mouse, camera);
  const hits = raycaster.intersectObjects(eventMeshes);
  if (hits.length) showPopup(hits[0].object.userData);
  else hidePopup();
});
