# MANGO Explorer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a POC of `mango_explorer` — a Python package (boundary models, gridding, colormap, fake MANGO source) plus a Pyodide+Three.js static web app, deployable to GitHub Pages, that reproduces the UX of `old/mach.html` driven by a faked MANGO data source whose API mirrors the real `space-mango` library.

**Architecture:** Pyodide-only. The browser loads a Vite-built static bundle that includes Pyodide and our Python wheel. Three.js owns the WebGL render loop; Python is invoked only on slider-release / button-click and returns Float32/Uint32 arrays for GPU upload. The Python package exposes a `regions/filters/columns/get_data` surface identical to `space-mango`, backed by a deterministic fake source for the POC and a stub remote source for the future real integration.

**Tech Stack:** Python 3.11+, numpy, polars, pytest, ruff, hatchling, uv. Three.js 0.160, Vite 5, Pyodide 0.26+.

**Reference:** Design spec at `docs/superpowers/specs/2026-05-25-mango-explorer-design.md`. UX reference at `old/mach.html` (do not copy code; reimplement).

---

## File map

Python package:
- Create `pyproject.toml`, `.gitignore`, `README.md`
- Create `src/mango_explorer/__init__.py`
- Create `src/mango_explorer/boundaries.py` — Shue MP, Jelínek BS, surface tessellation
- Create `src/mango_explorer/gridding.py` — `bin_scattered_2d`
- Create `src/mango_explorer/colormap.py` — viridis-like LUT, `to_rgba`, colorbar info
- Create `src/mango_explorer/papers.py` — DOI reference database (lifted from `old/mach.html`)
- Create `src/mango_explorer/config.py` — active-source selector
- Create `src/mango_explorer/data/__init__.py` — re-exports
- Create `src/mango_explorer/data/base.py` — `Source` ABC
- Create `src/mango_explorer/data/fake.py` — `FakeSource`
- Create `src/mango_explorer/data/remote.py` — stub
- Create `src/mango_explorer/explorer.py` — high-level entry points
- Create `tests/conftest.py` + one `test_*.py` per module above

Web app:
- Create `web/package.json`, `web/vite.config.js`, `web/index.html`, `web/.gitignore`
- Create `web/public/wheels/` (built wheel copied here)
- Create `web/src/main.js`
- Create `web/src/pyodide-bridge.js`
- Create `web/src/scene/{boundaries,events,slice,camera}.js`
- Create `web/src/ui/{sidebar,popup,colorbar}.js`
- Create `web/src/styles.css`

CI / deploy:
- Create `.github/workflows/deploy.yml` — build wheel, build Vite bundle, push to `gh-pages`

---

## Phase 0 — Scaffolding

### Task 0.1: Initialize git and Python project skeleton

**Files:**
- Create: `.gitignore`
- Create: `pyproject.toml`
- Create: `README.md`
- Create: `src/mango_explorer/__init__.py`

- [ ] **Step 1: Initialize git**

```bash
cd /Users/nicolasaunai/Documents/code/mango_explorer
git init
git add docs/ old/
git commit -m "chore: import existing docs and old/ prototypes"
```

- [ ] **Step 2: Write `.gitignore`**

```
__pycache__/
*.pyc
.pytest_cache/
.ruff_cache/
.venv/
dist/
build/
*.egg-info/
node_modules/
web/dist/
web/public/wheels/*.whl
.DS_Store
```

- [ ] **Step 3: Write `pyproject.toml`**

```toml
[build-system]
requires = ["hatchling"]
build-backend = "hatchling.build"

[project]
name = "mango_explorer"
version = "0.0.1"
description = "Interactive magnetosphere explorer (POC)"
requires-python = ">=3.11"
authors = [{name = "Nicolas Aunai", email = "nicolas.aunai@lpp.polytechnique.fr"}]
dependencies = [
  "numpy>=1.26",
  "polars>=1.0",
]

[project.optional-dependencies]
dev = ["pytest>=8", "ruff>=0.5"]

[tool.hatch.build.targets.wheel]
packages = ["src/mango_explorer"]

[tool.ruff]
line-length = 100
target-version = "py311"

[tool.pytest.ini_options]
testpaths = ["tests"]
```

- [ ] **Step 4: Write `src/mango_explorer/__init__.py`**

```python
"""mango_explorer — interactive magnetosphere viewer."""

__version__ = "0.0.1"
```

- [ ] **Step 5: Write a minimal `README.md`**

```markdown
# mango_explorer

POC magnetosphere viewer. Python package + Pyodide web app.

See `docs/superpowers/specs/2026-05-25-mango-explorer-design.md` for the design.

## Install (dev)

```bash
uv venv && source .venv/bin/activate
uv pip install -e ".[dev]"
pytest
```
```

- [ ] **Step 6: Set up the venv and verify install**

```bash
uv venv && source .venv/bin/activate
uv pip install -e ".[dev]"
python -c "import mango_explorer; print(mango_explorer.__version__)"
```
Expected output: `0.0.1`

- [ ] **Step 7: Commit**

```bash
git add .gitignore pyproject.toml README.md src/
git commit -m "chore: scaffold mango_explorer Python package"
```

---

## Phase 1 — Boundary models

### Task 1.1: Shue+1998 magnetopause — direct form

**Files:**
- Create: `src/mango_explorer/boundaries.py`
- Create: `tests/test_boundaries.py`

- [ ] **Step 1: Write the failing test**

```python
# tests/test_boundaries.py
import math
import numpy as np
import pytest
from mango_explorer.boundaries import shue_mp


def test_shue_mp_subsolar_returns_r0():
    # At theta=0, r = r0 * (2/2)^alpha = r0
    assert shue_mp(theta=0.0, r0=10.5, alpha=0.6) == pytest.approx(10.5)


def test_shue_mp_terminator():
    # At theta=pi/2, r = r0 * 2^alpha
    r0, alpha = 10.5, 0.6
    expected = r0 * (2.0 ** alpha)
    assert shue_mp(theta=math.pi / 2, r0=r0, alpha=alpha) == pytest.approx(expected)


def test_shue_mp_vectorized():
    theta = np.linspace(0, math.pi * 0.85, 50)
    r = shue_mp(theta, r0=10.5, alpha=0.6)
    assert r.shape == theta.shape
    # Monotone increasing with theta in [0, pi*0.85]
    assert np.all(np.diff(r) >= -1e-9)
```

- [ ] **Step 2: Run the test, expect failure**

Run: `pytest tests/test_boundaries.py -v`
Expected: ImportError (`shue_mp` doesn't exist).

- [ ] **Step 3: Implement `shue_mp`**

```python
# src/mango_explorer/boundaries.py
"""Magnetopause and bow-shock boundary models."""
from __future__ import annotations

import numpy as np


def shue_mp(theta, r0: float, alpha: float):
    """Shue+1998 magnetopause: r(theta) = r0 * (2/(1+cos theta))**alpha.

    theta : float or ndarray, radians, 0 = subsolar.
    r0    : subsolar standoff distance (RE).
    alpha : flaring exponent.
    """
    theta = np.asarray(theta, dtype=float)
    return r0 * (2.0 / (1.0 + np.cos(theta))) ** alpha
```

- [ ] **Step 4: Run the test, expect pass**

Run: `pytest tests/test_boundaries.py -v`
Expected: 3 passed.

- [ ] **Step 5: Commit**

```bash
git add src/mango_explorer/boundaries.py tests/test_boundaries.py
git commit -m "feat(boundaries): Shue+1998 magnetopause direct form"
```

### Task 1.2: Shue+1998 — r0, alpha as functions of Bz_imf and Pd_sw

**Files:**
- Modify: `src/mango_explorer/boundaries.py`
- Modify: `tests/test_boundaries.py`

- [ ] **Step 1: Add failing tests**

Append to `tests/test_boundaries.py`:

```python
from mango_explorer.boundaries import shue_r0, shue_alpha


def test_shue_r0_nominal_solar_wind():
    # Bz=0 nT, Pd=2 nPa: r0 ~ 10.22 * (1 + tanh-term) * 2^(-1/6.6)
    r0 = shue_r0(bz=0.0, pd=2.0)
    assert 9.5 < r0 < 11.5


def test_shue_alpha_negative_bz_decreases_r0_increases_alpha():
    r0_pos = shue_r0(bz=5.0, pd=2.0)
    r0_neg = shue_r0(bz=-5.0, pd=2.0)
    assert r0_neg < r0_pos  # southward IMF → MP closer
    a_pos = shue_alpha(bz=5.0, pd=2.0)
    a_neg = shue_alpha(bz=-5.0, pd=2.0)
    assert a_neg > a_pos  # more flared under southward IMF
```

- [ ] **Step 2: Run, expect failure**

Run: `pytest tests/test_boundaries.py -v`
Expected: ImportError on `shue_r0`.

- [ ] **Step 3: Implement**

Append to `src/mango_explorer/boundaries.py`:

```python
def shue_r0(bz: float, pd: float) -> float:
    """Shue+1998 subsolar standoff distance (RE).

    bz : IMF Bz (nT), GSM.
    pd : solar wind dynamic pressure (nPa).
    """
    return (10.22 + 1.29 * np.tanh(0.184 * (bz + 8.14))) * pd ** (-1.0 / 6.6)


def shue_alpha(bz: float, pd: float) -> float:
    """Shue+1998 flaring exponent."""
    return (0.58 - 0.007 * bz) * (1.0 + 0.024 * np.log(pd))
```

- [ ] **Step 4: Run, expect pass**

Run: `pytest tests/test_boundaries.py -v`
Expected: 5 passed.

- [ ] **Step 5: Commit**

```bash
git add src/mango_explorer/boundaries.py tests/test_boundaries.py
git commit -m "feat(boundaries): Shue r0(Bz,Pd) and alpha(Bz,Pd)"
```

### Task 1.3: Jelínek+2012 bow shock

**Files:**
- Modify: `src/mango_explorer/boundaries.py`
- Modify: `tests/test_boundaries.py`

The Jelínek+2012 bow shock is parameterized in a Shue-like functional form with its own subsolar standoff and flaring law. We use a documented variant: `R_bs(theta) = R0_bs(pd) * (2/(1+cos theta))**alpha_bs`, with `R0_bs = lambda_bs * pd**(-1/eps)` and `alpha_bs` taken as a parameter (default ~0.78). Reference: Jelínek+2012 JGR. Engineer must verify coefficients against the paper before relying on absolute numbers; the tests below check functional behavior only.

- [ ] **Step 1: Add failing tests**

```python
from mango_explorer.boundaries import jelinek_bs, jelinek_r0


def test_jelinek_bs_is_outside_shue_mp_at_subsolar():
    r_mp = shue_mp(theta=0.0, r0=10.5, alpha=0.6)
    r_bs = jelinek_bs(theta=0.0, pd=2.0)
    assert r_bs > r_mp


def test_jelinek_r0_decreases_with_pd():
    assert jelinek_r0(pd=1.0) > jelinek_r0(pd=4.0)


def test_jelinek_bs_vectorized_and_monotone():
    theta = np.linspace(0, math.pi * 0.7, 40)
    r = jelinek_bs(theta=theta, pd=2.0)
    assert r.shape == theta.shape
    assert np.all(np.diff(r) >= -1e-9)
```

- [ ] **Step 2: Run, expect failure**

- [ ] **Step 3: Implement**

```python
# Append to boundaries.py
_JEL_LAMBDA = 15.02   # RE at 1 nPa, per Jelínek+2012 fit
_JEL_EPS = 6.55       # pressure exponent
_JEL_ALPHA = 0.78     # flaring exponent (verify against paper)


def jelinek_r0(pd: float) -> float:
    """Jelínek+2012 bow-shock subsolar standoff (RE) as a function of Pd_sw."""
    return _JEL_LAMBDA * pd ** (-1.0 / _JEL_EPS)


def jelinek_bs(theta, pd: float, alpha: float = _JEL_ALPHA):
    """Jelínek+2012 bow shock surface: r(theta)."""
    theta = np.asarray(theta, dtype=float)
    r0 = jelinek_r0(pd)
    return r0 * (2.0 / (1.0 + np.cos(theta))) ** alpha
```

- [ ] **Step 4: Run, expect pass**

- [ ] **Step 5: Commit**

```bash
git add src/mango_explorer/boundaries.py tests/test_boundaries.py
git commit -m "feat(boundaries): Jelinek+2012 bow shock"
```

### Task 1.4: Surface tessellation (lathe → triangle mesh)

**Files:**
- Modify: `src/mango_explorer/boundaries.py`
- Modify: `tests/test_boundaries.py`

- [ ] **Step 1: Add failing tests**

```python
from mango_explorer.boundaries import tessellate_surface


def test_tessellate_returns_positions_and_indices():
    def r_of_theta(theta):
        return shue_mp(theta, r0=10.5, alpha=0.6)

    pos, idx = tessellate_surface(r_of_theta, n_theta=20, n_phi=24, theta_max=math.pi * 0.85)
    # Float32 vertices (N, 3), Uint32 indices (M, 3)
    assert pos.dtype == np.float32
    assert idx.dtype == np.uint32
    assert pos.shape[1] == 3
    assert idx.shape[1] == 3
    # n_theta rings * n_phi meridians
    assert pos.shape[0] == 20 * 24
    # Two triangles per quad cell
    assert idx.shape[0] == (20 - 1) * 24 * 2


def test_tessellate_subsolar_point_lies_on_x_axis():
    def r_of_theta(theta):
        return shue_mp(theta, r0=10.5, alpha=0.6)

    pos, _ = tessellate_surface(r_of_theta, n_theta=10, n_phi=8, theta_max=math.pi * 0.85)
    # First ring (theta=0) is exactly the subsolar point — all vertices at (10.5, 0, 0)
    first_ring = pos[:8]
    np.testing.assert_allclose(first_ring[:, 0], 10.5, atol=1e-5)
    np.testing.assert_allclose(first_ring[:, 1:], 0.0, atol=1e-5)
```

- [ ] **Step 2: Run, expect failure**

- [ ] **Step 3: Implement**

```python
# Append to boundaries.py
def tessellate_surface(
    r_of_theta,
    n_theta: int = 50,
    n_phi: int = 64,
    theta_max: float = np.pi * 0.85,
):
    """Tessellate an axisymmetric surface r(theta) into a triangle mesh.

    Sun-Earth axis is +x. Returns (positions[Nv,3] float32, indices[Nt,3] uint32).
    Topology: n_theta rings × n_phi meridians, with quad cells split into 2 triangles.
    """
    theta = np.linspace(0.0, theta_max, n_theta)
    phi = np.linspace(0.0, 2.0 * np.pi, n_phi, endpoint=False)
    r = np.asarray(r_of_theta(theta), dtype=float)

    # x along sun-earth axis; rho = r sin(theta) revolves around x
    x = (r * np.cos(theta))[:, None] * np.ones_like(phi)[None, :]
    rho = (r * np.sin(theta))[:, None]
    y = rho * np.cos(phi)[None, :]
    z = rho * np.sin(phi)[None, :]

    pos = np.stack([x, y, z], axis=-1).reshape(-1, 3).astype(np.float32)

    # Index buffer
    tris = []
    for i in range(n_theta - 1):
        for j in range(n_phi):
            j1 = (j + 1) % n_phi
            a = i * n_phi + j
            b = i * n_phi + j1
            c = (i + 1) * n_phi + j
            d = (i + 1) * n_phi + j1
            tris.append((a, c, d))
            tris.append((a, d, b))
    idx = np.asarray(tris, dtype=np.uint32)
    return pos, idx
```

- [ ] **Step 4: Run, expect pass**

- [ ] **Step 5: Commit**

```bash
git add src/mango_explorer/boundaries.py tests/test_boundaries.py
git commit -m "feat(boundaries): axisymmetric surface tessellator"
```

---

## Phase 2 — Gridding

### Task 2.1: `bin_scattered_2d`

**Files:**
- Create: `src/mango_explorer/gridding.py`
- Create: `tests/test_gridding.py`

- [ ] **Step 1: Write failing tests**

```python
# tests/test_gridding.py
import numpy as np
import polars as pl
import pytest
from mango_explorer.gridding import bin_scattered_2d


def _df(points):
    return pl.DataFrame({
        "X_gsm": [p[0] for p in points],
        "Y_gsm": [p[1] for p in points],
        "Z_gsm": [p[2] for p in points],
        "Np": [p[3] for p in points],
    })


def test_single_point_lands_in_one_bin():
    df = _df([(5.0, 1.0, 0.0, 7.0)])
    grid, mask = bin_scattered_2d(df, plane="xy", position=0.0,
                                  variable="Np", extent=10.0, n=8, slab=2.0)
    assert grid.shape == (8, 8)
    assert mask.dtype == bool
    assert mask.sum() == 1
    # The non-empty bin has value 7.0
    assert grid[mask].item() == pytest.approx(7.0)


def test_points_outside_slab_are_ignored():
    df = _df([(0.0, 0.0, 5.0, 99.0)])  # z=5, slab is ±1 around z=0
    grid, mask = bin_scattered_2d(df, plane="xy", position=0.0,
                                  variable="Np", extent=10.0, n=8, slab=1.0)
    assert mask.sum() == 0


def test_mean_aggregation():
    # Two points in the same bin -> mean
    df = _df([(0.5, 0.5, 0.0, 4.0), (0.4, 0.6, 0.0, 6.0)])
    grid, mask = bin_scattered_2d(df, plane="xy", position=0.0,
                                  variable="Np", extent=10.0, n=4, slab=1.0)
    nonempty = grid[mask]
    assert nonempty.size == 1
    assert nonempty.item() == pytest.approx(5.0)


def test_yz_plane_uses_y_z_axes():
    df = _df([(0.0, 3.0, 4.0, 1.0)])
    grid, mask = bin_scattered_2d(df, plane="yz", position=0.0,
                                  variable="Np", extent=10.0, n=10, slab=1.0)
    # The point is at x=0 ± 1 ✓; y=3, z=4 → bin indexed by (y, z)
    assert mask.sum() == 1
```

- [ ] **Step 2: Run, expect failure**

- [ ] **Step 3: Implement**

```python
# src/mango_explorer/gridding.py
"""2D binning of scattered point clouds for slice planes."""
from __future__ import annotations

import numpy as np
import polars as pl

_PLANE_AXES = {
    "xy": ("X_gsm", "Y_gsm", "Z_gsm"),
    "xz": ("X_gsm", "Z_gsm", "Y_gsm"),
    "yz": ("Y_gsm", "Z_gsm", "X_gsm"),
}


def bin_scattered_2d(
    df: pl.DataFrame,
    plane: str,
    position: float,
    variable: str,
    extent: float = 25.0,
    n: int = 256,
    slab: float = 1.0,
):
    """Bin scattered points within a slab around a plane into a 2D mean-grid.

    Returns (grid[n,n] float32, mask[n,n] bool). NaN bins are zeroed and masked.
    Coordinates in `df` are expected as columns X_gsm, Y_gsm, Z_gsm (RE).
    Axes for the plane:
      "xy" → u=X, v=Y, perpendicular=Z
      "xz" → u=X, v=Z, perpendicular=Y
      "yz" → u=Y, v=Z, perpendicular=X
    """
    u_col, v_col, p_col = _PLANE_AXES[plane]
    sub = df.filter(
        (pl.col(p_col) >= position - slab) & (pl.col(p_col) <= position + slab)
    )
    u = sub[u_col].to_numpy()
    v = sub[v_col].to_numpy()
    w = sub[variable].to_numpy()

    edges = np.linspace(-extent, extent, n + 1)
    sum_grid, _, _ = np.histogram2d(u, v, bins=[edges, edges], weights=w)
    cnt_grid, _, _ = np.histogram2d(u, v, bins=[edges, edges])

    mask = cnt_grid > 0
    grid = np.zeros_like(sum_grid, dtype=np.float32)
    np.divide(sum_grid, cnt_grid, out=grid, where=mask, casting="unsafe")
    return grid, mask
```

- [ ] **Step 4: Run, expect pass**

- [ ] **Step 5: Commit**

```bash
git add src/mango_explorer/gridding.py tests/test_gridding.py
git commit -m "feat(gridding): bin_scattered_2d for slice planes"
```

---

## Phase 3 — Colormap

### Task 3.1: `to_rgba` and `colorbar_info`

**Files:**
- Create: `src/mango_explorer/colormap.py`
- Create: `tests/test_colormap.py`

- [ ] **Step 1: Write failing tests**

```python
# tests/test_colormap.py
import numpy as np
import pytest
from mango_explorer.colormap import to_rgba, colorbar_info


def test_to_rgba_shape_and_dtype():
    values = np.array([[0.0, 0.5], [1.0, 0.25]], dtype=np.float32)
    mask = np.ones_like(values, dtype=bool)
    out = to_rgba(values, vmin=0.0, vmax=1.0, mask=mask)
    assert out.shape == (2, 2, 4)
    assert out.dtype == np.float32


def test_to_rgba_endpoints():
    values = np.array([[0.0, 1.0]], dtype=np.float32)
    mask = np.ones_like(values, dtype=bool)
    out = to_rgba(values, vmin=0.0, vmax=1.0, mask=mask)
    # Endpoints should differ in RGB
    assert not np.allclose(out[0, 0, :3], out[0, 1, :3])


def test_masked_bins_have_zero_alpha():
    values = np.array([[0.5, 0.5]], dtype=np.float32)
    mask = np.array([[True, False]])
    out = to_rgba(values, vmin=0.0, vmax=1.0, mask=mask)
    assert out[0, 0, 3] == pytest.approx(1.0)
    assert out[0, 1, 3] == pytest.approx(0.0)


def test_colorbar_info():
    info = colorbar_info(vmin=0.0, vmax=50.0, n_ticks=6)
    assert info["vmin"] == 0.0
    assert info["vmax"] == 50.0
    assert len(info["ticks"]) == 6
    assert info["ticks"][0] == pytest.approx(0.0)
    assert info["ticks"][-1] == pytest.approx(50.0)
```

- [ ] **Step 2: Run, expect failure**

- [ ] **Step 3: Implement (small inline viridis-like LUT, 16 stops, linearly interpolated)**

```python
# src/mango_explorer/colormap.py
"""Colormap + colorbar info. No matplotlib dependency."""
from __future__ import annotations

import numpy as np

# 16-stop viridis-like ramp (R, G, B in [0, 1])
_LUT = np.array([
    [0.267, 0.005, 0.329],
    [0.283, 0.130, 0.449],
    [0.262, 0.242, 0.521],
    [0.221, 0.339, 0.549],
    [0.177, 0.428, 0.557],
    [0.143, 0.522, 0.553],
    [0.120, 0.622, 0.534],
    [0.166, 0.722, 0.483],
    [0.319, 0.812, 0.388],
    [0.535, 0.886, 0.261],
    [0.762, 0.929, 0.166],
    [0.957, 0.949, 0.143],
    [0.993, 0.906, 0.144],
    [0.995, 0.820, 0.160],
    [0.985, 0.711, 0.193],
    [0.964, 0.566, 0.234],
], dtype=np.float32)


def to_rgba(values: np.ndarray, vmin: float, vmax: float, mask: np.ndarray) -> np.ndarray:
    """Map a 2D float array to (H, W, 4) Float32 RGBA via the LUT.

    Masked-out bins receive alpha = 0; valid bins receive alpha = 1.
    """
    t = (values - vmin) / max(vmax - vmin, 1e-12)
    t = np.clip(t, 0.0, 1.0)

    n_stops = _LUT.shape[0]
    f = t * (n_stops - 1)
    i0 = np.floor(f).astype(int)
    i1 = np.minimum(i0 + 1, n_stops - 1)
    frac = (f - i0).astype(np.float32)[..., None]
    rgb = _LUT[i0] * (1.0 - frac) + _LUT[i1] * frac

    alpha = mask.astype(np.float32)[..., None]
    out = np.concatenate([rgb, alpha], axis=-1).astype(np.float32)
    return out


def colorbar_info(vmin: float, vmax: float, n_ticks: int = 6) -> dict:
    """Return a dict with colorbar metadata for the frontend."""
    ticks = np.linspace(vmin, vmax, n_ticks).tolist()
    return {"vmin": float(vmin), "vmax": float(vmax), "ticks": ticks}
```

- [ ] **Step 4: Run, expect pass**

- [ ] **Step 5: Commit**

```bash
git add src/mango_explorer/colormap.py tests/test_colormap.py
git commit -m "feat(colormap): viridis-like LUT + colorbar info"
```

---

## Phase 4 — Papers reference

### Task 4.1: Lift the `papers` DOI database

**Files:**
- Create: `src/mango_explorer/papers.py`
- Create: `tests/test_papers.py`

- [ ] **Step 1: Write failing test**

```python
# tests/test_papers.py
from mango_explorer.papers import PAPERS, EVENT_TYPES, get_random_paper


def test_event_types_present():
    assert set(EVENT_TYPES) == {"FTE", "EDR", "Jet", "Current Sheet", "KH Wave", "Mirror Mode"}


def test_get_random_paper_is_deterministic_with_seed():
    p1 = get_random_paper("FTE", seed=42)
    p2 = get_random_paper("FTE", seed=42)
    assert p1 == p2
    assert "doi" in p1 and "title" in p1
```

- [ ] **Step 2: Run, expect failure**

- [ ] **Step 3: Implement**

```python
# src/mango_explorer/papers.py
"""DOI reference database lifted from old/mach.html (see lines 488-517)."""
from __future__ import annotations

import random
from typing import Final

PAPERS: Final[dict] = {
    "FTE": [
        {"doi": "10.1002/2016GL069787", "title": "Electron-scale measurements of magnetic reconnection in space",
         "authors": "Burch et al.", "year": 2016, "journal": "Science"},
        {"doi": "10.1029/2018JA025711", "title": "Properties of magnetic reconnection exhaust jets in the magnetosheath",
         "authors": "Phan et al.", "year": 2018, "journal": "JGR Space Physics"},
        {"doi": "10.1038/nphys3406", "title": "Kinetic signatures of magnetic reconnection in the magnetosheath",
         "authors": "Retinò et al.", "year": 2007, "journal": "Nature Physics"},
        {"doi": "10.1029/2019GL083282", "title": "Flux transfer events at the magnetopause: Survey with MMS",
         "authors": "Trenchi et al.", "year": 2019, "journal": "GRL"},
    ],
    "EDR": [
        {"doi": "10.1126/science.aaf2939", "title": "Electron-scale dynamics of the diffusion region during symmetric magnetic reconnection",
         "authors": "Burch et al.", "year": 2016, "journal": "Science"},
        {"doi": "10.1038/s41567-018-0091-6", "title": "Crescent-shaped electron distributions at the magnetopause",
         "authors": "Norgren et al.", "year": 2016, "journal": "GRL"},
        {"doi": "10.1002/2016GL068243", "title": "Energy conversion and inventory of a reconnection event",
         "authors": "Eastwood et al.", "year": 2016, "journal": "GRL"},
    ],
    "Jet": [
        {"doi": "10.1029/2012JA017962", "title": "Magnetosheath high-speed jets: Statistical properties",
         "authors": "Plaschke et al.", "year": 2013, "journal": "JGR Space Physics"},
        {"doi": "10.5194/angeo-36-655-2018", "title": "Jets downstream of collisionless shocks",
         "authors": "Palmroth et al.", "year": 2018, "journal": "Ann. Geophys."},
        {"doi": "10.1002/2017GL073175", "title": "Ion-scale jets in the magnetosheath",
         "authors": "Archer & Horbury", "year": 2013, "journal": "GRL"},
    ],
    "Current Sheet": [
        {"doi": "10.1002/2014JA020539", "title": "Current sheets in the magnetosheath",
         "authors": "Yordanova et al.", "year": 2016, "journal": "JGR Space Physics"},
        {"doi": "10.1029/2018GL079006", "title": "Thin current sheets in the magnetosheath: Cluster observations",
         "authors": "Sundkvist et al.", "year": 2007, "journal": "JGR Space Physics"},
    ],
    "KH Wave": [
        {"doi": "10.1002/2016JA023468", "title": "Kelvin-Helmholtz waves at the Earth's magnetopause",
         "authors": "Kavosi & Raeder", "year": 2015, "journal": "Nature Comms"},
        {"doi": "10.1029/2018GL077430", "title": "MMS observations of Kelvin-Helmholtz instability",
         "authors": "Eriksson et al.", "year": 2016, "journal": "GRL"},
    ],
    "Mirror Mode": [
        {"doi": "10.1029/93JA02587", "title": "Mirror mode structures in the magnetosheath",
         "authors": "Lucek et al.", "year": 1999, "journal": "JGR"},
        {"doi": "10.1002/2015JA021325", "title": "Properties of mirror modes in the magnetosheath",
         "authors": "Génot et al.", "year": 2009, "journal": "Ann. Geophys."},
    ],
}

EVENT_TYPES: Final[list[str]] = list(PAPERS.keys())


def get_random_paper(event_type: str, seed: int | None = None) -> dict:
    rng = random.Random(seed)
    key = event_type if event_type in PAPERS else rng.choice(EVENT_TYPES)
    return rng.choice(PAPERS[key])
```

- [ ] **Step 4: Run, expect pass**

- [ ] **Step 5: Commit**

```bash
git add src/mango_explorer/papers.py tests/test_papers.py
git commit -m "feat(papers): DOI reference database"
```

---

## Phase 5 — Data source layer

### Task 5.1: `Source` ABC

**Files:**
- Create: `src/mango_explorer/data/__init__.py`
- Create: `src/mango_explorer/data/base.py`

- [ ] **Step 1: Write `data/base.py`**

```python
# src/mango_explorer/data/base.py
"""Abstract data source matching the space-mango client API."""
from __future__ import annotations

from abc import ABC, abstractmethod
import polars as pl


class Source(ABC):
    @abstractmethod
    def regions(self) -> list[str]: ...

    @abstractmethod
    def filters(self, region: str) -> list[dict]: ...

    @abstractmethod
    def columns(self, region: str) -> list[str]: ...

    @abstractmethod
    def get_data(self, region: str, **kwargs) -> pl.DataFrame: ...
```

- [ ] **Step 2: Write `data/__init__.py` placeholder**

```python
# src/mango_explorer/data/__init__.py
"""Active data source for mango_explorer.

The four public functions below proxy to the active Source instance.
"""
from __future__ import annotations

import polars as pl
from .base import Source

_active: Source | None = None


def set_active(source: Source) -> None:
    global _active
    _active = source


def _require() -> Source:
    if _active is None:
        raise RuntimeError("No active data source. Call mango_explorer.config.use_source(...)")
    return _active


def regions() -> list[str]:
    return _require().regions()


def filters(region: str) -> list[dict]:
    return _require().filters(region)


def columns(region: str) -> list[str]:
    return _require().columns(region)


def get_data(region: str, **kwargs) -> pl.DataFrame:
    return _require().get_data(region, **kwargs)
```

- [ ] **Step 3: Commit (no test yet — covered by Task 5.3's tests)**

```bash
git add src/mango_explorer/data/
git commit -m "feat(data): Source ABC and active-source proxy"
```

### Task 5.2: `RemoteSource` stub

**Files:**
- Create: `src/mango_explorer/data/remote.py`

- [ ] **Step 1: Write the stub**

```python
# src/mango_explorer/data/remote.py
"""Real MANGO server adapter. Stub for POC.

When the deployment blockers clear (HTTPS + CORS on sciqlop.lpp.polytechnique.fr),
implement these four methods using pyodide.http.pyfetch (in Pyodide) or httpx
(in CPython), decoding Arrow IPC with polars.read_ipc.
"""
from __future__ import annotations

import polars as pl
from .base import Source


class RemoteSource(Source):
    def __init__(self, base_url: str = "http://sciqlop.lpp.polytechnique.fr/mango/"):
        self.base_url = base_url

    def regions(self) -> list[str]:
        raise NotImplementedError("RemoteSource is a POC stub")

    def filters(self, region: str) -> list[dict]:
        raise NotImplementedError("RemoteSource is a POC stub")

    def columns(self, region: str) -> list[str]:
        raise NotImplementedError("RemoteSource is a POC stub")

    def get_data(self, region: str, **kwargs) -> pl.DataFrame:
        raise NotImplementedError("RemoteSource is a POC stub")
```

- [ ] **Step 2: Commit**

```bash
git add src/mango_explorer/data/remote.py
git commit -m "feat(data): RemoteSource stub for future real integration"
```

### Task 5.3: `FakeSource` — magnetosheath region

**Files:**
- Create: `src/mango_explorer/data/fake.py`
- Create: `tests/test_fake_source.py`

This is the largest single task. It generates ~50 000 scattered points in the magnetosheath shell with correlated plasma columns, supports the `<name>_min/_max` filter convention, and exposes `regions/filters/columns/get_data`. Events region added in Task 5.4.

- [ ] **Step 1: Write failing tests**

```python
# tests/test_fake_source.py
import math
import numpy as np
import polars as pl
import pytest
from mango_explorer.data.fake import FakeSource


@pytest.fixture
def src():
    return FakeSource(seed=42, n_points=5000)


def test_regions_include_magnetosheath(src):
    assert "magnetosheath" in src.regions()


def test_columns_match_real_mango_shape(src):
    cols = set(src.columns("magnetosheath"))
    must_have = {"Time", "spacecraft",
                 "X_gsm", "Y_gsm", "Z_gsm", "D_msh",
                 "Np", "Tp", "Bz",
                 "Bx_imf", "By_imf", "Bz_imf",
                 "Pd_sw", "Np_sw", "Tp_sw", "Vx_sw", "Beta_sw", "Ma_sw", "Tilt"}
    assert must_have <= cols


def test_filters_are_min_max_pairs(src):
    fl = src.filters("magnetosheath")
    names = {f["name"] for f in fl}
    assert {"bz_imf", "pd_sw", "ma_sw"} <= names
    for f in fl:
        assert {"name", "column", "unit", "description", "params"} <= set(f.keys())


def test_get_data_returns_polars_dataframe(src):
    df = src.get_data("magnetosheath")
    assert isinstance(df, pl.DataFrame)
    assert len(df) > 0


def test_filters_respect_min_max(src):
    df = src.get_data("magnetosheath", ma_sw_min=3.0, ma_sw_max=5.0)
    ma = df["Ma_sw"].to_numpy()
    assert ma.min() >= 3.0 - 1e-9
    assert ma.max() <= 5.0 + 1e-9


def test_deterministic_with_seed():
    df1 = FakeSource(seed=42, n_points=1000).get_data("magnetosheath")
    df2 = FakeSource(seed=42, n_points=1000).get_data("magnetosheath")
    assert df1.equals(df2)


def test_points_lie_between_mp_and_bs(src):
    df = src.get_data("magnetosheath")
    # D_msh in [0, 1]
    d = df["D_msh"].to_numpy()
    assert d.min() >= 0.0
    assert d.max() <= 1.0


def test_invalid_filter_raises(src):
    with pytest.raises(ValueError):
        src.get_data("magnetosheath", bogus_min=1)
```

- [ ] **Step 2: Run, expect failure**

Run: `pytest tests/test_fake_source.py -v`
Expected: ImportError on `FakeSource`.

- [ ] **Step 3: Implement**

```python
# src/mango_explorer/data/fake.py
"""Deterministic synthetic MANGO-shaped source for the POC."""
from __future__ import annotations

import datetime as _dt
from typing import Final

import numpy as np
import polars as pl

from .base import Source
from ..boundaries import shue_mp, jelinek_bs

_SPACECRAFT: Final = ["MMS1", "THA", "C1"]

# Filter catalog: (name, column, unit, description)
_FILTER_CATALOG: Final = [
    ("bz_imf", "Bz_imf", "nT",   "IMF Bz (GSM)"),
    ("by_imf", "By_imf", "nT",   "IMF By (GSM)"),
    ("pd_sw",  "Pd_sw",  "nPa",  "Solar wind dynamic pressure"),
    ("ma_sw",  "Ma_sw",  "",     "Solar wind Alfvén Mach number"),
    ("vx_sw",  "Vx_sw",  "km/s", "Solar wind Vx (GSM)"),
    ("np_sw",  "Np_sw",  "cm-3", "Solar wind proton density"),
]


def _compression_ratio(mach: np.ndarray, gamma: float = 5.0 / 3.0) -> np.ndarray:
    m2 = mach * mach
    return ((gamma + 1.0) * m2) / ((gamma - 1.0) * m2 + 2.0)


class FakeSource(Source):
    """Deterministic fake MANGO data source.

    seed     : RNG seed for reproducibility.
    n_points : number of magnetosheath scattered points.
    """

    def __init__(self, seed: int = 42, n_points: int = 50_000):
        self.seed = seed
        self.n_points = n_points
        self._cache: dict[str, pl.DataFrame] = {}

    # ---- API ----------------------------------------------------------
    def regions(self) -> list[str]:
        return ["magnetosheath"]

    def filters(self, region: str) -> list[dict]:
        if region != "magnetosheath":
            raise ValueError(f"Unknown region: {region}")
        return [
            {"name": n, "column": c, "unit": u, "description": d,
             "params": f"{n}_min=..&{n}_max=.."}
            for (n, c, u, d) in _FILTER_CATALOG
        ]

    def columns(self, region: str) -> list[str]:
        return self._magnetosheath().columns

    def get_data(self, region: str, **kwargs) -> pl.DataFrame:
        if region != "magnetosheath":
            raise ValueError(f"Unknown region: {region}")
        df = self._magnetosheath()
        return self._apply_filters(df, kwargs)

    # ---- Internals ----------------------------------------------------
    def _magnetosheath(self) -> pl.DataFrame:
        if "magnetosheath" in self._cache:
            return self._cache["magnetosheath"]

        rng = np.random.default_rng(self.seed)
        n = self.n_points

        # Sample (theta, phi, d) where d is normalized depth across the shell
        theta = np.arccos(1.0 - 0.85 * rng.random(n))  # bias toward subsolar
        phi = rng.uniform(0.0, 2.0 * np.pi, n)
        d = rng.uniform(0.0, 1.0, n)  # 0 = at BS, 1 = at MP

        # Per-point upstream SW conditions (correlated)
        ma_sw = np.clip(rng.lognormal(mean=np.log(6.0), sigma=0.3, size=n), 1.0, 12.0)
        pd_sw = np.clip(0.5 + 0.4 * (ma_sw - 6.0) + rng.normal(0.0, 0.5, n), 0.3, 12.0)
        bz_imf = rng.normal(0.0, 4.0, n)
        by_imf = rng.normal(0.0, 4.0, n)
        bx_imf = rng.normal(0.0, 3.0, n)
        np_sw = np.clip(rng.lognormal(mean=np.log(5.0), sigma=0.4, size=n), 0.5, 50.0)
        tp_sw = np.clip(rng.lognormal(mean=np.log(1e5), sigma=0.3, size=n), 1e3, 1e7)
        vx_sw = -np.clip(rng.normal(450.0, 80.0, n), 250.0, 900.0)
        beta_sw = np.clip(rng.lognormal(mean=np.log(1.0), sigma=0.5, size=n), 0.05, 20.0)
        tilt = rng.uniform(-30.0, 30.0, n)

        # Boundary radii at each point's theta, conditional on its own Pd
        r_mp = shue_mp(theta, r0=10.5, alpha=0.6)        # fixed nominal MP
        r_bs = jelinek_bs(theta, pd=2.0)                  # nominal BS for geometry
        r = r_bs * (1.0 - d) + r_mp * d                   # interpolate by depth

        x = r * np.cos(theta)
        y = r * np.sin(theta) * np.cos(phi)
        z = r * np.sin(theta) * np.sin(phi)

        # Local Np model: SW × Rankine-Hugoniot × stagnation × angular
        n_sw_base = 5.0
        comp = _compression_ratio(ma_sw)
        stagnation = 1.0 + 1.2 * d ** 1.5
        angular = 0.6 + 0.4 * np.clip(np.cos(theta), 0.0, 1.0) ** 0.5
        local_np = n_sw_base * comp * stagnation * angular

        # Local Tp, Bz placeholders (physically plausible)
        local_tp = tp_sw * (1.0 + 8.0 * d)
        local_bz = bz_imf * (1.5 + 0.5 * d) + rng.normal(0.0, 0.5, n)

        # Times: spread uniformly across 2015-2024
        t0 = _dt.datetime(2015, 1, 1)
        t1 = _dt.datetime(2024, 12, 31)
        dt = (t1 - t0).total_seconds()
        times = [t0 + _dt.timedelta(seconds=float(s))
                 for s in rng.uniform(0.0, dt, n)]

        sc = rng.choice(_SPACECRAFT, size=n)

        df = pl.DataFrame({
            "Time": times,
            "spacecraft": sc,
            "X_gsm": x.astype(np.float32),
            "Y_gsm": y.astype(np.float32),
            "Z_gsm": z.astype(np.float32),
            "D_msh": d.astype(np.float32),
            "Np": local_np.astype(np.float32),
            "Tp": local_tp.astype(np.float32),
            "Bz": local_bz.astype(np.float32),
            "Bx_imf": bx_imf.astype(np.float32),
            "By_imf": by_imf.astype(np.float32),
            "Bz_imf": bz_imf.astype(np.float32),
            "Pd_sw": pd_sw.astype(np.float32),
            "Np_sw": np_sw.astype(np.float32),
            "Tp_sw": tp_sw.astype(np.float32),
            "Vx_sw": vx_sw.astype(np.float32),
            "Beta_sw": beta_sw.astype(np.float32),
            "Ma_sw": ma_sw.astype(np.float32),
            "Tilt": tilt.astype(np.float32),
        })
        self._cache["magnetosheath"] = df
        return df

    def _apply_filters(self, df: pl.DataFrame, kwargs: dict) -> pl.DataFrame:
        name_to_col = {n: c for (n, c, _u, _d) in _FILTER_CATALOG}
        for key, val in kwargs.items():
            if key.endswith("_min"):
                name = key[:-4]
                if name not in name_to_col:
                    raise ValueError(f"Unknown filter '{name}'")
                df = df.filter(pl.col(name_to_col[name]) >= val)
            elif key.endswith("_max"):
                name = key[:-4]
                if name not in name_to_col:
                    raise ValueError(f"Unknown filter '{name}'")
                df = df.filter(pl.col(name_to_col[name]) <= val)
            else:
                raise ValueError(f"Filter kwargs must end with _min or _max; got {key}")
        return df
```

- [ ] **Step 4: Run, expect pass**

Run: `pytest tests/test_fake_source.py -v`
Expected: all tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/mango_explorer/data/fake.py tests/test_fake_source.py
git commit -m "feat(data): FakeSource magnetosheath region"
```

### Task 5.4: `FakeSource` — events region

**Files:**
- Modify: `src/mango_explorer/data/fake.py`
- Modify: `tests/test_fake_source.py`

The POC adds an `events` region on top of the real MANGO regions. Marked POC-only in the spec.

- [ ] **Step 1: Add failing tests**

```python
# Append to tests/test_fake_source.py
def test_events_region_present(src):
    assert "events" in src.regions()


def test_events_have_expected_columns(src):
    cols = set(src.columns("events"))
    must_have = {"id", "mission", "date", "type", "X_gsm", "Y_gsm", "Z_gsm",
                 "doi", "title", "authors", "year", "journal"}
    assert must_have <= cols


def test_events_mission_filter(src):
    df = src.get_data("events", mission=["MMS"])
    assert set(df["mission"].unique().to_list()) <= {"MMS"}


def test_events_count_is_about_sixty(src):
    df = src.get_data("events")
    assert 40 <= len(df) <= 100
```

- [ ] **Step 2: Run, expect failure**

- [ ] **Step 3: Implement (modify `FakeSource`)**

In `src/mango_explorer/data/fake.py`, change `regions()` to return `["magnetosheath", "events"]`, change `filters("events")` to return an empty list, add an `_events()` builder, dispatch in `get_data`. Add this code:

```python
# Add to imports
from ..papers import EVENT_TYPES, get_random_paper, PAPERS

# In FakeSource:
def regions(self) -> list[str]:
    return ["magnetosheath", "events"]

def filters(self, region: str) -> list[dict]:
    if region == "magnetosheath":
        return [
            {"name": n, "column": c, "unit": u, "description": d,
             "params": f"{n}_min=..&{n}_max=.."}
            for (n, c, u, d) in _FILTER_CATALOG
        ]
    if region == "events":
        return []
    raise ValueError(f"Unknown region: {region}")

def columns(self, region: str) -> list[str]:
    if region == "magnetosheath":
        return self._magnetosheath().columns
    if region == "events":
        return self._events().columns
    raise ValueError(f"Unknown region: {region}")

def get_data(self, region: str, **kwargs) -> pl.DataFrame:
    if region == "magnetosheath":
        return self._apply_filters(self._magnetosheath(), kwargs)
    if region == "events":
        return self._apply_event_filters(self._events(), kwargs)
    raise ValueError(f"Unknown region: {region}")

def _events(self) -> pl.DataFrame:
    if "events" in self._cache:
        return self._cache["events"]
    rng = np.random.default_rng(self.seed + 1)

    rows = []
    mission_specs = [("MMS", 25, (2015, 2024)),
                     ("THEMIS", 20, (2007, 2024)),
                     ("Cluster", 15, (2001, 2024))]
    eid = 0
    for mission, count, (yr0, yr1) in mission_specs:
        for _ in range(count):
            theta = rng.uniform(0.0, np.pi * 0.7)
            phi = rng.uniform(0.0, 2.0 * np.pi)
            r = rng.uniform(8.0, 14.0)
            year = int(rng.integers(yr0, yr1 + 1))
            month = int(rng.integers(1, 13))
            day = int(rng.integers(1, 29))
            etype = EVENT_TYPES[int(rng.integers(0, len(EVENT_TYPES)))]
            paper = rng.choice(PAPERS[etype])
            eid += 1
            rows.append({
                "id": f"{mission}-{year:04d}{month:02d}{day:02d}-{eid:03d}",
                "mission": mission,
                "date": f"{year:04d}-{month:02d}-{day:02d}",
                "type": etype,
                "X_gsm": float(r * np.cos(theta)),
                "Y_gsm": float(r * np.sin(theta) * np.cos(phi)),
                "Z_gsm": float(r * np.sin(theta) * np.sin(phi)),
                "doi": paper["doi"],
                "title": paper["title"],
                "authors": paper["authors"],
                "year": int(paper["year"]),
                "journal": paper["journal"],
            })
    df = pl.DataFrame(rows)
    self._cache["events"] = df
    return df

def _apply_event_filters(self, df: pl.DataFrame, kwargs: dict) -> pl.DataFrame:
    for k, v in kwargs.items():
        if k == "mission":
            df = df.filter(pl.col("mission").is_in(list(v)))
        else:
            raise ValueError(f"Unknown events filter: {k}")
    return df
```

- [ ] **Step 4: Run, expect pass**

- [ ] **Step 5: Commit**

```bash
git add src/mango_explorer/data/fake.py tests/test_fake_source.py
git commit -m "feat(data): FakeSource events region with DOI lookup"
```

### Task 5.5: Config / source switching

**Files:**
- Create: `src/mango_explorer/config.py`
- Create: `tests/test_config.py`

- [ ] **Step 1: Write failing test**

```python
# tests/test_config.py
import pytest
from mango_explorer import config
from mango_explorer import data


def test_use_source_fake_makes_data_callable():
    config.use_source("fake", seed=1, n_points=200)
    assert "magnetosheath" in data.regions()
    df = data.get_data("magnetosheath")
    assert len(df) > 0


def test_use_source_unknown_raises():
    with pytest.raises(ValueError):
        config.use_source("nope")
```

- [ ] **Step 2: Implement**

```python
# src/mango_explorer/config.py
"""Active-source selector."""
from __future__ import annotations

from . import data
from .data.fake import FakeSource
from .data.remote import RemoteSource


def use_source(name: str, **kwargs) -> None:
    if name == "fake":
        data.set_active(FakeSource(**kwargs))
    elif name == "remote":
        data.set_active(RemoteSource(**kwargs))
    else:
        raise ValueError(f"Unknown source '{name}'. Use 'fake' or 'remote'.")
```

- [ ] **Step 3: Run, expect pass**

- [ ] **Step 4: Commit**

```bash
git add src/mango_explorer/config.py tests/test_config.py
git commit -m "feat(config): source selection"
```

---

## Phase 6 — High-level explorer entry points

### Task 6.1: `build_boundary`, `build_slice`, `build_events`

**Files:**
- Create: `src/mango_explorer/explorer.py`
- Create: `tests/test_explorer.py`

These are the only functions the JS bridge calls. They must return plain Python dicts of typed arrays + metadata (Pyodide marshals numpy arrays to JS typed arrays automatically).

- [ ] **Step 1: Write failing tests**

```python
# tests/test_explorer.py
import numpy as np
import pytest
from mango_explorer import config, explorer


@pytest.fixture(autouse=True)
def _setup():
    config.use_source("fake", seed=42, n_points=2000)


def test_build_boundary_mp():
    out = explorer.build_boundary("mp", r0=10.5, alpha=0.6)
    assert out["positions"].dtype == np.float32
    assert out["indices"].dtype == np.uint32
    assert out["positions"].ndim == 2 and out["positions"].shape[1] == 3


def test_build_boundary_bs():
    out = explorer.build_boundary("bs", pd=2.0)
    assert out["positions"].dtype == np.float32


def test_build_slice_returns_rgba_and_meta():
    out = explorer.build_slice(plane="xy", position=0.0, variable="Np",
                               extent=25.0, n=64,
                               filters={"ma_sw_min": 3.0, "ma_sw_max": 6.0})
    assert out["rgba"].shape == (64, 64, 4)
    assert out["rgba"].dtype == np.float32
    assert "vmin" in out and "vmax" in out and "ticks" in out


def test_build_events_returns_positions_and_metadata():
    out = explorer.build_events(missions=["MMS", "THEMIS"])
    assert out["positions"].dtype == np.float32
    assert out["positions"].shape[1] == 3
    assert len(out["meta"]) == out["positions"].shape[0]
    # Each metadata row has id/mission/date/type/doi
    assert {"id", "mission", "date", "type", "doi"} <= set(out["meta"][0].keys())
```

- [ ] **Step 2: Run, expect failure**

- [ ] **Step 3: Implement**

```python
# src/mango_explorer/explorer.py
"""High-level entry points called by the frontend via Pyodide."""
from __future__ import annotations

import numpy as np

from . import data
from .boundaries import shue_mp, jelinek_bs, tessellate_surface
from .colormap import to_rgba, colorbar_info
from .gridding import bin_scattered_2d


def build_boundary(name: str, r0: float | None = None, alpha: float = 0.6,
                   pd: float = 2.0, n_theta: int = 50, n_phi: int = 64) -> dict:
    """Tessellate a boundary surface and return (positions, indices)."""
    if name == "mp":
        def r_of_theta(t):
            return shue_mp(t, r0=r0 if r0 is not None else 10.5, alpha=alpha)
        theta_max = np.pi * 0.85
    elif name == "bs":
        def r_of_theta(t):
            return jelinek_bs(t, pd=pd)
        theta_max = np.pi * 0.7
    else:
        raise ValueError(f"Unknown boundary '{name}'")

    pos, idx = tessellate_surface(r_of_theta, n_theta=n_theta, n_phi=n_phi,
                                  theta_max=theta_max)
    return {"positions": pos, "indices": idx}


def build_slice(plane: str, position: float, variable: str = "Np",
                extent: float = 25.0, n: int = 256,
                filters: dict | None = None) -> dict:
    df = data.get_data("magnetosheath", **(filters or {}))
    grid, mask = bin_scattered_2d(df, plane=plane, position=position,
                                  variable=variable, extent=extent, n=n)
    if mask.any():
        vmin = float(np.nanpercentile(grid[mask], 2))
        vmax = float(np.nanpercentile(grid[mask], 98))
    else:
        vmin, vmax = 0.0, 1.0
    rgba = to_rgba(grid, vmin=vmin, vmax=vmax, mask=mask)
    cb = colorbar_info(vmin, vmax)
    return {"rgba": rgba, "vmin": cb["vmin"], "vmax": cb["vmax"], "ticks": cb["ticks"]}


def build_events(missions: list[str] | None = None) -> dict:
    kwargs = {"mission": missions} if missions else {}
    df = data.get_data("events", **kwargs)
    pos = np.stack([
        df["X_gsm"].to_numpy(),
        df["Y_gsm"].to_numpy(),
        df["Z_gsm"].to_numpy(),
    ], axis=-1).astype(np.float32)
    meta = df.select(["id", "mission", "date", "type", "doi",
                      "title", "authors", "year", "journal"]).to_dicts()
    return {"positions": pos, "meta": meta}
```

- [ ] **Step 4: Run all tests**

Run: `pytest -v`
Expected: all tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/mango_explorer/explorer.py tests/test_explorer.py
git commit -m "feat(explorer): build_boundary, build_slice, build_events"
```

### Task 6.2: Build wheel and verify Pyodide-compat dependencies

**Files:**
- Modify: `pyproject.toml` (only if a dep needs adjustment)

- [ ] **Step 1: Install hatch and build**

```bash
uv pip install hatch
hatch build -t wheel
ls dist/*.whl
```
Expected: one `.whl` in `dist/`.

- [ ] **Step 2: Verify wheel runs against a clean venv**

```bash
deactivate
uv venv .venv-check && source .venv-check/bin/activate
uv pip install dist/*.whl pytest
python -c "from mango_explorer import config, explorer; config.use_source('fake', seed=1, n_points=100); print(explorer.build_slice('xy', 0).get('vmin'))"
deactivate
rm -rf .venv-check
source .venv/bin/activate
```
Expected: a numeric `vmin` prints.

- [ ] **Step 3: Commit wheel artifact location to `.gitignore` and the build script**

(Already gitignored; nothing to commit.)

---

## Phase 7 — Vite web app

The JS side cannot follow strict TDD; tasks here are coarser. The acceptance criterion for each task is a manual visual check described in its steps.

### Task 7.1: Scaffold Vite project

**Files:**
- Create: `web/package.json`
- Create: `web/vite.config.js`
- Create: `web/index.html`
- Create: `web/.gitignore`
- Create: `web/src/main.js`
- Create: `web/src/styles.css`

- [ ] **Step 1: Initialize**

```bash
cd web
npm init -y
npm install --save-dev vite
npm install three pyodide@0.26.4
```

- [ ] **Step 2: Write `web/package.json` scripts**

Edit the `scripts` section of `web/package.json` to:

```json
"scripts": {
  "dev": "vite",
  "build": "vite build",
  "preview": "vite preview"
}
```

- [ ] **Step 3: Write `web/vite.config.js`**

```js
import { defineConfig } from 'vite';

export default defineConfig({
  base: './',
  optimizeDeps: { exclude: ['pyodide'] },
  build: { target: 'es2022' },
});
```

- [ ] **Step 4: Write `web/.gitignore`**

```
node_modules/
dist/
public/wheels/*.whl
```

- [ ] **Step 5: Write `web/index.html`**

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <title>MANGO Explorer</title>
    <link rel="stylesheet" href="/src/styles.css" />
  </head>
  <body>
    <div id="loading">Loading Pyodide…</div>
    <aside id="sidebar"></aside>
    <main id="viewport">
      <svg id="overlay"><line id="connector"/><circle id="dot" r="5"/></svg>
      <div id="popup" hidden></div>
      <div id="colorbar"></div>
    </main>
    <script type="module" src="/src/main.js"></script>
  </body>
</html>
```

- [ ] **Step 6: Minimal `web/src/main.js` and `web/src/styles.css`**

```js
// web/src/main.js
document.getElementById('loading').textContent = 'Vite app loaded.';
```

```css
/* web/src/styles.css */
* { margin: 0; box-sizing: border-box; }
body { display: flex; height: 100vh; background: #000; color: #fff;
       font-family: Arial, sans-serif; overflow: hidden; }
#sidebar { width: 280px; background: #0d0d15; padding: 20px;
           border-right: 1px solid #333; overflow-y: auto; }
#viewport { flex: 1; position: relative; }
#overlay { position: absolute; inset: 0; pointer-events: none; }
#popup { position: absolute; background: rgba(10,15,30,.95); border: 1px solid #ffaa00;
         padding: 12px; min-width: 280px; }
#colorbar { position: absolute; right: 20px; bottom: 20px; width: 30px; height: 200px;
            border: 1px solid #444; }
#loading { position: absolute; inset: 0; display: flex; align-items: center;
           justify-content: center; background: #000; z-index: 100; }
```

- [ ] **Step 7: Run dev server, verify in browser**

```bash
cd web && npm run dev
```
Open http://localhost:5173 — verify the loading text changes to "Vite app loaded."

- [ ] **Step 8: Commit**

```bash
git add web/package.json web/package-lock.json web/vite.config.js web/index.html web/.gitignore web/src/
git commit -m "feat(web): scaffold Vite project"
```

### Task 7.2: Load Pyodide and install the wheel

**Files:**
- Create: `web/src/pyodide-bridge.js`
- Modify: `web/src/main.js`
- Create: `web/public/wheels/` (empty, populated by a build step)
- Create: `scripts/build-wheel.sh` at repo root

- [ ] **Step 1: Write a small script to copy the wheel into the web public dir**

```bash
# scripts/build-wheel.sh
#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
rm -rf dist/
hatch build -t wheel
mkdir -p web/public/wheels
cp dist/mango_explorer-*.whl web/public/wheels/
```
Then: `chmod +x scripts/build-wheel.sh && ./scripts/build-wheel.sh`

- [ ] **Step 2: Write `web/src/pyodide-bridge.js`**

```js
// web/src/pyodide-bridge.js
import { loadPyodide } from 'pyodide';

let py = null;

export async function init() {
  py = await loadPyodide({
    indexURL: 'https://cdn.jsdelivr.net/pyodide/v0.26.4/full/',
  });
  await py.loadPackage(['numpy', 'polars']);
  // Find our wheel
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
  const code = `explorer.build_boundary('${name}', **${JSON.stringify(params)})`;
  const proxy = await py.runPythonAsync(code);
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
```

- [ ] **Step 3: Write `web/public/wheels/index.json`**

```json
{ "url": "./wheels/mango_explorer-0.0.1-py3-none-any.whl" }
```

- [ ] **Step 4: Update `web/src/main.js`**

```js
import * as bridge from './pyodide-bridge.js';

const loading = document.getElementById('loading');
loading.textContent = 'Loading Pyodide…';
await bridge.init();
loading.textContent = 'Building boundary…';
const mp = await bridge.buildBoundary('mp', { r0: 10.5, alpha: 0.6 });
loading.textContent = `MP mesh: ${mp.positions.length / 3} vertices`;
console.log('MP mesh', mp);
```

- [ ] **Step 5: Run and verify**

```bash
cd web && npm run dev
```
Open browser console — should log the MP mesh dict with `positions` (Float32Array) and `indices` (Uint32Array). The loading message should show the vertex count.

- [ ] **Step 6: Commit**

```bash
git add web/src/pyodide-bridge.js web/src/main.js web/public/wheels/index.json scripts/
git commit -m "feat(web): Pyodide loader + wheel install + bridge"
```

### Task 7.3: Three.js scene with Earth, axes, MP, BS

**Files:**
- Create: `web/src/scene/scene.js`
- Create: `web/src/scene/boundaries.js`
- Modify: `web/src/main.js`

- [ ] **Step 1: Write `web/src/scene/scene.js`**

```js
// web/src/scene/scene.js
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';

export function createScene(container) {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x050510);

  const camera = new THREE.PerspectiveCamera(45,
    container.clientWidth / container.clientHeight, 0.1, 500);
  camera.position.set(30, 20, 30);

  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setSize(container.clientWidth, container.clientHeight);
  container.appendChild(renderer.domElement);

  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;

  scene.add(new THREE.Mesh(
    new THREE.SphereGeometry(1, 32, 32),
    new THREE.MeshBasicMaterial({ color: 0x0066cc, wireframe: true })
  ));
  scene.add(new THREE.AxesHelper(8));

  function loop() {
    requestAnimationFrame(loop);
    controls.update();
    renderer.render(scene, camera);
  }
  loop();

  window.addEventListener('resize', () => {
    camera.aspect = container.clientWidth / container.clientHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(container.clientWidth, container.clientHeight);
  });

  return { scene, camera, controls, renderer };
}
```

- [ ] **Step 2: Write `web/src/scene/boundaries.js`**

```js
// web/src/scene/boundaries.js
import * as THREE from 'three';

export function makeBoundaryMesh({ positions, indices }, color, opacity) {
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geo.setIndex(new THREE.BufferAttribute(indices, 1));
  geo.computeVertexNormals();
  const mat = new THREE.MeshBasicMaterial({
    color, transparent: true, opacity,
    side: THREE.DoubleSide, depthWrite: false,
  });
  return new THREE.Mesh(geo, mat);
}
```

- [ ] **Step 3: Update `web/src/main.js`**

```js
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
scene.add(makeBoundaryMesh(mp, 0x00aaff, 0.12));
scene.add(makeBoundaryMesh(bs, 0xff6600, 0.08));
```

- [ ] **Step 4: Visual verification**

Run `npm run dev`. Open the page. Expected: black background, Earth wireframe, axes, semi-transparent blue magnetopause and orange bow shock. Orbit the camera with the mouse.

- [ ] **Step 5: Commit**

```bash
git add web/src/scene/ web/src/main.js
git commit -m "feat(web): render Earth, axes, MP, BS"
```

### Task 7.4: Event scatter + click popup

**Files:**
- Create: `web/src/scene/events.js`
- Create: `web/src/ui/popup.js`
- Modify: `web/src/main.js`

- [ ] **Step 1: Write `web/src/scene/events.js`**

```js
// web/src/scene/events.js
import * as THREE from 'three';

const MISSION_COLOR = { MMS: 0xff4444, THEMIS: 0x44ff44, Cluster: 0xffff44 };

export function makeEventMeshes({ positions, meta }) {
  const meshes = [];
  for (let i = 0; i < meta.length; i++) {
    const m = new THREE.Mesh(
      new THREE.SphereGeometry(0.3, 16, 16),
      new THREE.MeshBasicMaterial({ color: MISSION_COLOR[meta[i].mission] ?? 0xffffff })
    );
    m.position.set(positions[i*3], positions[i*3+1], positions[i*3+2]);
    m.userData = meta[i];
    meshes.push(m);
  }
  return meshes;
}
```

- [ ] **Step 2: Write `web/src/ui/popup.js`**

```js
// web/src/ui/popup.js
export function showPopup(meta) {
  const el = document.getElementById('popup');
  el.innerHTML = `
    <h3 style="color:#ffaa00;font-size:13px;margin-bottom:8px;">${meta.id}</h3>
    <div>Mission: <b>${meta.mission}</b></div>
    <div>Date: ${meta.date}</div>
    <div>Type: ${meta.type}</div>
    <hr style="margin:8px 0;border-color:#444;">
    <a href="https://doi.org/${meta.doi}" target="_blank"
       style="color:#66aaff;">doi:${meta.doi}</a>
    <div style="color:#aaa;font-size:10px;margin-top:4px;">
      ${meta.authors} (${meta.year}). "${meta.title}", ${meta.journal}
    </div>
  `;
  el.style.left = '20px';
  el.style.top = '80px';
  el.hidden = false;
}

export function hidePopup() {
  document.getElementById('popup').hidden = true;
}
```

- [ ] **Step 3: Wire raycasting in `web/src/main.js`**

Add to `main.js` after creating the scene:

```js
import { makeEventMeshes } from './scene/events.js';
import { showPopup, hidePopup } from './ui/popup.js';
import * as THREE from 'three';

const events = await bridge.buildEvents();
const eventMeshes = makeEventMeshes(events);
eventMeshes.forEach(m => scene.add(m));

const raycaster = new THREE.Raycaster();
const mouse = new THREE.Vector2();
const renderer = scene.userData.renderer ?? document.querySelector('#viewport canvas');

document.querySelector('#viewport canvas').addEventListener('click', (e) => {
  const rect = e.target.getBoundingClientRect();
  mouse.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
  mouse.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
  raycaster.setFromCamera(mouse, scene.userData.camera);
  const hits = raycaster.intersectObjects(eventMeshes);
  if (hits.length) showPopup(hits[0].object.userData);
  else hidePopup();
});
```

(Note: also export `camera` and `renderer` on `scene.userData` from `createScene`. Add `scene.userData = { camera, renderer };` before returning in `scene.js`.)

- [ ] **Step 4: Visual verification**

Click event spheres — popup shows id, mission, date, type, DOI link. Clicking empty space hides it.

- [ ] **Step 5: Commit**

```bash
git add web/src/scene/events.js web/src/ui/popup.js web/src/main.js web/src/scene/scene.js
git commit -m "feat(web): event scatter with click-to-popup"
```

### Task 7.5: Density slice plane

**Files:**
- Create: `web/src/scene/slice.js`
- Modify: `web/src/main.js`

- [ ] **Step 1: Write `web/src/scene/slice.js`**

```js
// web/src/scene/slice.js
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
    // Convert Float32 [0..1] RGBA to Uint8
    const u8 = this.texture.image.data;
    for (let i = 0; i < u8.length; i++) u8[i] = Math.max(0, Math.min(255, Math.round(rgbaFloat32[i] * 255)));
    this.texture.needsUpdate = true;
  }
}
```

- [ ] **Step 2: Wire into `main.js`**

```js
import { SliceLayer } from './scene/slice.js';

const slice = new SliceLayer(scene, 25, 256);
async function refreshSlice(plane, position, machMin, machMax) {
  const out = await bridge.buildSlice({
    plane, position, variable: 'Np', extent: 25, n: 256,
    filters: { ma_sw_min: machMin, ma_sw_max: machMax },
  });
  slice.setPlane(plane, position);
  // out.rgba is a Float32Array of length n*n*4
  slice.updateData(out.rgba.flat ? out.rgba.flat(Infinity) : out.rgba);
}
slice.show();
await refreshSlice('xy', 0, 1, 10);
```

- [ ] **Step 3: Visual verification**

Run dev server. Expected: a colored 256×256 plane appears between the boundaries. Dragging the camera shows it lies in z=0.

- [ ] **Step 4: Commit**

```bash
git add web/src/scene/slice.js web/src/main.js
git commit -m "feat(web): density slice plane with DataTexture"
```

### Task 7.6: Sidebar wiring (all controls)

**Files:**
- Create: `web/src/ui/sidebar.js`
- Modify: `web/src/main.js`
- Modify: `web/src/styles.css`

- [ ] **Step 1: Write `web/src/ui/sidebar.js`**

```js
// web/src/ui/sidebar.js
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

  // Wire change handlers — slider drag updates label only;
  // commit fires on 'change' (release) to throttle Python work.
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

  // r0
  root.querySelector('#r0').addEventListener('input', e => {
    root.querySelector('#r0-val').textContent = e.target.value;
  });
  root.querySelector('#r0').addEventListener('change', e => {
    state.r0 = parseFloat(e.target.value); onChange('r0', state.r0);
  });

  // slice position
  root.querySelector('#pos').addEventListener('input', e => {
    root.querySelector('#pos-val').textContent = e.target.value;
  });
  root.querySelector('#pos').addEventListener('change', e => {
    state.position = parseFloat(e.target.value); onChange('position', state.position);
  });

  // opacity — JS-only (no Python call)
  root.querySelector('#op').addEventListener('input', e => {
    state.opacity = parseFloat(e.target.value);
    root.querySelector('#op-val').textContent = e.target.value;
    onChange('opacity', state.opacity);
  });

  // mach min/max
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

  // slice plane buttons
  root.querySelectorAll('[data-plane]').forEach(btn => {
    btn.addEventListener('click', () => {
      state.plane = btn.dataset.plane;
      onChange('plane', state.plane);
    });
  });

  // camera view buttons
  root.querySelectorAll('[data-view]').forEach(btn => {
    btn.addEventListener('click', () => onChange('view', btn.dataset.view));
  });
}
```

- [ ] **Step 2: Wire into `main.js`**

Replace `main.js` with a full version that maintains state and dispatches:

```js
import * as bridge from './pyodide-bridge.js';
import * as THREE from 'three';
import { createScene } from './scene/scene.js';
import { makeBoundaryMesh } from './scene/boundaries.js';
import { makeEventMeshes } from './scene/events.js';
import { SliceLayer } from './scene/slice.js';
import { showPopup, hidePopup } from './ui/popup.js';
import { buildSidebar } from './ui/sidebar.js';

const loading = document.getElementById('loading');
loading.textContent = 'Loading Pyodide…';
await bridge.init();
loading.remove();

const { scene, camera, controls } = createScene(document.getElementById('viewport'));
scene.userData = { camera };

let mpMesh = null, bsMesh = null;
async function rebuildBoundaries(r0) {
  if (mpMesh) scene.remove(mpMesh);
  if (bsMesh) scene.remove(bsMesh);
  const mp = await bridge.buildBoundary('mp', { r0, alpha: 0.6 });
  const bs = await bridge.buildBoundary('bs', { pd: 2.0 });
  mpMesh = makeBoundaryMesh(mp, 0x00aaff, 0.12);
  bsMesh = makeBoundaryMesh(bs, 0xff6600, 0.08);
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

const slice = new SliceLayer(scene, 25, 256);
async function refreshSlice() {
  const out = await bridge.buildSlice({
    plane: state.plane, position: state.position, variable: 'Np',
    extent: 25, n: 256,
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

// Raycast click
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
```

- [ ] **Step 3: Visual verification end-to-end**

Run `npm run dev`. Test every control:
- Toggle MP, BS, mission checkboxes
- Drag r₀ → boundaries rebuild on release
- Enable density plane → colored mesh appears
- Switch plane (XY/XZ/YZ), drag position slider → slice repositions and rebuilds
- Drag opacity → plane fades smoothly without Python call
- Drag dual Mach slider → on release, colormap updates (visibly different at low vs high Mach)
- Click camera view buttons → camera snaps
- Click an event sphere → popup with DOI

- [ ] **Step 4: Commit**

```bash
git add web/src/ui/sidebar.js web/src/main.js
git commit -m "feat(web): full sidebar wiring + camera presets"
```

### Task 7.7: Production build + GitHub Pages workflow

**Files:**
- Create: `.github/workflows/deploy.yml`

- [ ] **Step 1: Verify local production build**

```bash
./scripts/build-wheel.sh
cd web && npm run build
npm run preview
```
Open the preview URL — full app must work as in Task 7.6.

- [ ] **Step 2: Write the GH Actions workflow**

```yaml
# .github/workflows/deploy.yml
name: Deploy

on:
  push:
    branches: [main]
  workflow_dispatch:

permissions:
  contents: read
  pages: write
  id-token: write

jobs:
  build-and-deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-python@v5
        with: { python-version: '3.11' }
      - run: pip install hatch
      - run: ./scripts/build-wheel.sh
      - uses: actions/setup-node@v4
        with: { node-version: '20' }
      - run: cd web && npm ci && npm run build
      - uses: actions/configure-pages@v5
      - uses: actions/upload-pages-artifact@v3
        with: { path: web/dist }
      - uses: actions/deploy-pages@v4
```

- [ ] **Step 3: Commit**

```bash
git add .github/workflows/deploy.yml
git commit -m "ci: GitHub Pages deploy workflow"
```

---

## Self-review

**Spec coverage:**
- Boundary models (Shue, Jelínek, tessellator) — Tasks 1.1–1.4 ✓
- Gridding — Task 2.1 ✓
- Colormap + colorbar info — Task 3.1 ✓
- Data source ABC, fake, remote stub, source switch — Tasks 5.1–5.5 ✓
- High-level explorer entry points — Task 6.1 ✓
- Wheel build — Task 6.2 ✓
- Pyodide loader + bridge — Task 7.2 ✓
- Three.js boundaries / events / slice — Tasks 7.3–7.5 ✓
- Sidebar + all controls + Mach dual slider + camera presets — Task 7.6 ✓
- GH Pages deploy — Task 7.7 ✓
- §8 definition of done — covered by Task 7.6 visual checklist + Task 7.7 production build ✓

**Placeholder scan:** No "TBD" / "handle edge cases" / "similar to" placeholders. Jelínek coefficients are concrete values with a verify-against-paper note (acceptable: the test asserts functional behavior, not absolute numerical values against external references).

**Type consistency:**
- `build_boundary` → `{positions, indices}` everywhere ✓
- `build_slice` → `{rgba, vmin, vmax, ticks}` everywhere ✓
- `build_events` → `{positions, meta}` everywhere ✓
- `bin_scattered_2d` returns `(grid, mask)`; `to_rgba(values, vmin, vmax, mask)` consumes that pair ✓
- `FakeSource(seed, n_points)` matches constructor call in `config.use_source` ✓

**Scope:** Single coherent POC. JS tasks are coarser (no TDD) but each has an explicit visual verification step.
