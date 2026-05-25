export function buildSidebar(root, state, onChange) {
  root.innerHTML = `
    <h1 style="color:#ffaa00;font-size:12px;letter-spacing:2px;margin-bottom:20px;">🥭 MANGO EXPLORER</h1>
    <h2>Boundaries</h2>
    <label><input type="checkbox" id="chk-mp" checked> Magnetopause</label><br>
    <label><input type="checkbox" id="chk-bs" checked> Bow Shock</label>
    <div style="margin:10px 0;">
      r₀: <span id="r0-val">10.5</span> RE
      <input type="range" id="r0" min="6" max="14" step="0.5" value="10.5" style="width:100%">
    </div>

    <h2>Catalogues</h2>
    <label><input type="checkbox" id="chk-mms" checked> MMS</label><br>
    <label><input type="checkbox" id="chk-themis" checked> THEMIS</label><br>
    <label><input type="checkbox" id="chk-cluster" checked> Cluster</label>

    <h2>Density slice</h2>
    <label><input type="checkbox" id="chk-slice"> Show plane</label>
    <div>
      <button data-plane="xy">XY</button>
      <button data-plane="xz">XZ</button>
      <button data-plane="yz">YZ</button>
    </div>
    <div>
      pos: <span id="pos-val">0.0</span>
      <input type="range" id="pos" min="-15" max="15" step="0.5" value="0" style="width:100%">
    </div>
    <div>
      opacity: <span id="op-val">0.8</span>
      <input type="range" id="op" min="0.1" max="1" step="0.05" value="0.8" style="width:100%">
    </div>

    <h2>Solar wind Mach</h2>
    <div>
      min <span id="m-min-val">1.0</span> – max <span id="m-max-val">10.0</span>
      <input type="range" id="m-min" min="1" max="10" step="0.5" value="1" style="width:100%">
      <input type="range" id="m-max" min="1" max="10" step="0.5" value="10" style="width:100%">
    </div>

    <h2>Camera</h2>
    <div>
      <button data-view="xy">X-Y</button>
      <button data-view="xz">X-Z</button>
      <button data-view="yz">Y-Z</button>
    </div>
  `;

  const debounce = (fn, ms = 50) => {
    let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
  };

  const wire = (id, event, get, key) => {
    const el = root.querySelector(`#${id}`);
    el.addEventListener(event, () => { state[key] = get(el); onChange(key, state[key]); });
  };

  ['chk-mp','chk-bs','chk-mms','chk-themis','chk-cluster','chk-slice'].forEach(id => {
    wire(id, 'change', e => e.checked, id);
  });

  root.querySelector('#r0').addEventListener('input', e => {
    root.querySelector('#r0-val').textContent = e.target.value;
  });
  root.querySelector('#r0').addEventListener('change', e => {
    state.r0 = parseFloat(e.target.value); onChange('r0', state.r0);
  });

  root.querySelector('#pos').addEventListener('input', e => {
    root.querySelector('#pos-val').textContent = e.target.value;
  });
  root.querySelector('#pos').addEventListener('change', e => {
    state.position = parseFloat(e.target.value); onChange('position', state.position);
  });

  root.querySelector('#op').addEventListener('input', e => {
    state.opacity = parseFloat(e.target.value);
    root.querySelector('#op-val').textContent = e.target.value;
    onChange('opacity', state.opacity);
  });

  const mMin = root.querySelector('#m-min');
  const mMax = root.querySelector('#m-max');
  function updateMachLabels() {
    root.querySelector('#m-min-val').textContent = mMin.value;
    root.querySelector('#m-max-val').textContent = mMax.value;
  }
  mMin.addEventListener('input', updateMachLabels);
  mMax.addEventListener('input', updateMachLabels);
  const commitMach = debounce(() => {
    let a = parseFloat(mMin.value), b = parseFloat(mMax.value);
    if (a > b) [a, b] = [b, a];
    state.machMin = a; state.machMax = b;
    onChange('mach', { min: a, max: b });
  }, 50);
  mMin.addEventListener('change', commitMach);
  mMax.addEventListener('change', commitMach);

  root.querySelectorAll('[data-plane]').forEach(btn => {
    btn.addEventListener('click', () => {
      state.plane = btn.dataset.plane;
      onChange('plane', state.plane);
    });
  });

  root.querySelectorAll('[data-view]').forEach(btn => {
    btn.addEventListener('click', () => onChange('view', btn.dataset.view));
  });
}
