import * as bridge from './pyodide-bridge.js';

const loading = document.getElementById('loading');
loading.textContent = 'Loading Pyodide…';
await bridge.init();
loading.textContent = 'Building boundary…';
const mp = await bridge.buildBoundary('mp', { r0: 10.5, alpha: 0.6 });
const nVerts = mp.positions.length / 3;
loading.textContent = `MP mesh: ${nVerts} vertices`;
console.log('MP mesh', mp);
