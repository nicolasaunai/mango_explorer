# Flow lines and magnetic field lines — design

Date: 2026-10-09 · Branch: `feat/flow-field-lines` · Status: approved in conversation, awaiting written-spec review

## Goal

In the 3D view, show **ion bulk-flow streamlines** and **magnetic field lines** of the magnetosheath for the
current parameters (frame, IMF clock/cone/M_A selection, k, cap). Each kind has its own layer toggle.

## Decisions (made with the PI)

| # | Decision |
|---|----------|
| D1 | 3D lines, both V (flow) and B (field), separate toggles. |
| D2 | Vectors are mapped into normalized space with the same transformation as positions (per sample, before averaging), so that flow/field tangent to the real boundaries stays tangent to the drawn reference boundaries. |
| D3 | Seeding per kind, independent of the depth slider and the depth shell (PI, 2026-10-10; replaces the first version: flow at D = 0.95 dayside traced downstream, field on the slider's shell). Each kind has its own mode — Volume (spread through the whole sheath) or Plane (a grid on its own XY/XZ/YZ plane at an offset) — and its own line count. Both kinds are traced both ways. |
| D4 | Vector field = k-NN distance-weighted mean (sklearn `KNeighborsRegressor(weights='distance')` style) from full-data voxel sums, with the current k, cap, frame and selection — regardless of the maps' statistics source (bins or k-NN). |

## 1. Vector mapping into normalized space (D2)

MANGO normalizes each position radially, keeping its direction (verified: angle < 2e-6°):

    r_n = R*_mp(θ) + D · ΔR*(θ),   D = (r − R_mp) / ΔR,   ΔR = R_bs − R_mp,   ΔR* = R*_bs − R*_mp

`*` = reference boundaries (spec `reference_boundaries`); unstarred = the sample's own boundaries
(`R_mp`, `R_bs` columns: model distances along the sample's direction); r = R_mp + R_norm·ΔR; θ = angle
from +X (same in both spaces); φ unchanged.

A curve maps with the Jacobian of this mapping (pushforward), so velocity and field-line tangents become,
in spherical components about X:

    v_r,n = (ΔR*/ΔR) · v_r + [ R*_mp' + D·ΔR*' − ΔR*·(R_mp' + D·ΔR')/ΔR ] · v_θ / r
    v_θ,n = (r_n / r) · v_θ
    v_φ,n = (r_n / r) · v_φ

with ' = d/dθ. **Approximation (A1):** MANGO gives the sample's boundaries only along its direction, not
their slopes. We assume they locally have the reference shape, scaled: R_mp' = (R_mp/R*_mp)·R*_mp',
R_bs' = (R_bs/R*_bs)·R*_bs', and no φ-dependence (the reference is axisymmetric about X_GSM).
Under A1 a vector tangent to the sample's magnetopause (D = 0) maps exactly onto a vector tangent to the
reference magnetopause (checked analytically; tested, §5). Same for the bow shock (D = 1).

The same mapping applies to B: field lines are curves, so their tangents push forward the same way.
Mapped vectors keep their direction meaning; their magnitudes are not physical, and are not shown.

Then the mapped vector is expressed in each frame with the existing rules (`atlas.frames.vector_to_frame`):
rotation about X by the clock angle; under the fold, B → −B for Bx_imf < 0 (V is not flipped).

## 2. Atlas additions (Python pipeline)

- Fetch two more columns: `R_mp`, `R_bs` (MSH region, already served).
- New spec section `vectors` in `grid-v2.json` (additive key, no version bump): names `V_vec`, `B_vec`,
  their source columns (`Vx,Vy,Vz`, `Bx,By,Bz`), the mapping of §1, the frame rule (B flips under the fold),
  and the storage below.
- Voxel sums: for every (frame, condition bin, voxel), the count of samples with all three components finite
  and the three component sums, for `V_vec` and `B_vec`. Same voxel ids and condition layout as the scalar
  voxel sums. Files `voxels/<frame>/V_vec.bin`, `B_vec.bin`, listed in the manifest.
- Not added to histograms, cubes, the sample table, or the quantity list.
- Rebuild the atlas from the MANGO API and publish a new release `atlas-2026.0-grid-v2-vectors`; bump
  `ATLAS_TAG` in `deploy.yml`. Size estimate +250–300 MB raw (UNVERIFIED until built).

## 3. Computation in the browser (stats worker)

- **Field:** vector k-NN at a point = Σ w f S / Σ w f N per component, exactly the scalar voxel k-NN rule
  (spec `voxels.knn`, weights 1/max(d, size/2)), with S the component sums. NaN under the same cap rule.
- **Lattice cache:** the field is evaluated lazily on a 0.5 R_E lattice (only cells the tracer visits) and
  trilinearly interpolated; the cache is keyed by (frame, selection, k, cap, kind) and dropped on change.
- **Seeds (D3):** per kind, `{mode, plane, offset, n}` (n 50–400, default volume, 150). Volume: n points
  of a Halton sequence (bases 2, 3, 5), even in D ∈ [0.03, 0.97] and in solid angle for θ < 120° — even in
  the sheath's own coordinates, so the dayside is not starved as it would be with uniform R_E³ seeding;
  always the same points, so a link reproduces the lines. Plane: a square grid on the plane (XY at Z = o,
  XZ at Y = o, YZ at X = o, atlas coordinates like the slices), kept where 0.03 ≤ D ≤ 0.97 and θ < 120°;
  spacing √(area/n) with the area estimated on a 0.25 R_E grid, so about n seeds. Plane seeds are drawn
  as dots (a dot without a line marks a seed where the field is missing).
- **Tracing:** RK4 on the unit direction of the interpolated field, step 0.1 R_E. Stop when D < 0 or D > 1,
  θ ≥ 120°, the field is NaN (cap), the field magnitude is ~0, or after 600 steps. Both kinds: both
  directions from the seed, joined (seeds sit anywhere in the sheath, not at the bow shock).
- **Requests:** a new worker message `lines` (kind, frame, selection, k, cap, seeding) answered with
  polylines (one Float32Array of points, one Uint32Array of offsets) and the plane seeds. Sent only when a toggle is on;
  debounced like k-NN; stale replies discarded by id. Moving the depth re-traces field lines only.

## 4. Display and controls

- Layers `flow` and `field` (URL `ly=`), off by default; density in the URL (`ln=`), default 150.
- Flow lines and field lines in two distinct palette colours (not the IMF yellow), thin, with small
  arrowheads along each line to show direction.
- Caption while either is on: "lines: k-NN 1/d mean, k = …, cap … R_E · vectors mapped to normalized space".
- Warning on field lines when IMF polarities are mixed: frame PGSM without fold, or GSM with a clock
  selection wider than 90°: "field lines average opposite IMF orientations".
- Lines follow the frame like everything else (and will follow the PGSM redesign when it lands).

## 5. Tests

pytest:
- Mapping: a vector tangent to a sample magnetopause/bow shock (scaled reference shapes) maps tangent to
  the reference one; a purely radial vector stays radial and scales by ΔR*/ΔR; identity when the sample's
  boundaries equal the reference.
- Frames: V rotates, B rotates and flips under the fold.
- Voxel vector sums equal brute-force sums on synthetic data.

vitest:
- Vector voxel k-NN matches Python on a golden case (extend `scripts/make_goldens.py`).
- Tracer: uniform field gives straight lines; a circular field about X closes on itself; lines stop at the
  sheath edges and at NaN.
- Seeds: volume — n seeds inside the sheath, even in D and solid angle, deterministic; plane — on the
  plane, inside the sheath, about n, none where the plane misses the sheath.
- URL round-trip for `flow`, `field` and the seedings `sv` (flow) / `sb` (field) as mode~plane~offset~n;
  old `ln` links set n for both kinds.

## Not included (later, if wanted)

Click-to-seed; lines projected in the slice planes; colouring lines by magnitude; vectors in Copy Python;
exact boundary slopes (needs MANGO to serve them or the boundary models).

## Open points

- A1 (scaled-reference slopes) is an approximation; its accuracy depends on how far MANGO's ML boundaries are
  from scaled reference shapes. Worth checking against the boundary models if MANGO can share them.
- The reference boundaries are the fitted paraboloids, known to be off (bug-hunt finding #1). Fixing them
  only requires a rebuild; the lines inherit the fix.
