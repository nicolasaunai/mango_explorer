# mango_explorer

A 3D web explorer of MANGO magnetosheath statistics in GSM / PGSM, conditioned on the solar
wind and IMF.

It has two parts:

- **`src/mango_explorer/atlas/`**: an offline Python pipeline. It turns MANGO rows into a small
  static *atlas*: per-cell histograms for each condition bin, plus an hour table used for exact
  N_eff counts.
- **`web/`**: a Svelte 5 + TypeScript + three.js app that reads the atlas. It runs no Python in
  the browser.

Both sides follow one binning contract, `src/mango_explorer/spec/grid-v3.json`. Python writes
reference values to `golden/`, and the TypeScript tests check against them.

## Python: build an atlas

```bash
python3 -m venv .venv && .venv/bin/pip install -e ".[dev]" polars pyarrow hypothesis
.venv/bin/pytest -q

# from the MANGO server (needs space_mango >= 0.3, the frames API; not yet on PyPI, so for now
# `.venv/bin/pip install -e ../mango`). The atlas is built per frame, GSM and PGSM
# (`--frames` restricts); cached and resumable
.venv/bin/python -m mango_explorer.atlas build --mango-api --out atlas/
# synthetic rows, for development
.venv/bin/python -m mango_explorer.atlas build --synthetic 400000 --out atlas/

# after changing frames, binning or boundaries: regenerate reference values for the web tests
.venv/bin/python scripts/make_goldens.py
```

To publish an atlas on the website:

```bash
.venv/bin/python -m mango_explorer.atlas build --mango-api --sample-fraction 0.03 --out atlas-raw/
.venv/bin/python -m mango_explorer.atlas pack atlas-raw/ atlas-public/      # gzip, ~180 MB
tar -cf mango-atlas-<version>.tar -C atlas-public .
gh release create atlas-<version> mango-atlas-<version>.tar
```

Then set `ATLAS_TAG` in `.github/workflows/deploy.yml`.

## Web

```bash
cd web && npm ci
cp -r ../atlas public/atlas      # optional: without it the app shows geometry only
npm run dev                      # http://localhost:5173
npm test && npm run check        # vitest (vs golden/) and svelte-check
```

The view state lives in the URL hash, so a link reproduces the view.

## Conventions

- **Frames.** GSM and PGSM come from space_mango; the explorer shows PGSM at a chosen clock by rotating the data about X (axes fixed).
- **What is shown is MANGO's normalized data.**
  - Each sample sits at its served `X/Y/Z_gsm_norm` position, rotated into the chosen frame.
  - Depth D_msh is measured geometrically between MANGO's reference surfaces. These are
    paraboloids fitted to the data (`scripts/fit_reference_boundaries.py`, grid-v2) and are
    the boundaries the app draws.
  - This geometric depth differs from the served `R_norm` by less than 0.09 for 95 % of samples.
- **Statistics come from bins or from k-NN.**
  - **Bins:** histograms per (D, θ, φ) cell are summed over the selected condition bins.
  - **k-NN:** the k nearest normalized positions of each displayed node. A node is NaN when the
    median neighbour distance exceeds the cap (default 2 R_E).
  - The k-NN sample table keeps a deterministic random fraction of the samples
    (`--sample-fraction`, default 0.1). Time plays no role.
- **N_eff** (distinct spacecraft-hours) is an optional overlay that hatches cells dominated by
  few spacecraft passes.

The legacy Pyodide prototype (`explorer.py`, `data/`, `colormap.py`, `gridding.py`) is kept in
`src/` with its tests. Its web front end now lives in `old/pyodide-web/`.
