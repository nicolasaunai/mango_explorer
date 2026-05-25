import * as bridge from './pyodide-bridge.js';
import * as THREE from 'three';
import { createScene } from './scene/scene.js';
import { makeBoundaryMesh } from './scene/boundaries.js';
import { makeEventMeshes } from './scene/events.js';
import { showPopup, hidePopup } from './ui/popup.js';

function asFloat32(a) { return a instanceof Float32Array ? a : new Float32Array(a.flat ? a.flat(Infinity) : a); }
function asUint32(a)  { return a instanceof Uint32Array  ? a : new Uint32Array(a.flat  ? a.flat(Infinity)  : a); }

const loading = document.getElementById('loading');
loading.textContent = 'Loading Pyodide…';
await bridge.init();
loading.remove();

const { scene, camera } = createScene(document.getElementById('viewport'));

const mp = await bridge.buildBoundary('mp', { r0: 10.5, alpha: 0.6 });
const bs = await bridge.buildBoundary('bs', { pd: 2.0 });
scene.add(makeBoundaryMesh({ positions: asFloat32(mp.positions), indices: asUint32(mp.indices) }, 0x00aaff, 0.12));
scene.add(makeBoundaryMesh({ positions: asFloat32(bs.positions), indices: asUint32(bs.indices) }, 0xff6600, 0.08));

const events = await bridge.buildEvents();
const eventMeshes = makeEventMeshes(events);
eventMeshes.forEach(m => scene.add(m));

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
