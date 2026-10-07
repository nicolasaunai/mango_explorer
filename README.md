# mango_explorer

A 3D web explorer of MANGO magnetosheath statistics in GSM / PGSM, conditioned on the solar
wind and IMF.

It has two parts:

- **`src/mango_explorer/atlas/`**: an offline Python pipeline. It turns MANGO rows into a small
  static *atlas*: per-cell histograms for each condition bin, plus an hour table used for exact
  N_eff counts.
- **`web/`**: a Svelte 5 + TypeScript + three.js app that reads the atlas. It runs no Python in
  the browser.

Both sides follow one binning contract, `src/mango_explorer/spec/grid-v1.json`. Python writes
reference values to `golden/`, and the TypeScript tests check against them.

## Python: build an atlas

```bash
python3 -m venv .venv && .venv/bin/pip install -e ".[dev]" polars pyarrow hypothesis
.venv/bin/pytest -q

# from the MANGO server's on-disk data (on the LPP machine)
.venv/bin/python -m mango_explorer.atlas build --parquet-dir $MANGO_DATA_DIR/magnetosheath --out atlas/
# from Arrow files downloaded with the MANGO API (format=arrow)
.venv/bin/python -m mango_explorer.atlas build --arrow msh_*.arrow --out atlas/
# synthetic rows, for development
.venv/bin/python -m mango_explorer.atlas build --synthetic 400000 --out atlas/

# after changing frames, binning or boundaries: regenerate reference values for the web tests
.venv/bin/python scripts/make_goldens.py
```

## Web

```bash
cd web && npm ci
cp -r ../atlas public/atlas      # optional: without it the app shows geometry only
npm run dev                      # http://localhost:5173
npm test && npm run check        # vitest (vs golden/) and svelte-check
```

The view state lives in the URL hash, so a link reproduces the view.

## Conventions

- **Frames.** Every frame rotates about X_GSM.
  - **PGSM** rotates each sample by its own IMF clock angle, so that the IMF points to +Z.
  - **PGSM_fold** also flips samples with Bx_imf < 0 (B → −B, then 180° about X), so the
    quasi-parallel side is always +Z.
- **Statistics live in boundary-normalized space.** The coordinates are D_msh (= MANGO
  `R_norm`), θ and φ.
- **N_eff** counts distinct (spacecraft, hour) intervals.

The legacy Pyodide prototype (`explorer.py`, `data/`, `colormap.py`, `gridding.py`) is kept in
`src/` with its tests. Its web front end now lives in `old/pyodide-web/`.
