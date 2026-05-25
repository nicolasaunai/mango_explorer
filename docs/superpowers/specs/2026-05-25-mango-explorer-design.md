# MANGO Explorer — Design Document

**Date:** 2026-05-25
**Status:** Approved (brainstorming) — POC scope, fake MANGO data source
**Author:** Nicolas Aunai (LPP)

## 1. Context and goals

The repo currently holds only standalone HTML/Three.js prototypes under `old/`. The most advanced, `old/mach.html`, demonstrates a desired UX: a 3D magnetosphere viewer with Shue magnetopause, scaled-Shue bow shock, a density slice plane with Mach-number-range averaging, and clickable event spheres from synthetic MMS/THEMIS/Cluster catalogs with DOI popups.

The goal is to rebuild this prototype as:

1. A proper Python package, `mango_explorer`, holding all physics (boundary models) and visualization data preparation (gridding, colormaps).
2. A Pyodide-based static web app: the package runs client-side in the browser; Three.js owns the WebGL render loop.

Eventually the package will be backed by the real [`space-mango`](https://github.com/laboratoryofplasmaphysics/mango) library. For this design, real integration is **postponed** because the public MANGO server lacks HTTPS and CORS headers. The POC uses a faked data source that mimics the real `space-mango` API surface, so the swap to the real source later is a one-line change.

## 2. Architectural decisions

### 2.1 Pyodide-only, no own backend

The Python package runs entirely in the user's browser via Pyodide. There is no backend that we operate. The future real data source will be the public MANGO server (once HTTPS+CORS land); the POC source generates data locally in Python.

### 2.2 Three.js owns the render loop

The per-frame render loop is pure WebGL/Three.js. Python is invoked only on discrete user actions (slider release, button click), produces typed arrays (Float32 for positions/colors, Uint32 for indices), and hands them to Three.js for GPU upload. Sliders fire their `input` event for label updates only; the actual Python call fires on `change` with a short debounce. Opacity is a pure JS uniform update.

Target: a slider release that rebuilds a 256² slice from ~50 000 scattered points completes in under 200 ms wall time.

### 2.3 Package surface mirrors `space-mango` exactly

Our `mango_explorer.data` subpackage exposes the same four-function surface as `space_mango`:

```python
regions() -> list[str]
filters(region: str) -> list[dict]
columns(region: str) -> list[str]
get_data(region: str, **kwargs) -> polars.DataFrame
```

Filter kwargs follow the `<name>_min` / `<name>_max` convention. Returned DataFrames carry the same column names as the real MANGO data: `Time`, `spacecraft`, raw GSM coords `X_gsm`/`Y_gsm`/`Z_gsm`, normalized scalar `D_msh`, local plasma `Np`/`Tp`/`Bz`, and upstream SW context `Bx_imf`, `By_imf`, `Bz_imf`, `Pd_sw`, `Np_sw`, `Tp_sw`, `Vx_sw`, `Beta_sw`, `Ma_sw`, `Tilt`.

### 2.4 Boundary models live in our package

`space-mango` has no callable boundary models — it only stores normalized coordinates. Our package owns:

- **Shue+1998 magnetopause:** `r(θ) = r₀ · (2 / (1 + cos θ))^α`, with `r₀(Bz, Pd)` and `α(Bz, Pd)` per the original paper. UI exposes `r₀` directly; advanced mode can compute `r₀, α` from `Bz_imf` and `Pd_sw`.
- **Jelínek+2012 bow shock:** the published parametric form as a function of `Pd_sw`. Replaces the toy `1.35 × MP` scaling in `mach.html`.

### 2.5 Gridding lives in our package

Slice planes are built from scattered point clouds returned by `get_data`. Gridding is a weighted `numpy.histogram2d` (mean of the chosen variable per bin) over the points within a thin slab around the slice plane. NaN bins (empty or outside the magnetosheath shell) are masked. Pyodide's numpy is sufficient; no scipy required for the POC.

### 2.6 Deployment target: GitHub Pages

Single static artifact (`dist/`) pushed to a `gh-pages` branch. No serverless functions, no backend. This is consistent with the Pyodide-only choice and forces us to keep the bundle self-contained.

## 3. Package layout

```
mango_explorer/
├─ pyproject.toml                 hatchling build, uv-managed
├─ src/mango_explorer/
│   ├─ __init__.py
│   ├─ boundaries.py              shue_mp(theta, r0, alpha)
│   │                             jelinek_bs(theta, pdyn, ...)
│   │                             tessellate_surface(r_of_theta, n_theta, n_phi) -> (positions, indices)
│   ├─ gridding.py                bin_scattered_2d(df, plane, position, variable, extent, n)
│   │                                 -> (grid: np.ndarray[n,n], mask: np.ndarray[n,n])
│   ├─ colormap.py                to_rgba(values, vmin, vmax, mask, name="viridis")
│   │                                 -> np.ndarray[n,n,4] Float32
│   │                             colorbar_info(vmin, vmax, n_ticks)
│   ├─ data/
│   │   ├─ __init__.py            re-exports active source's regions/filters/columns/get_data
│   │   ├─ base.py                Source ABC with the 4-method surface
│   │   ├─ fake.py                FakeSource (POC)
│   │   └─ remote.py              RemoteSource — stub, raises NotImplementedError
│   ├─ config.py                  use_source("fake" | "remote"), active source
│   └─ explorer.py                build_slice(...), build_events(...), build_boundary(...)
│                                 — high-level functions JS calls
├─ tests/                         pytest, CPython
│   ├─ test_boundaries.py
│   ├─ test_gridding.py
│   ├─ test_fake_source.py
│   ├─ test_colormap.py
│   └─ test_explorer.py
└─ web/                           Vite app
    ├─ index.html
    ├─ vite.config.js
    ├─ public/                    Pyodide assets, mango_explorer wheel
    └─ src/
        ├─ main.js                Three.js scene, UI wiring
        ├─ pyodide-bridge.js      load Pyodide, install wheel, call explorer.*
        ├─ ui/                    sidebar, popup, colorbar
        └─ scene/                 boundaries, slice, events, camera presets
```

Two invariants:

- The Python package must run in plain CPython for tests (no Pyodide-only dependencies).
- The `data/` subpackage exposes exactly the `space-mango` 4-function surface; swapping `use_source("fake")` for `"remote"` is the only change needed when the real integration lands.

## 4. Component details

### 4.1 `boundaries`

Pure functions of angles (and physics inputs). The tessellator returns mesh-ready arrays so JS does no geometry computation. Default tessellation: 64 meridians × 50 polar samples for surfaces; 12 meridian wires for the wireframe overlay matching `mach.html`'s look.

### 4.2 `gridding.bin_scattered_2d`

Inputs: the DataFrame from `get_data`, the plane (`"xy"`/`"xz"`/`"yz"`), the slice position along the perpendicular axis, the variable to bin (default `Np`), spatial extent (default ±25 RE), grid resolution (default 256).

Steps: filter points within a configurable slab thickness around the slice (default ±1 RE), compute per-bin mean of the chosen variable via two `np.histogram2d` calls (one for sum, one for count), produce `(grid, mask)` where `mask` is True for bins with at least one point.

### 4.3 `colormap.to_rgba`

Maps a 2D float array to an `(n, n, 4)` Float32 RGBA array using a viridis-like ramp implemented as table lookup (no matplotlib dep — keeps the wheel small). Masked bins receive `alpha = 0`.

### 4.4 `data.fake.FakeSource`

Deterministic generator (fixed seed). Produces ~50 000 scattered points in the magnetosheath shell between Shue MP and Jelínek BS, volume-uniform with a density enhancement near the subsolar point. Each point carries:

- `Time` (synthetic, spread across 2015–2024), `spacecraft` from {MMS1, THA, C1}.
- `X_gsm`, `Y_gsm`, `Z_gsm`, `D_msh ∈ [0, 1]`.
- `Ma_sw ~ LogNormal(μ=2, σ=0.3)` clipped to [1, 12]; `Pd_sw` correlated with `Ma_sw`; `Bz_imf ~ Normal(0, 4)` nT independent; `Np_sw`, `Tp_sw`, `Vx_sw`, `Beta_sw`, `Tilt` drawn from physically plausible distributions.
- Local `Np` computed from the same Rankine-Hugoniot × stagnation × angular formula as `mach.html`, evaluated at each point's `Ma_sw` and `D_msh` — so when the UI filters on `ma_sw_min`/`ma_sw_max` the slice colormap visibly changes, exactly as in the prototype but driven by filtered data rather than model averaging.

Filter implementation: for each `<name>_min`/`<name>_max` kwarg, filter the DataFrame on the corresponding column. Filter catalog (`filters()`) returned in the same dict shape as the real MANGO server: `{name, column, unit, description, params}`.

Event catalog: ~60 events across MMS/THEMIS/Cluster, placed near MP and BS with realistic clustering. Each event carries `id`, `mission`, `date`, `type` (FTE/EDR/Jet/Current Sheet/KH Wave/Mirror Mode), GSM coords, and a DOI taken from the same `papers` table that `mach.html` already encodes. Exposed via `get_data("events", ...)`. The real MANGO server has no `events` region today; this is a POC-only extension and will be reconsidered when the real source is wired in.

### 4.5 `data.remote.RemoteSource`

Stub for now: all four methods raise `NotImplementedError`. When the deployment blockers clear, this module will implement the four methods using `pyodide.http.pyfetch` against the MANGO server, decoding Arrow IPC with `polars.read_ipc`. `httpx`-based `MangoClient` is not usable in Pyodide (sync calls in the browser event loop).

### 4.6 `explorer.py`

The three high-level entry points the frontend calls. Each composes `data.get_data → gridding → colormap` (or the boundary tessellator) and returns plain typed arrays plus metadata (`vmin`, `vmax`, colorbar ticks). These are the only functions JS knows about.

## 5. Frontend (Three.js + Vite)

UX is a clean reimplementation of `mach.html`'s sidebar + viewport. Specifically:

- **Sidebar:** boundary toggles (MP, BS); `r₀` slider; mission checkboxes (MMS / THEMIS / Cluster); slice plane (XY / XZ / YZ) + position slider + opacity slider; **dual Mach slider that maps to `ma_sw_min`/`ma_sw_max` query filters**; camera presets (X-Y / X-Z / Y-Z views).
- **Viewport:** WebGL canvas, SVG overlay for the popup connector line, popup card with event metadata and DOI link, live colorbar with auto-scaled labels, Mach indicator badge.

### 5.1 Pyodide bridge

`pyodide-bridge.js` loads Pyodide once at startup behind a loading screen, installs the locally-built `mango_explorer` wheel from `public/`, then exposes three async functions: `buildSlice(params)`, `buildEvents(params)`, `buildBoundary(name, params)`. Each marshals JS objects to Python kwargs, awaits the call, and converts the returned arrays to JS typed arrays via `pyodide.ffi.PyProxy.toJs({create_proxies: false})`.

### 5.2 Rebuild flow on slider change

```
slider release
  → JS debounces 50 ms
  → JS calls bridge.buildSlice({plane:"xy", z:0, ma_sw_min:3, ma_sw_max:6, variable:"Np", grid:256})
  → Python: source.get_data("magnetosheath", ma_sw_min=3, ma_sw_max=6)
  → Python: gridding.bin_scattered_2d(df, ...)
  → Python: colormap.to_rgba(...)
  → returned: {rgba: Float32Array, vmin, vmax, ticks}
  → JS: update existing THREE.DataTexture's data; no geometry rebuild
```

The Three.js geometry and texture objects are created once at startup and reused across rebuilds. Only the texture's data array changes.

## 6. Testing

`pytest` against plain CPython (the wheel is pure Python so the same artifact runs in both environments):

- `test_boundaries.py` — Shue and Jelínek values at known angles match published reference points within tolerance; tessellator returns valid mesh topology (no degenerate triangles).
- `test_gridding.py` — a synthetic Dirac point in a known bin produces the expected single non-empty bin; uniform input produces a uniform grid; mask matches the empty bins.
- `test_fake_source.py` — column names match the real `space-mango` set; filters are honored (filtered DataFrame's column range matches the requested `_min`/`_max`); deterministic with the fixed seed.
- `test_colormap.py` — the ramp is monotonic; values at `vmin` and `vmax` hit the endpoints; masked bins get `alpha = 0`.
- `test_explorer.py` — one end-to-end call: `explorer.build_slice(plane="xy", z=0, filters={"ma_sw_min": 3, "ma_sw_max": 6})` returns arrays of the right shape and dtype.

No JS tests for the POC — visual inspection in the browser is sufficient at this stage.

## 7. Out of scope

The following are explicitly deferred from the POC:

- Real MANGO integration (gated on HTTPS + CORS on the MANGO server; `RemoteSource` is a stub).
- Volume rendering, isosurfaces.
- URL state, shareable views.
- Export (PNG, parquet).
- Additional boundary models beyond Shue + Jelínek.
- Pyodide hot-reload tooling — for development, rebuild the wheel and refresh.

## 8. Definition of done for the POC

- `pip install -e .` and `pytest` green in a CPython environment.
- `cd web && npm run dev` opens the app in a browser.
- A user can: toggle MP and BS, drag `r₀` and see surfaces update, enable the slice plane and see a colored density map, drag the dual Mach slider and see the colormap change (because filtering changes the points being binned), switch slice planes, click an event sphere and see its popup with DOI link, use the camera preset buttons.
- A production build (`npm run build`) produces a static `dist/` deployable to GitHub Pages.
