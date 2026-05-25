import { loadPyodide } from 'pyodide';

let py = null;

export async function init(onStatus = () => {}) {
  onStatus('Loading Pyodide runtime…');
  py = await loadPyodide({
    indexURL: 'https://cdn.jsdelivr.net/pyodide/v0.26.4/full/',
  });
  onStatus('Installing numpy + micropip…');
  await py.loadPackage(['numpy', 'micropip']);
  onStatus('Fetching wheel index…');
  const wheels = await fetch('./wheels/index.json').then(r => r.json());
  onStatus('Installing mango_explorer…');
  await py.runPythonAsync(`await micropip.install('${wheels.url}')`);
  onStatus('Initialising data source…');
  await py.runPythonAsync(`
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
