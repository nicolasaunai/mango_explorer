# Flow Lines and Magnetic Field Lines Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show 3D ion bulk-flow streamlines and magnetic field lines of the magnetosheath for the current frame, IMF selection, k and cap, each behind its own layer toggle.

**Architecture:** The Python atlas pipeline maps each sample's V and B into MANGO's normalized space (Jacobian of the radial normalization, approximation A1), rotates them into each frame, and stores per-voxel component sums next to the existing scalar voxel sums. The browser worker computes the k-NN 1/d-weighted mean vector from those sums on a lazily filled 0.5 R_E lattice, traces RK4 streamlines from automatic seeds, and the 3D view draws them with arrowheads.

**Tech Stack:** Python 3.13 + numpy (+ scipy in tests), pytest, ruff; TypeScript, Svelte 5 runes, three.js, vitest, svelte-check; Vite.

**Spec:** `docs/superpowers/specs/2026-10-09-flow-and-field-lines-design.md`

## Global Constraints

- Vector field = k-NN distance-weighted mean, weights 1/max(d, size_re/2), from full-data voxel sums, with the current k, cap, frame and selection, whatever the maps' statistics source (spec D4).
- Mapping (spec §1): `v_r,n = (ΔR*/ΔR)·v_r + [R*_mp' + D·ΔR*' − ΔR*·(R_mp' + D·ΔR')/ΔR]·v_θ/r`, `v_θ,n = (r_n/r)·v_θ`, `v_φ,n = (r_n/r)·v_φ`; A1: `R_mp' = (R_mp/R*_mp)·R*_mp'`, `R_bs' = (R_bs/R*_bs)·R*_bs'`. Same mapping for V and B.
- Frames: rotation about X as for positions; B flips sign under PGSM_fold when Bx_imf < 0; V never flips.
- Seeds: flow at D = 0.95, θ < 60°, traced forward; field on the shell at the depth slider's D, θ < 120°, traced both ways; density 50–400, default 150, spread evenly in solid angle.
- Tracing: RK4 on the unit direction, step 0.1 R_E, lattice 0.5 R_E (trilinear), stop when D < 0 or D > 1, θ ≥ 120°, field missing (cap) or ~0, or after 600 steps.
- Layers `flow` and `field` off by default; URL `ly=` (layers) and `ln=` (density, written only when ≠ 150).
- Caption: "lines: k-NN 1/d mean, k = …, cap … R_E · vectors mapped to normalized space". Warning on field lines: "field lines average opposite IMF orientations" when frame is PGSM (no fold) or GSM with a clock selection spanning more than 90°.
- Grid spec stays `grid-v2` (new `vectors` key is additive). New release tag `atlas-2026.0-grid-v2-vectors`.
- Repo conventions: Python env `.venv/bin/python`; web commands from `web/`; never chain `git commit`/`git push` after a check on the same command line (run checks, read the result, then commit); commit messages end with the session's attribution lines.

## Review Focus

1. A sample with missing `R_mp`/`R_bs` (or a NaN component) must drop out of the vector sums only, leaving every scalar statistic unchanged — test in Task 2.
2. A seed where the field is missing (outside the data or beyond the cap) must produce no line at all, not a dot — test in Task 4 (`pack` drops 1-point lines).
3. Near a stagnation point (field ≈ 0 at the nose) the tracer must stop or stay finite, never produce NaN points — test in Task 4.
4. Opening the site on an older atlas release without vector sums must keep the app working and show a clear message only for the lines — test in Task 3 (clear error); Task 6 routes it to `stats.linesError`, never `stats.error`; Task 8 shows it as a lines tag.
5. The subsolar point (θ = 0, where ê_θ is undefined) must not produce NaN mapped vectors — test in Task 1.

---

## File Structure

| File | Responsibility |
|------|----------------|
| `src/mango_explorer/atlas/vectors.py` (new) | Vector names, the normalization pushforward `to_normalized`, frame rotation `in_frame`, per-chunk `normalized_vectors`. |
| `src/mango_explorer/atlas/quantities.py` | `COLUMNS` gains `R_mp`, `R_bs`. |
| `src/mango_explorer/atlas/synthetic.py` | Synthetic rows gain `R_mp`, `R_bs` (scaled reference shapes). |
| `src/mango_explorer/atlas/prepare.py` | `Prepared.vectors`. |
| `src/mango_explorer/atlas/voxels.py` | `VoxelAccumulator` also sums vector components per frame. |
| `src/mango_explorer/spec/grid-v2.json` | New `vectors` section. |
| `scripts/make_goldens.py`, `golden/` | Vector voxel k-NN golden. |
| `web/src/core/voxels.ts` | Shared neighbour walk; `VoxelFrame.selectVector`; `voxelVectorAt`. |
| `web/src/core/lines.ts` (new) | Seeds, lattice field, RK4 tracer, polyline packing. |
| `web/src/workers/protocol.ts`, `stats.worker.ts`, `state/stats.svelte.ts`, `App.svelte` | `lines` request/reply and its client. |
| `web/src/state/schema.ts` | Layers `flow`/`field`, `density`, `mixesPolarity`. |
| `web/src/render/lines.ts` (new), `render/scene.ts`, `render/materials.ts` | Drawing lines with arrowheads. |
| `web/src/ui/QuantityPanel.svelte`, `ui/Viewport.svelte` | Toggles, density, caption, warning, legend. |
| `.github/workflows/deploy.yml` | `ATLAS_TAG` bump (Task 9). |

---

### Task 1: Vector mapping into normalized space and into frames (Python)

**Files:**
- Create: `src/mango_explorer/atlas/vectors.py`
- Test: `tests/atlas/test_vectors.py`

**Interfaces:**
- Consumes: `Grid.reference_radii()` → `(r_mp_ref(theta), r_bs_ref(theta))` (theta in radians); `atlas.frames.rotate_about_x(y, z, angle_rad)`.
- Produces:
  - `VECTORS: dict[str, tuple[tuple[str, str, str], bool]]` = `{"V_vec": (("Vx","Vy","Vz"), False), "B_vec": (("Bx","By","Bz"), True)}` (columns, magnetic)
  - `COMPONENTS: list[str]` = `["V_vec_x","V_vec_y","V_vec_z","B_vec_x","B_vec_y","B_vec_z"]`
  - `to_normalized(vec, xyz_norm, depth, r_mp, r_bs, grid) -> np.ndarray (n, 3)`
  - `in_frame(frame, vec, clock_deg, bx_neg, magnetic) -> np.ndarray (n, 3)`
  - `normalized_vectors(cols, grid) -> dict[str, np.ndarray]` (name → (n, 3), NaN rows where inputs are missing)

- [ ] **Step 1: Write the failing tests**

```python
# tests/atlas/test_vectors.py
import numpy as np
import pytest

from mango_explorer.atlas import frames as fr
from mango_explorer.atlas.grid import load_grid
from mango_explorer.atlas.vectors import in_frame, normalized_vectors, to_normalized

G = load_grid()
REF_MP, REF_BS = G.reference_radii()


def _sample(theta, phi, depth, a, b):
    """A sample at depth `depth` between boundaries a*R*_mp and b*R*_bs (approximation A1 holds exactly)."""
    mp, bs = a * REF_MP(theta), b * REF_BS(theta)
    rn = REF_MP(theta) + depth * (REF_BS(theta) - REF_MP(theta))
    d = np.array([np.cos(theta), np.sin(theta) * np.cos(phi), np.sin(theta) * np.sin(phi)])
    return rn * d, mp, bs


def _tangent(f, theta, phi, h=1e-6):
    """d/dtheta of the surface point f(theta) * r_hat(theta, phi): a tangent in the meridian plane."""
    def pt(t):
        return f(t) * np.array([np.cos(t), np.sin(t) * np.cos(phi), np.sin(t) * np.sin(phi)])
    return (pt(theta + h) - pt(theta - h)) / (2 * h)


def _map(v, xyz, depth, mp, bs):
    return to_normalized(np.atleast_2d(v), xyz[None], np.array([depth]), np.array([mp]), np.array([bs]), G)[0]


@pytest.mark.parametrize("theta", [0.3, 0.9, 1.5])
@pytest.mark.parametrize("which", ["mp", "bs"])
def test_tangent_to_the_sample_boundary_maps_tangent_to_the_reference(theta, which):
    a, b, phi = 0.9, 1.15, 0.7
    depth = 0.0 if which == "mp" else 1.0
    xyz, mp, bs = _sample(theta, phi, depth, a, b)
    sample = (lambda t: a * REF_MP(t)) if which == "mp" else (lambda t: b * REF_BS(t))
    ref = REF_MP if which == "mp" else REF_BS
    out, want = _map(_tangent(sample, theta, phi), xyz, depth, mp, bs), _tangent(ref, theta, phi)
    assert out @ want / np.linalg.norm(out) / np.linalg.norm(want) == pytest.approx(1.0, abs=1e-6)


def test_radial_vector_stays_radial_and_scales_with_the_sheath_thickness():
    theta, phi, depth, a, b = 0.6, 2.0, 0.4, 0.9, 1.2
    xyz, mp, bs = _sample(theta, phi, depth, a, b)
    er = xyz / np.linalg.norm(xyz)
    k = (REF_BS(theta) - REF_MP(theta)) / (bs - mp)
    np.testing.assert_allclose(_map(3.0 * er, xyz, depth, mp, bs), 3.0 * k * er, rtol=1e-9, atol=1e-12)


def test_identity_when_the_sample_boundaries_are_the_reference():
    rng = np.random.default_rng(3)
    for _ in range(20):
        theta, phi, depth = rng.uniform(0, 1.9), rng.uniform(0, 2 * np.pi), rng.uniform(0, 1)
        xyz, mp, bs = _sample(theta, phi, depth, 1.0, 1.0)
        v = rng.normal(0, 100, 3)
        np.testing.assert_allclose(_map(v, xyz, depth, mp, bs), v, rtol=1e-6, atol=1e-6)


def test_subsolar_point_gives_finite_vectors():
    xyz, mp, bs = _sample(0.0, 0.0, 0.5, 0.9, 1.1)
    assert np.all(np.isfinite(_map([-300.0, 20.0, 10.0], xyz, 0.5, mp, bs)))


def test_missing_boundaries_give_nan_vectors():
    xyz, _, bs = _sample(0.5, 0.0, 0.5, 1.0, 1.0)
    assert np.all(np.isnan(_map([1.0, 0.0, 0.0], xyz, 0.5, np.nan, bs)))


def test_in_frame_matches_vector_to_frame():
    rng = np.random.default_rng(4)
    imf, vec = rng.normal(0, 5, (50, 3)), rng.normal(0, 10, (50, 3))
    clock = fr.clock_angle_deg(imf[:, 1], imf[:, 2])
    for frame in fr.FRAMES:
        for magnetic in (False, True):
            want = np.stack(fr.vector_to_frame(frame, *vec.T, magnetic=magnetic,
                                               bx_imf=imf[:, 0], by_imf=imf[:, 1], bz_imf=imf[:, 2]), 1)
            np.testing.assert_allclose(in_frame(frame, vec, clock, imf[:, 0] < 0, magnetic), want, atol=1e-9)


def test_normalized_vectors_without_boundary_columns_are_nan():
    cols = {c: np.ones(3) for c in ("Vx", "Vy", "Vz", "Bx", "By", "Bz", "R_norm")}
    cols |= {"X_gsm_norm": np.full(3, 12.0), "Y_gsm_norm": np.zeros(3), "Z_gsm_norm": np.zeros(3)}
    out = normalized_vectors(cols, G)
    assert set(out) == {"V_vec", "B_vec"} and np.all(np.isnan(out["V_vec"]))
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `.venv/bin/python -m pytest tests/atlas/test_vectors.py -q`
Expected: FAIL — `ModuleNotFoundError: No module named 'mango_explorer.atlas.vectors'`

- [ ] **Step 3: Write the implementation**

```python
# src/mango_explorer/atlas/vectors.py
"""Vectors (ion velocity, magnetic field) for flow and field lines, see grid spec "vectors".

MANGO normalizes every position radially between the sample's own boundaries (R_mp, R_bs along its
direction) and fixed reference surfaces. A line through the data maps with the Jacobian of that
mapping, so each vector is pushed forward before averaging; tangents to the sample's boundaries then
stay tangent to the reference ones. The sample's boundary slopes are not served: they are taken from
the reference shapes, scaled by R_mp / R*_mp and R_bs / R*_bs (approximation A1).
"""
from __future__ import annotations

import numpy as np

from mango_explorer.atlas.frames import rotate_about_x
from mango_explorer.atlas.grid import Grid

VECTORS = {"V_vec": (("Vx", "Vy", "Vz"), False), "B_vec": (("Bx", "By", "Bz"), True)}
COMPONENTS = [f"{name}_{c}" for name in VECTORS for c in "xyz"]
_H = 1e-5


def _slope(f, theta):
    """d f / d theta (central difference; one-sided at the subsolar point)."""
    lo = np.maximum(theta - _H, 0.0)
    return (f(theta + _H) - f(lo)) / (theta + _H - lo)


def to_normalized(vec, xyz_norm, depth, r_mp, r_bs, grid: Grid) -> np.ndarray:
    """Push GSM vectors (n, 3) at normalized positions (n, 3) through MANGO's radial normalization.

    `depth` is MANGO's R_norm, (|r| - R_mp) / (R_bs - R_mp); r_mp, r_bs the sample's own boundaries.
    """
    vec, p = np.asarray(vec, dtype=float), np.asarray(xyz_norm, dtype=float)
    depth, r_mp, r_bs = (np.asarray(a, dtype=float) for a in (depth, r_mp, r_bs))
    with np.errstate(invalid="ignore", divide="ignore"):
        rn = np.linalg.norm(p, axis=1)
        er = p / rn[:, None]
        theta = np.arccos(np.clip(er[:, 0], -1.0, 1.0))
        rho = np.hypot(p[:, 1], p[:, 2])
        cphi = np.where(rho > 0, p[:, 1] / np.where(rho > 0, rho, 1.0), 1.0)
        sphi = np.where(rho > 0, p[:, 2] / np.where(rho > 0, rho, 1.0), 0.0)
        et = np.stack([-np.sin(theta), np.cos(theta) * cphi, np.cos(theta) * sphi], axis=1)
        ep = np.stack([np.zeros_like(theta), -sphi, cphi], axis=1)

        ref_mp, ref_bs = grid.reference_radii()
        mp_ref, bs_ref = ref_mp(theta), ref_bs(theta)
        dmp_ref, dbs_ref = _slope(ref_mp, theta), _slope(ref_bs, theta)
        dmp, dbs = r_mp / mp_ref * dmp_ref, r_bs / bs_ref * dbs_ref       # A1: scaled reference slopes
        thick, thick_ref = r_bs - r_mp, bs_ref - mp_ref
        r = r_mp + depth * thick

        vr, vt, vp = (vec * er).sum(1), (vec * et).sum(1), (vec * ep).sum(1)
        vr_n = (thick_ref / thick * vr
                + (dmp_ref + depth * (dbs_ref - dmp_ref) - thick_ref * (dmp + depth * (dbs - dmp)) / thick) * vt / r)
        k = rn / r
        return vr_n[:, None] * er + (k * vt)[:, None] * et + (k * vp)[:, None] * ep


def in_frame(frame: str, vec, clock_deg, bx_neg, magnetic: bool) -> np.ndarray:
    """GSM vectors (n, 3) expressed in `frame`; magnetic vectors flip under PGSM_fold when Bx_imf < 0."""
    vec = np.asarray(vec, dtype=float)
    if frame == "GSM":
        return vec.copy()
    angle = np.radians(np.asarray(clock_deg, dtype=float))
    flip = np.zeros(len(vec), dtype=bool)
    if frame == "PGSM_fold":
        bx_neg = np.asarray(bx_neg, dtype=bool)
        angle = angle + np.pi * bx_neg
        if magnetic:
            flip = bx_neg
    y, z = rotate_about_x(vec[:, 1], vec[:, 2], angle)
    out = np.stack([vec[:, 0], y, z], axis=1)
    return np.where(flip[:, None], -out, out)


def normalized_vectors(cols: dict[str, np.ndarray], grid: Grid) -> dict[str, np.ndarray]:
    """Every vector of VECTORS, pushed into normalized GSM space; NaN where an input is missing."""
    n = len(cols["R_norm"])
    nan = np.full(n, np.nan)
    xyz = np.stack([np.asarray(cols[c], dtype=float) for c in ("X_gsm_norm", "Y_gsm_norm", "Z_gsm_norm")], axis=1)
    depth = np.asarray(cols["R_norm"], dtype=float)
    r_mp = np.asarray(cols.get("R_mp", nan), dtype=float)
    r_bs = np.asarray(cols.get("R_bs", nan), dtype=float)
    return {name: to_normalized(np.stack([np.asarray(cols[c], dtype=float) for c in comps], axis=1),
                                xyz, depth, r_mp, r_bs, grid)
            for name, (comps, _) in VECTORS.items()}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `.venv/bin/python -m pytest tests/atlas/test_vectors.py -q`
Expected: 12 passed. Then `.venv/bin/ruff check src/mango_explorer/atlas tests/atlas` → no errors.

- [ ] **Step 5: Commit**

```bash
git add src/mango_explorer/atlas/vectors.py tests/atlas/test_vectors.py
git commit -m "feat(atlas): push V and B through MANGO's normalization and into frames"
```

---

### Task 2: Vector voxel sums in the atlas pipeline

**Files:**
- Modify: `src/mango_explorer/atlas/quantities.py` (`COLUMNS`)
- Modify: `src/mango_explorer/atlas/synthetic.py` (emit `R_mp`, `R_bs`)
- Modify: `src/mango_explorer/atlas/prepare.py` (`Prepared.vectors`)
- Modify: `src/mango_explorer/atlas/voxels.py` (`VoxelAccumulator`)
- Modify: `src/mango_explorer/spec/grid-v2.json` (new `vectors` key)
- Test: `tests/atlas/test_voxels.py`

**Interfaces:**
- Consumes: Task 1 `VECTORS`, `COMPONENTS`, `in_frame`, `normalized_vectors`.
- Produces: voxel frame entries whose `quantities` include `V_vec_x … B_vec_z` (same `{"n", "sum"}` arrays as scalars; the count covers samples with all three components finite); `Prepared.vectors: dict[str, np.ndarray] | None`.

- [ ] **Step 1: Write the failing tests** (append to `tests/atlas/test_voxels.py`)

```python
from mango_explorer.atlas.binning import flat_condition_index
from mango_explorer.atlas.vectors import COMPONENTS, in_frame


def _all_conds():
    return list(range(int(np.prod(G.cube_shape("clock-cone-Ma")))))


def _kept(prep, frame):
    cond = flat_condition_index(prep.cond_bins, G.cube_dims("clock-cone-Ma"), G.cube_shape("clock-cone-Ma"))
    return (cond >= 0) & (prep.cells[frame] >= 0)


def test_vector_voxel_sums_match_rows_and_b_flips_under_the_fold():
    df = synthetic_magnetosheath(60_000, seed=12)
    prep = prepare(columns_from_polars(df), G)
    for frame in ("PGSM", "PGSM_fold"):
        acc = VoxelAccumulator(G, "clock-cone-Ma", frame)
        acc.add(prep)
        vox = acc.finalize()
        assert set(COMPONENTS) <= set(vox["quantities"])
        for name, magnetic in (("V_vec", False), ("B_vec", True)):
            vec = in_frame(frame, prep.vectors[name], prep.clock_deg, prep.bx_neg, magnetic)
            ok = _kept(prep, frame) & np.all(np.isfinite(vec), axis=1)
            for i, c in enumerate("xyz"):
                _, n, s = select_voxels(vox["base"], vox["quantities"][f"{name}_{c}"], _all_conds())
                assert int(n.sum()) == int(ok.sum())
                assert np.isclose(s.sum(), vec[ok, i].sum(), rtol=1e-4, atol=1e-3)


def test_rows_without_boundaries_leave_scalars_unchanged():
    df = synthetic_magnetosheath(30_000, seed=13)
    cols = {k: np.array(v, copy=True) for k, v in columns_from_polars(df).items()}
    full = VoxelAccumulator(G, "clock-cone-Ma", "PGSM_fold")
    full.add(prepare(cols, G))
    cols["R_mp"][::10] = np.nan
    holed = VoxelAccumulator(G, "clock-cone-Ma", "PGSM_fold")
    holed.add(prepare(cols, G))
    a, b = full.finalize(), holed.finalize()
    for q in G.quantity_names:
        np.testing.assert_array_equal(a["quantities"][q]["n"], b["quantities"][q]["n"])
    na = select_voxels(a["base"], a["quantities"]["V_vec_x"], _all_conds())[1].sum()
    nb = select_voxels(b["base"], b["quantities"]["V_vec_x"], _all_conds())[1].sum()
    assert 0.85 * na < nb < 0.95 * na
```

- [ ] **Step 2: Run them to verify they fail**

Run: `.venv/bin/python -m pytest tests/atlas/test_voxels.py -q -k "vector or boundaries"`
Expected: FAIL — `AttributeError: 'Prepared' object has no attribute 'vectors'` (or `KeyError: 'R_mp'`).

- [ ] **Step 3: Implement**

`quantities.py` — add the two columns to `COLUMNS` (after `"R_norm"`):

```python
    "R_norm", "R_mp", "R_bs", "Norma_pos", "SW_pairing", "X_gsm_norm", "Y_gsm_norm", "Z_gsm_norm",
```

`synthetic.py` — the sample's own boundaries are scaled reference shapes (A1 holds exactly). Use a separate generator so every existing synthetic value (and the committed goldens) stays the same. After `r_mp, r_bs = ref_mp(theta), ref_bs(theta)` keep the positions as they are, and add before the `return`:

```python
    scale = np.random.default_rng(seed + 1000)
    a_mp = per(scale.lognormal(0.0, 0.06, n_pass))
    a_bs = per(scale.lognormal(0.0, 0.06, n_pass))
```

and in the returned DataFrame:

```python
        "R_norm": d, "R_mp": a_mp * r_mp, "R_bs": a_bs * r_bs,
```

`prepare.py` — import `from mango_explorer.atlas.vectors import normalized_vectors`, add the field `vectors: dict[str, np.ndarray] | None = None` to `Prepared` (after `values`), and pass `vectors=normalized_vectors(kept, grid),` in the `Prepared(...)` call.

`voxels.py` — import `from mango_explorer.atlas.vectors import COMPONENTS, VECTORS, in_frame`; in `__init__` register the components:

```python
        self._parts: dict[str, list[tuple[np.ndarray, np.ndarray, np.ndarray]]] = {
            q: [] for q in [*grid.quantity_names, *COMPONENTS]}
```

and replace the body of `add` after `key = (cond << 32) + vid`:

```python
        for q, v in prep.values.items():
            m = ok & np.isfinite(v)
            u, inv = np.unique(key[m], return_inverse=True)
            self._push(q, u, np.bincount(inv, minlength=len(u)), np.bincount(inv, weights=v[m], minlength=len(u)))
        if prep.vectors is None:
            return
        for name, (_, magnetic) in VECTORS.items():
            vec = in_frame(self.frame, prep.vectors[name], prep.clock_deg, prep.bx_neg, magnetic)
            m = ok & np.all(np.isfinite(vec), axis=1)
            u, inv = np.unique(key[m], return_inverse=True)
            n = np.bincount(inv, minlength=len(u))
            for i, c in enumerate("xyz"):
                self._push(f"{name}_{c}", u, n, np.bincount(inv, weights=vec[m, i], minlength=len(u)))

    def _push(self, q, u, n, s) -> None:
        self._parts[q].append((u, n, s))
        if len(self._parts[q]) >= 8:
            self._parts[q] = [self._merge(self._parts[q])]
```

`grid-v2.json` — add after `"voxels"` (keep valid JSON: comma after the `voxels` object):

```json
  "vectors": {
    "names": {
      "V_vec": {"columns": ["Vx", "Vy", "Vz"], "magnetic": false},
      "B_vec": {"columns": ["Bx", "By", "Bz"], "magnetic": true}
    },
    "mapping": "Each sample's GSM vector is pushed forward through MANGO's radial normalization r_n = R*_mp + D (R*_bs - R*_mp), D = (r - R_mp)/(R_bs - R_mp): v_r,n = (dR*/dR) v_r + [R*_mp' + D dR*' - dR* (R_mp' + D dR')/dR] v_theta / r, v_theta,n = (r_n/r) v_theta, v_phi,n = (r_n/r) v_phi, with ' = d/dtheta, dR = R_bs - R_mp, * = reference_boundaries. The sample's slopes are the reference slopes scaled by R_mp/R*_mp and R_bs/R*_bs (approximation A1).",
    "frame": "Rotated about X like positions; magnetic vectors flip sign under PGSM_fold when Bx_imf < 0.",
    "voxels": "Voxel quantities <name>_x, <name>_y, <name>_z: per (frame, condition bin, voxel) the count of samples with all three mapped components finite and the sum of each component in the frame. The vector field is the voxel k-NN mean of each component (voxels.knn, distance-weighted)."
  }
```

- [ ] **Step 4: Run all Python tests and lint**

Run: `.venv/bin/python -m pytest -q` → all pass (existing goldens unchanged because synthetic values are unchanged).
Run: `.venv/bin/ruff check src/mango_explorer/atlas src/mango_explorer/boundaries.py tests/atlas scripts` → clean.
Run: `.venv/bin/python scripts/make_goldens.py && git diff --stat -- golden/core.json` → `core.json` unchanged (atlas-mini binaries change: new voxel files). Note: Task 3 regenerates them anyway.

- [ ] **Step 5: Commit**

```bash
git add src/mango_explorer/atlas/quantities.py src/mango_explorer/atlas/synthetic.py src/mango_explorer/atlas/prepare.py \
  src/mango_explorer/atlas/voxels.py src/mango_explorer/spec/grid-v2.json tests/atlas/test_voxels.py golden/
git commit -m "feat(atlas): voxel sums of the mapped V and B per frame"
```

---

### Task 3: Vector voxel k-NN in the browser, checked against Python goldens

**Files:**
- Modify: `scripts/make_goldens.py` (new `vector_voxel_golden`, added to `atlas_mini()`)
- Modify: `golden/core.json`, `golden/atlas-mini/**` (regenerated)
- Modify: `web/src/core/voxels.ts`
- Test: `web/src/core/core.test.ts`

**Interfaces:**
- Consumes: Task 2 voxel quantities `V_vec_x … B_vec_z`; Python `select_voxels`, `voxel_knn`.
- Produces (TS, `web/src/core/voxels.ts`):
  - `type VectorName = 'V_vec' | 'B_vec'`
  - `type VectorVoxelSet = { vid: Uint32Array; n: Float64Array; sums: [Float64Array, Float64Array, Float64Array]; centers: Float64Array; hash: SpatialHash; total: number }`
  - `VoxelFrame.selectVector(name: VectorName, sel: Selection, cell: number, g?: Grid): Promise<VectorVoxelSet>` — rejects with `this atlas has no <name> voxel sums (rebuild it)` when the files are missing
  - `voxelVectorAt(v: VectorVoxelSet, node: [number, number, number], k: number, cap: number, factor: number, g?: Grid): [number, number, number] | null` (1/d-weighted; null where the scalar rule gives NaN)
  - `voxelKnnAt` unchanged in signature and results.

- [ ] **Step 1: Add the Python golden** in `scripts/make_goldens.py`

```python
def vector_voxel_golden(root, manifest, sel):
    entry = next(v for v in manifest["voxels"]["frames"] if v["frame"] == "PGSM_fold")
    base, qs = read_voxels(root, entry)
    conds = cubes_selected(manifest, sel)
    k, cap = 300, 3.0
    vid, _, _ = select_voxels(base, qs["B_vec_x"], conds)
    rng = np.random.default_rng(12)
    centers = voxel_centers(vid, G)
    nodes = np.concatenate([centers[rng.choice(len(centers), 8, replace=False)] + rng.normal(0, 0.4, (8, 3)),
                            [[0.0, 40.0, 0.0]]])
    out = {"k": k, "cap": cap, "nodes": lst(nodes)}
    for name in ("V_vec", "B_vec"):
        comps = []
        for c in "xyz":
            v_c, n_c, s_c = select_voxels(base, qs[f"{name}_{c}"], conds)
            comps.append(voxel_knn(nodes, v_c, n_c, s_c, G, k=k, cap=cap)["value"])
        out[name] = [[None if not np.isfinite(x) else round(float(x), 12) for x in row] for row in np.stack(comps, 1)]
    return out
```

and in `atlas_mini()` add `"vector_knn": vector_voxel_golden(out, manifest, sel),` to the returned dict (next to `"voxel_knn": vox`).

Run: `.venv/bin/python scripts/make_goldens.py` → prints `wrote …`. Check `git diff --stat golden/core.json` shows only additions.

- [ ] **Step 2: Write the failing vitest** (inside `describe('voxel k-NN', …)` in `web/src/core/core.test.ts`)

```ts
  it('reproduces the Python vector voxel k-NN (V and B)', async () => {
    const { VoxelFrame, voxelVectorAt } = await import('./voxels');
    const ref = golden.atlas_mini, gv = ref.vector_knn;
    const frame = await VoxelFrame.load(await loadManifest(fetchBytes), 'PGSM_fold', fetchBytes);
    for (const name of ['V_vec', 'B_vec'] as const) {
      const set = await frame.selectVector(name, ref.selection, gv.cap / 2);
      gv.nodes.forEach((node, i) => {
        const r = voxelVectorAt(set, node as [number, number, number], gv.k, gv.cap, grid.raw.knn.search_factor);
        const want = gv[name][i];
        if (want[0] === null) expect(r).toBeNull();
        else want.forEach((w, c) => close(r![c], w as number, 1e-6, 1e-9));
      });
    }
  });
  it('says clearly when the atlas has no vector sums', async () => {
    const { VoxelFrame } = await import('./voxels');
    const m = structuredClone(await loadManifest(fetchBytes));
    for (const f of m.voxels!.frames) for (const c of 'xyz') delete f.quantities[`B_vec_${c}`];
    const frame = await VoxelFrame.load(m, 'PGSM_fold', fetchBytes);
    await expect(frame.selectVector('B_vec', golden.atlas_mini.selection, 1)).rejects.toThrow(/no B_vec voxel sums/);
  });
```

Run: `cd web && npx vitest run src/core/core.test.ts`
Expected: FAIL — `frame.selectVector is not a function`.

- [ ] **Step 3: Implement in `web/src/core/voxels.ts`**

Replace `voxelKnnAt` with a shared neighbour walk plus two thin wrappers (the walk is the current body of `voxelKnnAt`, with `add` turned into a callback; the scalar results must not change — the existing golden test checks it):

```ts
type Walkable = { vid: Uint32Array; n: Float64Array; hash: SpatialHash };

/** Visit the voxels holding a node's k nearest samples (grid spec "voxels.knn"): `use(i, taken, d)` for each
 * voxel, the last one only partly. Returns the samples used, voxels used and the median distance
 * (NaN, and nothing visited, when fewer than ceil(k/2) samples lie within factor * cap). */
function walkNeighbours(v: Walkable, node: [number, number, number], k: number, cap: number, factor: number,
  g: Grid, use: (i: number, taken: number, d: number) => void) {
  const size = g.raw.voxels.size_re, maxR = factor * cap, half = Math.ceil(k / 2);
  const out = { n: 0, nVoxels: 0, distMedian: NaN };
  let m = 0, r = Math.min(maxR, Math.max(size, maxR / 8));
  for (; ; r = Math.min(2 * r, maxR)) {
    m = v.hash.within(node[0], node[1], node[2], r);
    let tot = 0;
    for (let j = 0; j < m; j++) tot += v.n[v.hash.candidateIndex(j)];
    if (tot >= k || r >= maxR) break;
  }
  if (m > cIdx.length) { cIdx = new Int32Array(2 * m); cDist = new Float64Array(2 * m); cShell = new Int32Array(2 * m); }
  const width = size / 4, nShell = Math.floor(r / width) + 2;
  const shellN = new Float64Array(nShell);
  for (let j = 0; j < m; j++) {
    const i = v.hash.candidateIndex(j), d = Math.sqrt(v.hash.candidateD2(j)), sh = Math.min(nShell - 1, Math.floor(d / width));
    cIdx[j] = i; cDist[j] = d; cShell[j] = sh; shellN[sh] += v.n[i];
  }
  let cum = 0, shellK = -1, shellHalf = -1, beforeK = 0, beforeHalf = 0;
  for (let s = 0; s < nShell; s++) {
    if (shellHalf < 0 && cum + shellN[s] >= half) { shellHalf = s; beforeHalf = cum; }
    if (shellK < 0 && cum + shellN[s] >= k) { shellK = s; beforeK = cum; }
    cum += shellN[s];
  }
  if (shellHalf < 0) return out;
  const ordered = (s: number) => {
    const list: number[] = [];
    for (let j = 0; j < m; j++) if (cShell[j] === s) list.push(j);
    return list.sort((a, b) => cDist[a] - cDist[b] || v.vid[cIdx[a]] - v.vid[cIdx[b]]);
  };
  let c = beforeHalf;
  for (const j of ordered(shellHalf)) { c += v.n[cIdx[j]]; if (c >= half) { out.distMedian = cDist[j]; break; } }
  const last = shellK < 0 ? nShell - 1 : shellK;
  const take = (j: number, t: number) => { use(cIdx[j], t, cDist[j]); out.n += t; out.nVoxels++; };
  for (let j = 0; j < m; j++) if (cShell[j] < last) take(j, v.n[cIdx[j]]);
  c = shellK < 0 ? cum - shellN[last] : beforeK;
  for (const j of ordered(last)) {
    const n = v.n[cIdx[j]];
    if (c + n >= k) { take(j, k - c); c = k; break; }
    take(j, n); c += n;
  }
  return out;
}

export function voxelKnnAt(v: VoxelSet, node: [number, number, number], k: number, cap: number, factor: number,
  weighted: boolean, g: Grid = defaultGrid): VoxelKnnResult {
  const size = g.raw.voxels.size_re;
  let num = 0, den = 0;
  const w = walkNeighbours(v, node, k, cap, factor, g, (i, t, d) => {
    const wt = weighted ? 1 / Math.max(d, size / 2) : 1;
    num += (wt * t * v.sum[i]) / v.n[i]; den += wt * t;
  });
  const out: VoxelKnnResult = { value: NaN, n: w.n, nVoxels: w.nVoxels, distMedian: w.distMedian };
  if (!(w.distMedian <= cap)) return out;
  out.value = num / den;
  return out;
}

export type VectorName = 'V_vec' | 'B_vec';
export type VectorVoxelSet = { vid: Uint32Array; n: Float64Array; sums: [Float64Array, Float64Array, Float64Array];
  centers: Float64Array; hash: SpatialHash; total: number };

/** 1/d-weighted k-NN mean vector of a node (each component as voxelKnnAt), or null where that is NaN. */
export function voxelVectorAt(v: VectorVoxelSet, node: [number, number, number], k: number, cap: number, factor: number,
  g: Grid = defaultGrid): [number, number, number] | null {
  const size = g.raw.voxels.size_re;
  const num = [0, 0, 0];
  let den = 0;
  const w = walkNeighbours(v, node, k, cap, factor, g, (i, t, d) => {
    const wt = 1 / Math.max(d, size / 2);
    for (let c = 0; c < 3; c++) num[c] += (wt * t * v.sums[c][i]) / v.n[i];
    den += wt * t;
  });
  if (!(w.distMedian <= cap)) return null;
  return [num[0] / den, num[1] / den, num[2] / den];
}
```

Add to `class VoxelFrame`:

```ts
  /** Sum the selected condition bins of a vector's three component sums (counts are shared). */
  async selectVector(name: VectorName, sel: Selection, cell: number, g: Grid = defaultGrid): Promise<VectorVoxelSet> {
    const files = (['x', 'y', 'z'] as const).map((c) => this.entry.quantities[`${name}_${c}`]);
    if (files.some((f) => !f)) throw new Error(`this atlas has no ${name} voxel sums (rebuild it)`);
    const comps = await Promise.all(files.map((f) => loadSections(this.fetchBytes, f) as Promise<Record<string, Typed>>));
    const cube = this.manifest.cubes[0];
    const conds = selectedConditions(cube.dims, cube.shape, sel);
    const off = this.base.cond_offsets, vox = this.base.voxel, qn = comps[0].n;
    const index = new Map<number, number>();
    const vids: number[] = [], ns: number[] = [], ss: [number[], number[], number[]] = [[], [], []];
    for (const c of conds)
      for (let r = off[c]; r < off[c + 1]; r++) {
        if (qn[r] === 0) continue;
        const v = vox[r];
        let i = index.get(v);
        if (i === undefined) { i = vids.length; index.set(v, i); vids.push(v); ns.push(0); ss.forEach((s) => s.push(0)); }
        ns[i] += qn[r];
        for (let k = 0; k < 3; k++) ss[k][i] += comps[k].sum[r];
      }
    const centers = new Float64Array(vids.length * 3);
    vids.forEach((v, i) => centers.set(voxelCenter(v, g), 3 * i));
    return { vid: Uint32Array.from(vids), n: Float64Array.from(ns),
      sums: [Float64Array.from(ss[0]), Float64Array.from(ss[1]), Float64Array.from(ss[2])], centers,
      hash: new SpatialHash(centers, cell), total: ns.reduce((a, b) => a + b, 0) };
  }
```

- [ ] **Step 4: Run the web checks**

Run: `cd web && npx vitest run` → all pass (old voxel golden included). `npx svelte-check --tsconfig ./tsconfig.json` → 0 errors.

- [ ] **Step 5: Commit**

```bash
git add scripts/make_goldens.py golden/ web/src/core/voxels.ts web/src/core/core.test.ts
git commit -m "feat(web): vector voxel k-NN, matching the Python goldens"
```

---

### Task 4: Seeds, lattice field and RK4 tracer (pure TypeScript)

**Files:**
- Create: `web/src/core/lines.ts`
- Test: `web/src/core/lines.test.ts`

**Interfaces:**
- Consumes: `positionAt(d, thetaDeg, phiDeg, b)` from `./knn`; `normalizedCoords(p, b)` and `type Boundaries` from `./geometry`.
- Produces:
  - `type Vec3 = [number, number, number]`, `type VectorField = (p: Vec3) => Vec3 | null`
  - `LINE = { step: 0.1, maxSteps: 600, lattice: 0.5, flowDepth: 0.95, flowThetaMax: 60, fieldThetaMax: 120 }`
  - `seeds(n, d, thetaMaxDeg, b): Vec3[]`, `flowSeeds(n, b)`, `fieldSeeds(n, d, b)`
  - `latticeField(evaluate: VectorField, h?: number): VectorField & { evaluations(): number }`
  - `insideSheath(b, thetaMaxDeg?): (p: Vec3) => boolean`
  - `trace(field, seed, dir: 1 | -1, o: TraceOptions): Vec3[]`, `traceBoth(field, seed, o): Vec3[]`, `type TraceOptions = { step: number; maxSteps: number; inside: (p: Vec3) => boolean }`
  - `type Polylines = { points: Float32Array; offsets: Uint32Array }`, `pack(lines: Vec3[][]): Polylines` (line i = points `[3·offsets[i], 3·offsets[i+1])`; lines with < 2 points dropped)

- [ ] **Step 1: Write the failing tests**

```ts
// web/src/core/lines.test.ts
import { describe, expect, it } from 'vitest';
import { LINE, fieldSeeds, flowSeeds, insideSheath, latticeField, pack, seeds, trace, traceBoth, type Vec3 } from './lines';
import { normalizedCoords } from './geometry';

const b = { rMp: () => 10, rBs: () => 14 };
const always = { step: 0.1, maxSteps: 10, inside: () => true };

describe('seeds', () => {
  it('n seeds on the shell at depth d, spread evenly in solid angle', () => {
    const s = seeds(400, 0.3, 60, b);
    expect(s).toHaveLength(400);
    for (const p of s) expect(normalizedCoords(p, b).d).toBeCloseTo(0.3, 9);
    const inner = s.filter((p) => normalizedCoords(p, b).thetaDeg < 30).length / s.length;
    expect(inner).toBeCloseTo((1 - Math.cos(Math.PI / 6)) / (1 - Math.cos(Math.PI / 3)), 1);
  });
  it('flow seeds sit just inside the bow shock on the dayside; field seeds on the chosen shell', () => {
    for (const p of flowSeeds(50, b)) {
      const n = normalizedCoords(p, b);
      expect(n.d).toBeCloseTo(LINE.flowDepth, 9);
      expect(n.thetaDeg).toBeLessThan(LINE.flowThetaMax);
    }
    expect(fieldSeeds(50, 0.4, b).every((p) => Math.abs(normalizedCoords(p, b).d - 0.4) < 1e-9)).toBe(true);
  });
});

describe('lattice field', () => {
  it('reproduces a linear field exactly between lattice nodes, evaluating each node once', () => {
    const f = latticeField((p) => [2 * p[0] + 1, -p[1], 3 * p[2] - p[0]], 0.5);
    const v = f([0.37, -1.12, 2.05])!;
    expect(v[0]).toBeCloseTo(2 * 0.37 + 1, 12);
    expect(v[1]).toBeCloseTo(1.12, 12);
    expect(v[2]).toBeCloseTo(3 * 2.05 - 0.37, 12);
    const once = f.evaluations();
    f([0.38, -1.11, 2.06]);
    expect(f.evaluations()).toBe(once);
  });
  it('is missing where any corner is missing', () => {
    const f = latticeField((p) => (p[0] >= 1 ? null : [1, 0, 0]), 0.5);
    expect(f([0.2, 0, 0])).not.toBeNull();
    expect(f([0.9, 0, 0])).toBeNull();
  });
});

describe('tracer', () => {
  it('a uniform field gives a straight line of maxSteps steps', () => {
    const line = trace(() => [3, 0, 0], [0, 0, 0], 1, always);
    expect(line).toHaveLength(11);
    expect(line[10][0]).toBeCloseTo(1.0, 12);
  });
  it('a circular field about X keeps its radius and closes on itself', () => {
    const steps = Math.round((2 * Math.PI * 5) / 0.05);
    const line = trace((p) => [0, -p[2], p[1]], [0, 5, 0], 1, { step: 0.05, maxSteps: steps, inside: () => true });
    for (const p of line) expect(Math.hypot(p[1], p[2])).toBeCloseTo(5, 6);
    const end = line[line.length - 1];
    expect(Math.hypot(end[1] - 5, end[2])).toBeLessThan(0.05);
  });
  it('stops at the edge of the region and where the field is missing', () => {
    const edge = trace(() => [1, 0, 0], [0, 0, 0], 1, { step: 0.1, maxSteps: 100, inside: (p) => p[0] < 0.55 });
    expect(edge[edge.length - 1][0]).toBeLessThan(0.55);
    expect(edge[edge.length - 1][0]).toBeGreaterThan(0.4);
    const hole = trace((p) => (p[0] > 0.3 ? null : [1, 0, 0]), [0, 0, 0], 1, { step: 0.1, maxSteps: 100, inside: () => true });
    expect(hole[hole.length - 1][0]).toBeLessThanOrEqual(0.3 + 1e-9);
  });
  it('stays finite around a stagnation point', () => {
    const line = trace((p) => [-p[0], -p[1], -p[2]], [0.3, 0.2, 0], 1, { step: 0.1, maxSteps: 200, inside: () => true });
    expect(line.length).toBeLessThanOrEqual(201);
    expect(line.flat().every(Number.isFinite)).toBe(true);
  });
  it('traces both ways from the seed, in one line', () => {
    const line = traceBoth(() => [1, 0, 0], [0, 0, 0], { step: 0.1, maxSteps: 5, inside: () => true });
    expect(line).toHaveLength(11);
    expect(line[0][0]).toBeCloseTo(-0.5, 12);
    expect(line[10][0]).toBeCloseTo(0.5, 12);
  });
  it('insideSheath accepts the sheath only', () => {
    const inside = insideSheath(b);
    expect(inside([12, 0, 0])).toBe(true);
    expect(inside([9, 0, 0])).toBe(false);
    expect(inside([15, 0, 0])).toBe(false);
  });
});

describe('pack', () => {
  it('packs lines into one buffer and drops lines without a segment', () => {
    const p = pack([[[0, 0, 0], [1, 0, 0]], [[5, 5, 5]], [[0, 1, 0], [0, 2, 0], [0, 3, 0]]] as Vec3[][]);
    expect(Array.from(p.offsets)).toEqual([0, 2, 5]);
    expect(p.points).toHaveLength(15);
    expect(Array.from(p.points.slice(6, 9))).toEqual([0, 1, 0]);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `cd web && npx vitest run src/core/lines.test.ts`
Expected: FAIL — `Cannot find module './lines'`.

- [ ] **Step 3: Implement `web/src/core/lines.ts`**

```ts
// Flow lines and magnetic field lines: automatic seeds, a lazily evaluated lattice field, RK4 tracing.
// Positions are normalized frame coordinates (R_E); the field comes from the vector voxel k-NN.
import type { Boundaries } from './geometry';
import { normalizedCoords } from './geometry';
import { positionAt } from './knn';

export type Vec3 = [number, number, number];
export type VectorField = (p: Vec3) => Vec3 | null;
export type TraceOptions = { step: number; maxSteps: number; inside: (p: Vec3) => boolean };
export type Polylines = { points: Float32Array; offsets: Uint32Array };

export const LINE = { step: 0.1, maxSteps: 600, lattice: 0.5, flowDepth: 0.95, flowThetaMax: 60, fieldThetaMax: 120 };
const GOLDEN = Math.PI * (3 - Math.sqrt(5));

/** n points on the shell at depth d for theta in [0, thetaMax], evenly spread in solid angle (golden spiral). */
export function seeds(n: number, d: number, thetaMaxDeg: number, b: Boundaries): Vec3[] {
  const cMin = Math.cos((thetaMaxDeg * Math.PI) / 180), out: Vec3[] = [];
  for (let i = 0; i < n; i++) {
    const c = 1 - ((1 - cMin) * (i + 0.5)) / n;
    out.push(positionAt(d, (Math.acos(c) * 180) / Math.PI, (((i * GOLDEN) % (2 * Math.PI)) * 180) / Math.PI, b));
  }
  return out;
}
export const flowSeeds = (n: number, b: Boundaries) => seeds(n, LINE.flowDepth, LINE.flowThetaMax, b);
export const fieldSeeds = (n: number, d: number, b: Boundaries) => seeds(n, d, LINE.fieldThetaMax, b);

/** `evaluate` on a cubic lattice of spacing h, computed on first use, interpolated trilinearly. */
export function latticeField(evaluate: VectorField, h = LINE.lattice): VectorField & { evaluations(): number } {
  const cache = new Map<number, Vec3 | null>();
  const node = (i: number, j: number, k: number) => {
    const key = ((i + 1024) * 2048 + (j + 1024)) * 2048 + (k + 1024);
    let v = cache.get(key);
    if (v === undefined) { v = evaluate([i * h, j * h, k * h]); cache.set(key, v); }
    return v;
  };
  const f = ((p: Vec3) => {
    const x = p[0] / h, y = p[1] / h, z = p[2] / h;
    const i = Math.floor(x), j = Math.floor(y), k = Math.floor(z), fx = x - i, fy = y - j, fz = z - k;
    const out: Vec3 = [0, 0, 0];
    for (let c = 0; c < 8; c++) {
      const di = c & 1, dj = (c >> 1) & 1, dk = (c >> 2) & 1;
      const v = node(i + di, j + dj, k + dk);
      if (!v) return null;
      const w = (di ? fx : 1 - fx) * (dj ? fy : 1 - fy) * (dk ? fz : 1 - fz);
      out[0] += w * v[0]; out[1] += w * v[1]; out[2] += w * v[2];
    }
    return out;
  }) as VectorField & { evaluations(): number };
  f.evaluations = () => cache.size;
  return f;
}

/** True inside the magnetosheath (0 <= D <= 1) and below thetaMax. */
export function insideSheath(b: Boundaries, thetaMaxDeg = LINE.fieldThetaMax) {
  return (p: Vec3) => { const n = normalizedCoords(p, b); return n.d >= 0 && n.d <= 1 && n.thetaDeg < thetaMaxDeg; };
}

/** Streamline along the unit direction of `field` (dir -1: backward), RK4, until it leaves, the field is
 * missing or ~0, or maxSteps. Starts with the seed. */
export function trace(field: VectorField, seed: Vec3, dir: 1 | -1, o: TraceOptions): Vec3[] {
  const unit = (p: Vec3): Vec3 | null => {
    const v = field(p);
    if (!v) return null;
    const m = Math.hypot(v[0], v[1], v[2]);
    return m > 1e-9 && Number.isFinite(m) ? [(dir * v[0]) / m, (dir * v[1]) / m, (dir * v[2]) / m] : null;
  };
  const at = (p: Vec3, k: Vec3, s: number): Vec3 => [p[0] + s * k[0], p[1] + s * k[1], p[2] + s * k[2]];
  const out: Vec3[] = [seed];
  let p = seed;
  for (let s = 0; s < o.maxSteps; s++) {
    const k1 = unit(p); if (!k1) break;
    const k2 = unit(at(p, k1, o.step / 2)); if (!k2) break;
    const k3 = unit(at(p, k2, o.step / 2)); if (!k3) break;
    const k4 = unit(at(p, k3, o.step)); if (!k4) break;
    const q: Vec3 = [0, 1, 2].map((c) => p[c] + (o.step / 6) * (k1[c] + 2 * k2[c] + 2 * k3[c] + k4[c])) as Vec3;
    if (!o.inside(q)) break;
    out.push(q);
    p = q;
  }
  return out;
}

/** One line through the seed: backward end first, forward end last. */
export function traceBoth(field: VectorField, seed: Vec3, o: TraceOptions): Vec3[] {
  return [...trace(field, seed, -1, o).reverse(), ...trace(field, seed, 1, o).slice(1)];
}

export function pack(lines: Vec3[][]): Polylines {
  const kept = lines.filter((l) => l.length >= 2);
  const offsets = new Uint32Array(kept.length + 1);
  kept.forEach((l, i) => (offsets[i + 1] = offsets[i] + l.length));
  const points = new Float32Array(3 * offsets[kept.length]);
  kept.forEach((l, i) => l.forEach((p, j) => points.set(p, 3 * (offsets[i] + j))));
  return { points, offsets };
}
```

- [ ] **Step 4: Run tests**

Run: `cd web && npx vitest run src/core/lines.test.ts` → all pass; then `npx vitest run` → all pass.

- [ ] **Step 5: Commit**

```bash
git add web/src/core/lines.ts web/src/core/lines.test.ts
git commit -m "feat(web): seeds, lattice field and RK4 tracer for flow and field lines"
```

---

### Task 5: URL state, layers and the polarity rule

**Files:**
- Modify: `web/src/state/schema.ts`
- Test: `web/src/state/state.test.ts`

**Interfaces:**
- Produces: `LAYERS` gains `'flow'`, `'field'`; `ViewState.density: number` (int 50–400, default 150, URL `ln`); `mixesPolarity(frame: ViewState['frame'], clock: number[]): boolean`.

- [ ] **Step 1: Failing tests** (append to `state.test.ts`; also import `mixesPolarity`)

```ts
  it('line layers and density round-trip, density only when not default', () => {
    const s = { ...DEFAULT_STATE, layers: ['mp', 'flow', 'field'] as typeof DEFAULT_STATE.layers, density: 220 };
    expect(decodeHash(encodeHash(s))).toEqual(s);
    expect(encodeHash(DEFAULT_STATE)).not.toContain('ln=');
    expect(decodeHash('#ln=9999').density).toBe(DEFAULT_STATE.density);
    expect(DEFAULT_STATE.layers).not.toContain('flow');
  });
  it('field lines mix IMF polarities in PGSM without fold, and in GSM over more than 90 deg of clock', () => {
    expect(mixesPolarity('PGSM_fold', [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11])).toBe(false);
    expect(mixesPolarity('PGSM', [0])).toBe(true);
    expect(mixesPolarity('GSM', [11, 0])).toBe(false);
    expect(mixesPolarity('GSM', [0, 1, 2])).toBe(false);
    expect(mixesPolarity('GSM', [11, 0, 1, 2])).toBe(true);
    expect(mixesPolarity('GSM', [0, 6])).toBe(true);
  });
```

Note: also add `density: 150,` to the object in the existing `'round-trips'` test only if it spreads `DEFAULT_STATE` — it does, so nothing to add.

Run: `cd web && npx vitest run src/state` → FAIL (`density` undefined / `mixesPolarity` not exported).

- [ ] **Step 2: Implement in `schema.ts`**

```ts
export const LAYERS = ['mp', 'bs', 'tint', 'shells', 'slice', 'zgsm', 'flow', 'field'] as const;
```

In `ViewState` add `/** seeds per kind of line (flow, field) */ density: z.number().int().min(50).max(400),`; in `DEFAULT_STATE` add `density: 150,`; in `encodeHash` add `if (s.density !== DEFAULT_STATE.density) p.set('ln', String(s.density));`; in `decodeHash`'s candidate add `density: p.has('ln') ? Number(p.get('ln')) : undefined,`. Then:

```ts
/** Field lines average opposite IMF orientations: PGSM without the fold (mixed Bx), or GSM when the selected
 * clock sectors span more than 90 deg. */
export function mixesPolarity(frame: ViewState['frame'], clock: number[]): boolean {
  if (frame === 'PGSM_fold') return false;
  if (frame === 'PGSM') return true;
  const sel = [...new Set(clock)].sort((a, b) => a - b);
  let gap = 0;  // largest run of unselected sectors, circularly
  sel.forEach((s, i) => { gap = Math.max(gap, (sel[(i + 1) % sel.length] - s - 1 + N_CLOCK) % N_CLOCK); });
  return (N_CLOCK - gap) * (360 / N_CLOCK) > 90;
}
```

- [ ] **Step 3: Run tests** — `cd web && npx vitest run` → pass; `npx svelte-check --tsconfig ./tsconfig.json` → 0 errors.

- [ ] **Step 4: Commit**

```bash
git add web/src/state/schema.ts web/src/state/state.test.ts
git commit -m "feat(web): flow/field layers, line density and the IMF polarity rule in the URL state"
```

---

### Task 6: Worker request for lines and its client

**Files:**
- Modify: `web/src/workers/protocol.ts`, `web/src/workers/stats.worker.ts`, `web/src/state/stats.svelte.ts`, `web/src/App.svelte`

**Interfaces:**
- Consumes: Task 3 `VoxelFrame.selectVector`, `voxelVectorAt`; Task 4 `latticeField`, `flowSeeds`, `fieldSeeds`, `trace`, `traceBoth`, `insideSheath`, `pack`, `LINE`; Task 5 `app.density`, layers.
- Produces:
  - request `{ type: 'lines'; id; kind: LineKind; frame; selection; k; cap; density; depth }`, `type LineKind = 'flow' | 'field'`
  - reply `LinesReply = { type: 'lines'; id; kind: LineKind; points: Float32Array; offsets: Uint32Array; ms: number }`
  - `stats.lines: { flow: LinesReply | null; field: LinesReply | null }`, `stats.linesError: string`
  - `runLines(kind, frame, selection, k, cap, density, depth)` (debounced 180 ms per kind, latest wins)

- [ ] **Step 1: Protocol** — in `protocol.ts` add `export type LineKind = 'flow' | 'field';`, the request variant

```ts
  | { type: 'lines'; id: number; kind: LineKind; frame: FrameName; selection: Selection; k: number; cap: number;
      density: number; depth: number }
```

the reply type

```ts
export type LinesReply = { type: 'lines'; id: number; kind: LineKind; points: Float32Array; offsets: Uint32Array; ms: number };
```

and add `| LinesReply` to `StatsReply`.

- [ ] **Step 2: Worker** — in `stats.worker.ts` import `voxelVectorAt, type VectorName` from `../core/voxels` and `LINE, fieldSeeds, flowSeeds, insideSheath, latticeField, pack, trace, traceBoth, type VectorField` from `../core/lines`; add

```ts
const vectorFields = new Map<string, { key: string; field: VectorField }>();

/** The k-NN mean vector field of a selection, cached per kind until a parameter changes. */
async function vectorField(m: { kind: 'flow' | 'field'; frame: FrameName; selection: Sel; k: number; cap: number }) {
  const key = JSON.stringify([m.frame, m.selection, m.k, m.cap]);
  const hit = vectorFields.get(m.kind);
  if (hit?.key === key) return hit.field;
  if (!voxelFrames.has(m.frame)) voxelFrames.set(m.frame, VoxelFrame.load(manifest, m.frame, fetchBytes));
  const name: VectorName = m.kind === 'flow' ? 'V_vec' : 'B_vec';
  const set = await (await voxelFrames.get(m.frame)!).selectVector(name, m.selection, m.cap / 2);
  const field = latticeField((p) => voxelVectorAt(set, p, m.k, m.cap, KNN.search_factor));
  vectorFields.set(m.kind, { key, field });
  return field;
}
```

and the handler branch (before the `knnProbe` branches):

```ts
    } else if (m.type === 'lines') {
      const t0 = performance.now();
      const field = await vectorField(m);
      const o = { step: LINE.step, maxSteps: LINE.maxSteps, inside: insideSheath(DISPLAY_BOUNDARIES) };
      const lines = m.kind === 'flow'
        ? flowSeeds(m.density, DISPLAY_BOUNDARIES).map((s) => trace(field, s, 1, o))
        : fieldSeeds(m.density, m.depth, DISPLAY_BOUNDARIES).map((s) => traceBoth(field, s, o));
      const { points, offsets } = pack(lines);
      post({ type: 'lines', id: m.id, kind: m.kind, points, offsets, ms: performance.now() - t0 }, [points.buffer, offsets.buffer]);
```

- [ ] **Step 3: Client** — in `stats.svelte.ts` extend the state with `lines: { flow: LinesReply | null; field: LinesReply | null }; linesError: string;` (initial `lines: { flow: null, field: null }, linesError: ''`), import `LineKind, LinesReply`, and add

```ts
const latestLines: Record<LineKind, number> = { flow: 0, field: 0 };
const linesTimer: Partial<Record<LineKind, ReturnType<typeof setTimeout>>> = {};

/** Flow or field lines for the current parameters; debounced, the latest request per kind wins. A missing
 * vector atlas only affects the lines (linesError), not the maps. */
export function runLines(kind: LineKind, frame: FrameName, selection: Selection, k: number, cap: number,
  density: number, depth: number) {
  if (!worker) return;
  const snap = $state.snapshot(selection);
  clearTimeout(linesTimer[kind]);
  linesTimer[kind] = setTimeout(async () => {
    const id = (latestLines[kind] = nextId);
    const r = await send({ type: 'lines', kind, frame, selection: snap, k, cap, density, depth });
    if (id !== latestLines[kind]) return;
    if (r.type === 'lines') { stats.lines[kind] = r; stats.linesError = ''; }
    else if (r.type === 'error') stats.linesError = r.message;
  }, 180);
}
```

- [ ] **Step 4: App wiring** — in `App.svelte` import `runLines` and add

```ts
  $effect(() => {
    if (data.status !== 'ready' || !app.layers.includes('flow')) return;
    runLines('flow', app.frame, selectionOf(app), app.k, app.cap, app.density, 0);
  });
  $effect(() => {
    if (data.status !== 'ready' || !app.layers.includes('field')) return;
    runLines('field', app.frame, selectionOf(app), app.k, app.cap, app.density, app.depth);
  });
```

- [ ] **Step 5: Checks** — `cd web && npx svelte-check --tsconfig ./tsconfig.json` → 0 errors; `npx vitest run` → pass.

- [ ] **Step 6: Commit**

```bash
git add web/src/workers/protocol.ts web/src/workers/stats.worker.ts web/src/state/stats.svelte.ts web/src/App.svelte
git commit -m "feat(web): worker traces flow and field lines on request"
```

---

### Task 7: Rebuild the local atlas with vector sums (no publishing)

**Files:** none in git (the local atlas `web/public/atlas` is gitignored).

- [ ] **Step 1: Announce to the PI** that the build takes ~7 min (plus a possible re-download because two columns were added to the request) and ~7.6 GB RAM.

- [ ] **Step 2: Build into a new directory**

Run (in the background, logging):
`.venv/bin/python -m mango_explorer.atlas build --mango-api --out ~/mango-atlas/2026.0-vectors > ~/mango-atlas/build-vectors.log 2>&1`
Expected: log ends with the row counts; `~/mango-atlas/2026.0-vectors/manifest.json` lists `V_vec_x … B_vec_z` under every `voxels.frames[*].quantities`.

- [ ] **Step 3: Swap it in, keeping the old one**

```bash
mv web/public/atlas web/public/atlas-prev
cp -r ~/mango-atlas/2026.0-vectors web/public/atlas
du -sh web/public/atlas web/public/atlas-prev
```

Report the size difference (spec estimate: +250–300 MB raw).

---

### Task 8: Draw the lines; toggles, density, caption, warning

**Files:**
- Create: `web/src/render/lines.ts`
- Modify: `web/src/render/materials.ts` (palette), `web/src/render/scene.ts`, `web/src/ui/Viewport.svelte`, `web/src/ui/QuantityPanel.svelte`

**Interfaces:**
- Consumes: Task 6 `stats.lines`, `stats.linesError`; Task 5 `mixesPolarity`, `app.density`.
- Produces: `class LinesLayer { group; set(p: { points: Float32Array; offsets: Uint32Array } | null): void }`; `SceneView.setLines(kind: 'flow' | 'field', p: Polylines | null)`.

- [ ] **Step 1: Palette** — in `materials.ts` add to `PALETTE`: `flow: '#7EE0C3', field: '#C49BF2',`.

- [ ] **Step 2: `web/src/render/lines.ts`**

```ts
// Flow or field lines in 3D: thin polylines with small arrowheads showing the direction.
import * as THREE from 'three';

const ARROW_EVERY = 30;  // points between arrowheads (3 R_E at 0.1 R_E steps)
const UP = new THREE.Vector3(0, 1, 0);

export class LinesLayer {
  readonly group = new THREE.Group();
  private lines: THREE.LineSegments;
  private arrows: THREE.InstancedMesh | null = null;
  private cone = new THREE.ConeGeometry(0.18, 0.55, 8);
  private arrowMaterial: THREE.MeshBasicMaterial;

  constructor(color: string) {
    this.lines = new THREE.LineSegments(new THREE.BufferGeometry(),
      new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.85 }));
    this.arrowMaterial = new THREE.MeshBasicMaterial({ color });
    this.group.add(this.lines);
    this.group.visible = false;
  }

  /** Polylines in physics coordinates (X, Y, Z); null hides the layer. */
  set(p: { points: Float32Array; offsets: Uint32Array } | null) {
    if (!p) { this.group.visible = false; return; }
    const three = (i: number) => new THREE.Vector3(p.points[3 * i], p.points[3 * i + 2], -p.points[3 * i + 1]);
    const seg: number[] = [], heads: { at: THREE.Vector3; dir: THREE.Vector3 }[] = [];
    for (let l = 0; l + 1 < p.offsets.length; l++)
      for (let i = p.offsets[l]; i + 1 < p.offsets[l + 1]; i++) {
        const a = three(i), b = three(i + 1);
        seg.push(a.x, a.y, a.z, b.x, b.y, b.z);
        if ((i - p.offsets[l]) % ARROW_EVERY === ARROW_EVERY / 2) heads.push({ at: b, dir: b.clone().sub(a).normalize() });
      }
    this.lines.geometry.dispose();
    this.lines.geometry = new THREE.BufferGeometry();
    this.lines.geometry.setAttribute('position', new THREE.Float32BufferAttribute(seg, 3));
    if (this.arrows) { this.group.remove(this.arrows); this.arrows.dispose(); }
    this.arrows = new THREE.InstancedMesh(this.cone, this.arrowMaterial, Math.max(1, heads.length));
    this.arrows.count = heads.length;
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), one = new THREE.Vector3(1, 1, 1);
    heads.forEach((h, i) => this.arrows!.setMatrixAt(i, m.compose(h.at, q.setFromUnitVectors(UP, h.dir), one)));
    this.arrows.instanceMatrix.needsUpdate = true;
    this.group.add(this.arrows);
    this.group.visible = true;
  }
}
```

- [ ] **Step 3: Scene** — in `scene.ts` import `LinesLayer`; add fields `private flowLines = new LinesLayer(PALETTE.flow); private fieldLines = new LinesLayer(PALETTE.field);`, add both groups in the constructor next to the shell (`this.scene.add(this.flowLines.group, this.fieldLines.group);`) and

```ts
  /** Flow or field lines (physics coordinates), or null to hide them. */
  setLines(kind: 'flow' | 'field', p: { points: Float32Array; offsets: Uint32Array } | null) {
    (kind === 'flow' ? this.flowLines : this.fieldLines).set(p);
    this.requestRender();
  }
```

- [ ] **Step 4: Viewport** — in `Viewport.svelte` import `mixesPolarity` from `../state/schema`; add

```ts
  $effect(() => { view?.setLines('flow', app.layers.includes('flow') ? stats.lines.flow : null); });
  $effect(() => { view?.setLines('field', app.layers.includes('field') ? stats.lines.field : null); });
  const linesOn = $derived(app.layers.includes('flow') || app.layers.includes('field'));
```

in the `.side` block, after the `stats.error` tag:

```svelte
    {#if linesOn}<span class="tag muted">lines: k-NN 1/d mean, k = {app.k}, cap {app.cap} R<sub>E</sub> · vectors mapped to normalized space</span>{/if}
    {#if app.layers.includes('field') && mixesPolarity(app.frame, app.clock)}<span class="tag warn">field lines average opposite IMF orientations</span>{/if}
    {#if linesOn && stats.linesError}<span class="tag warn">lines: {stats.linesError}</span>{/if}
```

and in the legend, after the bow shock entry:

```svelte
      {#if app.layers.includes('flow')}<span><i style="background:#7EE0C3"></i>flow lines (V)</span>{/if}
      {#if app.layers.includes('field')}<span><i style="background:#C49BF2"></i>field lines (B)</span>{/if}
```

- [ ] **Step 5: Toggles and density** — in `QuantityPanel.svelte`, after the depth-shell layer checkbox:

```svelte
    <label class="opt"><input type="checkbox" checked={app.layers.includes('flow')} onchange={() => toggleLayer('flow')} /><span title="Ion bulk-flow streamlines from just inside the bow shock (dayside), traced downstream through the k-NN mean velocity">Flow lines (V)</span></label>
    <label class="opt"><input type="checkbox" checked={app.layers.includes('field')} onchange={() => toggleLayer('field')} /><span title="Magnetic field lines through the depth shell's D, traced both ways through the k-NN mean field">Field lines (B)</span></label>
    {#if app.layers.includes('flow') || app.layers.includes('field')}
      <label class="num"><span>lines</span>
        <input type="range" min="50" max="400" step="10" value={app.density} onchange={(e) => patch({ density: Number((e.currentTarget as HTMLInputElement).value) })} />
        <span class="mono">{app.density}</span></label>
    {/if}
```

(`patch` and `toggleLayer` are already imported there; check and add if not.)

- [ ] **Step 6: Checks** — `cd web && npx svelte-check --tsconfig ./tsconfig.json` → 0 errors; `npx vitest run` → pass; `npx vite build --outDir <scratch>/build` → succeeds.

- [ ] **Step 7: Visual check** (local atlas from Task 7): start `npx vite --port 5199 --strictPort` in the background; screenshot with the CDP script (`<scratch>/cdp/shot.mjs`) for
  - `#ly=mp.bs.flow&v=iso` (flow, PGSM fold, default selection)
  - `#ly=mp.bs.field.shells&d=0.5&v=iso` (field)
  - `#ly=mp.bs.field&f=GSM&v=iso` (warning shown)
  - `#ly=mp.bs.flow&ln=400&v=sun`
  Check: lines stay between MP and BS, flow diverges from the nose and runs tailward, field lines drape, arrowheads visible, no console errors, caption present. Send the screenshots to the PI; record the `ms` of the lines replies (expect < 2 s; if slower, report before tuning).

- [ ] **Step 8: Commit**

```bash
git add web/src/render/lines.ts web/src/render/materials.ts web/src/render/scene.ts web/src/ui/Viewport.svelte web/src/ui/QuantityPanel.svelte
git commit -m "feat(web): draw flow and field lines with toggles, density, caption and polarity warning"
```

---

### Task 9: Publish the vector atlas and deploy (only with the PI's go-ahead)

**Files:**
- Modify: `.github/workflows/deploy.yml` (`ATLAS_TAG`)

- [ ] **Step 1: Ask the PI** to approve publishing the new release `atlas-2026.0-grid-v2-vectors` (public data, same dataset as the current release plus vector sums). Do not continue without an explicit yes.

- [ ] **Step 2: Pack**

```bash
.venv/bin/python -m mango_explorer.atlas pack ~/mango-atlas/2026.0-vectors ~/mango-atlas/2026.0-vectors-packed --sample-fraction 0.03
tar -cf ~/mango-atlas/atlas-2026.0-grid-v2-vectors.tar -C ~/mango-atlas/2026.0-vectors-packed .
du -sh ~/mango-atlas/atlas-2026.0-grid-v2-vectors.tar
```

- [ ] **Step 3: Release**

```bash
gh release create atlas-2026.0-grid-v2-vectors ~/mango-atlas/atlas-2026.0-grid-v2-vectors.tar \
  --title "MANGO atlas 2026.0, grid-v2, with V and B vector sums" --notes "Adds voxel sums of V and B mapped to normalized space (flow and field lines)."
```

- [ ] **Step 4: Bump the tag** — in `deploy.yml` set `ATLAS_TAG: atlas-2026.0-grid-v2-vectors`; commit:

```bash
git add .github/workflows/deploy.yml
git commit -m "deploy: publish the atlas with vector sums (atlas-2026.0-grid-v2-vectors)"
```

- [ ] **Step 5: Merge, push, deploy** (as for previous features): fast-forward `m0-foundations`, push, `gh workflow run deploy.yml --ref m0-foundations`, wait for deploy and CI, check the live bundle contains "Flow lines (V)".
