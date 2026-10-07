"""Write golden/core.json and golden/atlas-mini/: reference values the TypeScript port must match.

Run from the repo root:  .venv/bin/python scripts/make_goldens.py
"""
from __future__ import annotations

import json
import shutil
from pathlib import Path

import numpy as np

from mango_explorer import boundaries as b
from mango_explorer.atlas import frames as fr
from mango_explorer.atlas.binning import hist_bins, spatial_cells
from mango_explorer.atlas.grid import load_grid
from mango_explorer.atlas.pipeline import build_atlas
from mango_explorer.atlas.sources import iter_polars
from mango_explorer.atlas.stats import hist_quantile
from mango_explorer.atlas.store import read_atlas
from mango_explorer.atlas.synthetic import synthetic_magnetosheath

ROOT = Path(__file__).resolve().parents[1] / "golden"
G = load_grid()


def lst(a):
    return np.asarray(a, dtype=float).round(12).tolist()


def boundaries():
    theta = np.radians(np.arange(0, 151, 10))
    cases = []
    for bz in (-10.0, -2.0, 0.0, 5.0):
        for pd in (0.8, 2.0, 6.0):
            r0, a = b.shue_r0(bz, pd), b.shue_alpha(bz, pd)
            cases.append({"bz": bz, "pd": pd, "shue_r0": float(r0), "shue_alpha": float(a),
                          "shue_mp": lst(b.shue_mp(theta, r0, a)),
                          "jelinek_bs": lst(b.jelinek_bs(theta, pd)),
                          "jelinek_mp": lst(b.jelinek_mp(theta, pd))})
    return {"theta_rad": lst(theta), "cases": cases}


def frames():
    rng = np.random.default_rng(1)
    imf = rng.normal(0, 5, (40, 3))
    vec = rng.normal(0, 10, (40, 3))
    out = {"imf": lst(imf), "vec": lst(vec),
           "clock_deg": lst(fr.clock_angle_deg(imf[:, 1], imf[:, 2])),
           "cone_deg": lst(fr.cone_angle_deg(*imf.T)), "frames": {}}
    for f in fr.FRAMES:
        kw = {"bx_imf": imf[:, 0], "by_imf": imf[:, 1], "bz_imf": imf[:, 2]}
        out["frames"][f] = {
            "position": lst(np.stack(fr.vector_to_frame(f, *vec.T, magnetic=False, **kw), 1)),
            "magnetic": lst(np.stack(fr.vector_to_frame(f, *vec.T, magnetic=True, **kw), 1)),
            "azimuth_deg": lst(fr.azimuth_in_frame_deg(f, vec[:, 1], vec[:, 2], **kw)),
        }
    return out


def binning():
    rng = np.random.default_rng(2)
    d = rng.uniform(-0.2, 1.2, 60)
    theta = rng.uniform(0, 130, 60)
    phi = rng.uniform(-30, 400, 60)
    np_vals = 10 ** rng.uniform(-2, 4, 60)
    counts = rng.integers(0, 20, (8, G.n_hist))
    counts[3] = 0
    edges = G.hist_axis_edges("Np")
    return {
        "d": lst(d), "theta_deg": lst(theta), "phi_deg": lst(phi),
        "cell": spatial_cells(d, theta, phi, G).tolist(),
        "np": lst(np_vals), "np_hbin": hist_bins(np_vals, "Np", G).tolist(),
        "hist_counts": counts.tolist(),
        "hist_quantiles": {str(q): [None if np.isnan(v) else round(float(v), 12)
                                    for v in hist_quantile(counts, edges, q)]
                           for q in (0.1, 0.25, 0.5, 0.75, 0.9)},
    }


def atlas_mini():
    out = ROOT / "atlas-mini"
    shutil.rmtree(out, ignore_errors=True)
    df = synthetic_magnetosheath(30_000, seed=5)
    build_atlas(iter_polars(df), G, out, frames=["PGSM_fold"], source={"kind": "synthetic"},
                log=lambda *_: None)
    _, cubes, hours = read_atlas(out)
    sel = {"clock_deg": [11, 0, 1, 2], "cone_deg": [2, 3, 4]}
    q = cubes[0].query(sel)
    med = hist_quantile(q["hist"]["Np_ratio"], G.hist_axis_edges("Np_ratio"), 0.5)
    nz = np.flatnonzero(q["n"])
    in_sel = np.isin(hours["clock_deg"], sel["clock_deg"]) & np.isin(hours["cone_deg"], sel["cone_deg"])
    keys = hours["sc"].astype(np.int64) << 40 | hours["interval"].astype(np.int64)
    clock_neff = [len(np.unique(keys[np.isin(hours["cone_deg"], sel["cone_deg"])
                                          & (hours["clock_deg"] == k)])) for k in range(12)]
    return {"selection": sel, "frame": "PGSM_fold", "quantity": "Np_ratio",
            "hours_n": int(hours["n"][in_sel].sum()), "hours_neff": len(np.unique(keys[in_sel])),
            "clock_marginal_neff": clock_neff,
            "cells": nz.tolist(), "n": q["n"][nz].tolist(),
            "neff_upper": q["neff_upper"][nz].tolist(),
            "median_axis": [round(float(v), 12) for v in med[nz]]}


if __name__ == "__main__":
    ROOT.mkdir(exist_ok=True)
    core = {"grid": G.version, "boundaries": boundaries(), "frames": frames(),
            "binning": binning(), "atlas_mini": atlas_mini()}
    (ROOT / "core.json").write_text(json.dumps(core))
    print("wrote", ROOT / "core.json", "and", ROOT / "atlas-mini")
