# grid-v3: MANGO's PGSM and GSM through space_mango — design

Date: 2026-10-09 · Status: decisions made with the PI in conversation; this spec awaits the PI's review.
Supersedes the frame part of grid-v2 (`GSM`, `PGSM`, `PGSM_fold` computed by the explorer).

## Goal

Show MANGO magnetosheath data in two frames, both taken as MANGO defines them:

- **PGSM** (Michotte de Welle 2024, thesis §2.7.3–2.7.4): every sample, whatever its IMF orientation,
  brought to one target IMF clock angle by symmetry. The user picks **one precise clock value**.
- **GSM**: data as measured; the IMF clock angle is a **filter** (sectors), as in grid-v2.

The explorer no longer rotates or folds samples itself.

## Decisions (PI, 2026-10-09)

| # | Decision |
|---|----------|
| D1 | Data come **only** through the `space_mango` Python API. The `--arrow` and `--parquet-dir` build sources and the old prototype data layer (`src/mango_explorer/data/`, `explorer.py`) are removed. |
| D2 | PGSM mode: one download, `get_data("magnetosheath", frame="pgsm", cone=[0, 180], clock=0)`. Positions are `X/Y/Z_pgsm_norm`; k-NN and bins use them as served. |
| D3 | The target clock is one value in [0°, 360°), not a sector. It is applied in the browser as a rigid rotation about X of what the atlas holds at clock 0 (§3). No data are re-binned. |
| D4 | Depth D is geometric: the depth of the position between MANGO's mean reference boundaries (§2). Not `R_norm`. |
| D5 | GSM mode: `get_data(..., frame="gsm")`; clock sectors filter the data; the cone is the signed GSM cone acos(Bx_imf/\|B_imf\|) ∈ [0°, 180°] (no fold). |
| D6 | Tests use synthetic rows, plus one small real `space_mango` result recorded once as a fixture (§6). |

## 1. Verified facts this design rests on

- **PGSM is a rigid rotation in the clock.** `pgsm(θ) = R(θ) · pgsm(0)` for positions, B and V, to 1e-13,
  same rows in the same order, with `R(θ): (Y, Z) → (Y cos θ + Z sin θ, −Y sin θ + Z cos θ)`, i.e. the
  azimuth φ = atan2(Z, Y) becomes φ − θ (checked on C1, two weeks of 2005, θ = 37.5°, 90°, 180°, 251.3°).
- **`cone=[0, 180]` returns every sample twice**: `bx_sign = +1` with cone f, and `bx_sign = −1`
  (Y-mirrored, eq 2.19) with cone 180° − f, where f is the SWI cone measured from −V_sw (≤ 90° except
  ~3.5 % of rows, aberration). The two copies fall in different cone bins unless f ≈ 90°.
- **Mean reference boundaries** (mango Claude, from Bayane's `space_bayane/models/planetary.py`, checked on
  100 % of the 25,682 normalized rows of the MANGO docs sample, max error 1.3e-6 R_E):
  `|r_gsm_norm| = r_mp(θ) + clip(R_norm, 0, 1) · (r_bs(θ) − r_mp(θ))`, θ from X_GSM, with
  - Shue98 magnetopause at Pd = 2.056 nPa, Bz = −0.001 nT:
    r0 = (10.22 + 1.29 tanh(0.184 (Bz + 8.14))) Pd^(−1/6.6) ≈ 10.209 R_E, a = (0.58 − 0.007 Bz)(1 + 0.024 ln Pd),
    r_mp = r0 (2 / (1 + cos θ))^a;
  - Jelinek2012 bow shock at Pd = 2.056 nPa, λ = 1.17, R = 15.02, ε = 6.55:
    R0 = 2R Pd^(−1/ε), r_bs = R0 / (cos θ + √(cos²θ + λ² sin²θ)), nose ≈ 13.455 R_E.
  So grid-v2's fitted paraboloids were only an approximation; the "|dD| < 0.09" gap between our geometric
  D and `R_norm` came from that fit, not from the dataset.
- **`*_swi_norm` (hence `*_pgsm_norm`) were re-normalized at the SWI angles and clipped to [0, 1]**: their
  geometric depth differs from `R_norm` near the boundaries (radius changed on ~9 % of rows, up to 1.7 R_E).
  D4 accepts this: the depth of a PGSM point is where MANGO placed it.

## 2. Contract `spec/grid-v3.json`

Changes from grid-v2 (everything else unchanged: D, θ, φ edges, quantities, histogram, N_eff, reliability,
k-NN, voxels):

- `frames`: `GSM` (served `X/Y/Z_gsm_norm`) and `PGSM` (served `X/Y/Z_pgsm_norm` at clock 0, IMF⊥ along +Z).
- `conditions`:
  - `cone_deg`: edges 0–180 step 15 (12 bins). GSM: signed GSM cone. PGSM: the row's PGSM cone (f or 180° − f).
  - `clock_deg`: 12 × 30° sectors, **GSM only**.
  - `Ma_sw`, `Pd_sw`, `Beta_sw`, `V_sw`: unchanged.
- `cubes`: per frame. GSM `clock-cone-Ma` (12 × 12 × 5); PGSM `cone-Ma` (12 × 5).
- `reference_boundaries`: `kind: "shue98-jelinek2012-mean"` with the formulas and parameters of §1,
  replacing the paraboloids. Used for D, for the drawn MP/BS surfaces, and for the vector mapping.
- `source`: `space_mango` version, dataset version, the exact `get_data` calls.

## 3. The target clock in the browser (D3)

The atlas holds PGSM at clock 0. For a target clock θ the browser:

- computes everything (bins, k-NN, lines) in the atlas frame, unchanged;
- maps query points from the displayed frame back with R(−θ) (slice planes, probe, shell nodes);
- draws results, vectors and the IMF arrow rotated by R(θ); on the θ–φ map, shifts φ by −θ.

This is exact (fact 1). Changing θ re-runs nothing but the drawing and the inverse map of query points.
In PGSM mode, "pin A / compare B" pins the cone and M_A only; A and B share θ.

## 3b. Axes and the yellow IMF arrow (PI, 2026-10-09)

From the user's standpoint, **PGSM looks like GSM with more data**. Both modes behave the same on screen:

- **Axes are fixed** in both modes. Their labels name the frame: `X/Y/Z GSM` in GSM, `X/Y/Z PGSM` in PGSM.
  The camera presets (sun, dusk, north, tail) refer to these fixed axes.
- **The data move, not the axes.** In PGSM, the target clock rotates the data (maps, shell, slices, lines)
  about X (§3); the cone selection changes which data are shown. In GSM, clock sectors and cone bins only
  filter the data.
- **The yellow IMF arrow** is drawn as in GSM in both modes, from the user's clock and cone:
  B̂ = (cos c, sin c sin θ, sin c cos θ), c = cone, θ = clock.
  - PGSM: θ = the target clock value; c = the centre of the selected cone range. If the selection spans 90°
    (both IMF Bx signs), draw both arrows (c and 180° − c), as grid-v2 does for mixed polarity.
  - GSM: θ = the centre of the selected clock sectors (none when the clock is undefined for radial IMF);
    c as above, signed: c < 90° points sunward (Bx > 0).
- **Quasi-parallel / quasi-perpendicular shock** (bow-shock tint and the Q∥, Q⊥ labels) follow the same
  B̂ as the yellow arrow, in both modes: θBn = angle between the bow-shock normal and B̂ (Q∥ warm for
  θBn < 45°, Q⊥ cool above; the shader already works this way, `render/materials.ts`), and the labels sit at
  the bow-shock points of smallest and largest θBn (`placeShockLabels`). So for the same clock and cone,
  GSM and PGSM show the tint, both colours and labels, at the same place, and both move when the user
  changes the clock or the cone.
  - Shown whenever the IMF orientation is well defined: PGSM always, except when the cone selection spans
    90° (two arrows c and 180° − c, mirror images in X); GSM when the selected clock sectors span ≤ 90° and
    the cone selection does not span 90°, and not for radial IMF. Otherwise the tint is off and the toggle
    says why. This replaces the grid-v2 rule "tint only in PGSM_fold".
  - Test: for a few (clock, cone), the Q∥ label lies where the bow-shock normal is most nearly parallel to
    B̂, and it is the same in GSM and PGSM.
- The PGSM IMF arrow must coincide with the IMF that `space_mango` reports for the same clock and cone:
  a test checks the arrow direction against the PGSM IMF of fixture rows rotated to θ.
- Tilt: the explorer shows the magnetosheath only, where PGSM has no tilt parameter. Dipole tilt would only
  enter if a magnetosphere view is added later (PGSM `tilt=[a, b]`); out of scope here.

## 4. Atlas build

- `sources.iter_mango_api` makes two calls per spacecraft-year, `frame="gsm"` and
  `frame="pgsm", cone=[0, 180], clock=0`, and yields one chunk stream per frame. The `space_mango` cache
  means the second call downloads only the columns the first did not.
- `prepare` takes positions from the frame's columns, D from §2, and conditions from:
  GSM: IMF columns; PGSM: `cone_pgsm`, `V_sw` (see §7, blocker B1).
- Quantities: `Np`, `Tp`, `|B|`, `|V|` from the frame's columns (`B*_pgsm`, `V*_pgsm` in PGSM);
  ratios need `Np_sw`, `Tp_sw` (scalars) and `|B_imf|`, `|V_sw|` (B1).
- Vectors for lines: GSM as in grid-v2 (pushforward through the normalization, A1). PGSM: the same
  pushforward evaluated at the PGSM position with `R_norm`, `R_mp`, `R_bs`, applied to `B*_pgsm`, `V*_pgsm`.
  This treats the SWI rotation as a rotation about X_GSM; it is off by the aberration angle (median 5.4°).
  Approximation **A2**, documented in the spec and the app.
- Removed: `atlas/frames.py` rotations, `PGSM_fold`, the `clock_deg`/`bx_neg` columns of the sample table
  (each frame gets its own sample table with its own positions).

## 5. Web app

- Frame switch: GSM | PGSM.
- PGSM: clock control = one value (dial with a needle + number field, 1° steps; URL `ck=`); cone selector over
  0–180°; no clock sectors. GSM: sector dial as now (URL `clk=`), cone selector 0–180°.
- The radial-IMF note ("clock undefined for cone < 30°") stays in GSM only; in PGSM the clock is a display
  choice.
- Axes, labels and the IMF arrow: see §3b. The Z_GSM arrow layer is GSM-only (in PGSM, Z_GSM differs
  per sample); replace the current `+Z PGSM (IMF⊥)` label, which assumed the IMF fixed at +Z.
- Field-line polarity warning: PGSM only when the cone selection spans 90° (both `bx_sign`); GSM as now.
- The "fold" checkbox and its "(needs fold)" note on the θBn tint go away (§3b).
- Copy Python: emits the exact `space_mango` call, `get_data(frame="pgsm", cone=[a, b], clock=θ, ...)` or
  `get_data(frame="gsm", cone=[a, b], clock=[c1, c2], ...)`, plus `cell_statistics` for bins.
- Old links: `f=PGSM_fold` or `f=PGSM` open in PGSM at θ = 0 with the same cone bins (bins 0–5 keep their
  meaning for `bx_sign = +1`); their clock sectors are dropped. Best effort, no guarantee.

## 6. Tests

- Synthetic rows (`atlas/synthetic.py`) produce the same columns as `space_mango` GSM and PGSM output,
  including the doubled PGSM rows.
- Recorded fixture: a few thousand rows of a real `get_data(frame="pgsm", ...)` and `frame="gsm"` result,
  stored in `tests/data/`, with the `space_mango` and dataset versions; a test builds an atlas from it.
  Re-recorded by a script when MANGO changes.
- New checks: D from §2 equals `clip(R_norm, 0, 1)` on GSM rows; the browser rotation (TS) matches
  `space_mango` at a non-zero clock on the fixture; cone binning of the doubled rows; old-link decoding.
- Goldens regenerated for grid-v3.

## 7. Open items

- **B1 (blocker, MANGO side, client only):** PGSM output lacks the row's cone, |V_sw| and |B_imf|
  (`FrameError` on `Vx_sw`, `Bx_imf`). Requested from the mango session as computed columns `cone_pgsm`,
  `V_sw`, and a |B_imf| column; it proposes `V_sw` (and |B_imf|) in every frame. Waits for the PI's go there.
- **Release:** `space_mango` 0.3.0 is not on PyPI; until it is, the build and CI install it from the
  `mango` git repository at a pinned commit. The live server already runs the frames code.
- **A2** (vector mapping in PGSM): accept, or ask MANGO to also return the GSM direction per row?
- **Eq 2.17** (magnetosheath doubling) is not implemented in MANGO; nothing to do here until it is.
- **Atlas size:** ~780 condition bins in all (720 GSM + 60 PGSM) against 1,080 in grid-v2, but PGSM rows are
  doubled. Expected similar to the current 1.6 GB local / 741 MB release; to be measured. GitHub Pages
  limit is 1 GB.
