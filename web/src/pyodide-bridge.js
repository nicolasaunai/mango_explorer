import { loadPyodide } from 'pyodide';

let py = null;

export async function init() {
  py = await loadPyodide({
    indexURL: 'https://cdn.jsdelivr.net/pyodide/v0.26.4/full/',
  });
  await py.loadPackage(['numpy', 'polars', 'micropip']);
  const wheels = await fetch('./wheels/index.json').then(r => r.json());
  await py.runPythonAsync(`
import micropip
await micropip.install('${wheels.url}')
import mango_explorer
from mango_explorer import config, explorer
config.use_source('fake', seed=42, n_points=50000)
`);
}

export async function buildBoundary(name, params = {}) {
  py.globals.set('_params', py.toPy(params));
  const proxy = await py.runPythonAsync(`explorer.build_boundary('${name}', **_params)`);
  const out = proxy.toJs({ dict_converter: Object.fromEntries });
  proxy.destroy();
  return out;
}

export async function buildSlice(params) {
  py.globals.set('_params', py.toPy(params));
  const proxy = await py.runPythonAsync(`explorer.build_slice(**_params)`);
  const out = proxy.toJs({ dict_converter: Object.fromEntries });
  proxy.destroy();
  return out;
}

export async function buildEvents(missions = null) {
  py.globals.set('_missions', py.toPy(missions));
  const proxy = await py.runPythonAsync(`explorer.build_events(missions=_missions)`);
  const out = proxy.toJs({ dict_converter: Object.fromEntries });
  proxy.destroy();
  return out;
}
