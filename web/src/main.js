import * as bridge from './pyodide-bridge.js';
import { createScene } from './scene/scene.js';
import { makeBoundaryMesh } from './scene/boundaries.js';

const loading = document.getElementById('loading');
loading.textContent = 'Loading Pyodide…';
await bridge.init();
loading.remove();

const { scene } = createScene(document.getElementById('viewport'));
const mp = await bridge.buildBoundary('mp', { r0: 10.5, alpha: 0.6 });
const bs = await bridge.buildBoundary('bs', { pd: 2.0 });

// positions/indices may come from Pyodide as nested arrays or typed arrays
// after dict_converter; flatten if needed.
function asFloat32(a) { return a instanceof Float32Array ? a : new Float32Array(a.flat ? a.flat(Infinity) : a); }
function asUint32(a)  { return a instanceof Uint32Array  ? a : new Uint32Array(a.flat  ? a.flat(Infinity)  : a); }

scene.add(makeBoundaryMesh({ positions: asFloat32(mp.positions), indices: asUint32(mp.indices) }, 0x00aaff, 0.12));
scene.add(makeBoundaryMesh({ positions: asFloat32(bs.positions), indices: asUint32(bs.indices) }, 0xff6600, 0.08));
