"""Write golden/core.json and golden/atlas-mini/: reference values the TypeScript port must match.

Run from the repo root:  .venv/bin/python scripts/make_goldens.py
"""
from __future__ import annotations

import json
import shutil
from pathlib import Path

import numpy as np

from mango_explorer import boundaries as b
from mango_explorer.atlas.binning import hist_bins, spatial_cells
from mango_explorer.atlas.grid import load_grid
from mango_explorer.atlas.knn import knn_stats
from mango_explorer.atlas.pipeline import build_atlas
from mango_explorer.atlas.sources import iter_polars
from mango_explorer.atlas.stats import hist_quantile
from mango_explorer.atlas.store import read_atlas, read_samples, read_voxels
from mango_explorer.atlas.synthetic import synthetic_frame, synthetic_magnetosheath
from mango_explorer.atlas.view import imf_direction, rotate_to_clock
from mango_explorer.atlas.voxels import select_voxels, voxel_centers, voxel_knn

ROOT = Path(__file__).resolve().parents[1] / "golden"
G = load_grid()
CLOCKS = [0.0, 37.5, 90.0, 180.0, 251.3]


def lst(a):
    return np.asarray(a, dtype=float).round(12).tolist()


def reference():
    theta = np.radians(np.arange(0, 151, 10))
    r_mp, r_bs = G.reference_radii()
    return {"theta_rad": lst(theta), "mp": lst(r_mp(theta)), "bs": lst(r_bs(theta))}


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


def rotation():
    pts = np.random.default_rng(1).normal(0, 10, (20, 3))
    return {"points": lst(pts), "clock_deg": CLOCKS,
            "rotated": [lst(rotate_to_clock(pts, c)) for c in CLOCKS],
            "imf": [{"clock_deg": c, "cone_deg": k, "dir": lst(imf_direction(c, k))}
                    for c in CLOCKS for k in (20.0, 75.0, 140.0)]}


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


def knn_golden(root, manifest, sel):
    t = read_samples(root, next(s for s in manifest["samples"] if s["frame"] == "PGSM"))
    off = t["cond_offsets"].astype(np.int64)
    rows = np.concatenate([np.arange(off[c], off[c + 1]) for c in cubes_selected(manifest, "PGSM", sel)])
    pos = np.stack([t["x"][rows], t["y"][rows], t["z"][rows]], 1).astype(float)
    rng = np.random.default_rng(9)
    nodes = np.concatenate([pos[rng.choice(len(pos), 12, replace=False)] + rng.normal(0, 0.5, (12, 3)),
                            [[0.0, 40.0, 0.0]]])
    k, cap = 20, 2.0
    r = knn_stats(nodes, pos, t["q:Np_ratio"][rows], t["interval"][rows], k, cap)
    nan = lambda a: [None if not np.isfinite(v) else round(float(v), 12) for v in a]
    return {"k": k, "cap": cap, "nodes": lst(nodes), "median": nan(r["median"]), "q25": nan(r["q25"]),
            "q75": nan(r["q75"]), "n": r["n"].tolist(), "neff": r["neff"].tolist(),
            "dist_median": nan(r["dist_median"]), "n_samples": len(rows)}


def voxel_golden(root, manifest, sel):
    entry = next(v for v in manifest["voxels"]["frames"] if v["frame"] == "PGSM")
    base, qs = read_voxels(root, entry)
    vid, n, s = select_voxels(base, qs["Np_ratio"], cubes_selected(manifest, "PGSM", sel))
    rng = np.random.default_rng(11)
    centers = voxel_centers(vid, G)
    nodes = centers[rng.choice(len(centers), 12, replace=False)] + rng.normal(0, 0.4, (12, 3))
    nodes = np.concatenate([nodes, [[0.0, 40.0, 0.0]]])
    k, cap = 300, 3.0
    out = {"k": k, "cap": cap, "nodes": lst(nodes), "n_selected": int(n.sum()), "n_voxels_selected": len(vid)}
    for name, weighted in (("weighted", True), ("uniform", False)):
        r = voxel_knn(nodes, vid, n, s, G, k=k, cap=cap, weighted=weighted)
        out[name] = {"value": [None if not np.isfinite(v) else round(float(v), 12) for v in r["value"]],
                     "n": r["n"].tolist(), "n_voxels": r["n_voxels"].tolist(),
                     "dist_median": [None if not np.isfinite(v) else round(float(v), 12) for v in r["dist_median"]]}
    return out


def vector_voxel_golden(root, manifest, sel):
    entry = next(v for v in manifest["voxels"]["frames"] if v["frame"] == "PGSM")
    base, qs = read_voxels(root, entry)
    conds = cubes_selected(manifest, "PGSM", sel)
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


def cubes_selected(manifest, frame, sel):
    import itertools

    entry = next(c for c in manifest["cubes"] if c["frame"] == frame)
    axes = [sel.get(d, list(range(n))) for d, n in zip(entry["dims"], entry["shape"])]
    return [int(np.ravel_multi_index(c, entry["shape"])) for c in itertools.product(*axes)]


def atlas_mini():
    out = ROOT / "atlas-mini"
    shutil.rmtree(out, ignore_errors=True)
    df = synthetic_magnetosheath(30_000, seed=5)
    build_atlas({f: iter_polars(synthetic_frame(df, f), f) for f in G.frames}, G, out,
                source={"kind": "synthetic"}, sample_fraction=0.5, log=lambda *_: None)
    manifest, cubes, hours = read_atlas(out)
    sel = {"cone_deg": [2, 3, 4]}
    q = next(c for c in cubes if c.frame == "PGSM").query(sel)
    med = hist_quantile(q["hist"]["Np_ratio"], G.hist_axis_edges("Np_ratio"), 0.5)
    nz = np.flatnonzero(q["n"])
    h, gsel = hours["GSM"], {"clock_deg": [11, 0, 1, 2], "cone_deg": [2, 3, 4]}
    in_sel = np.isin(h["clock_deg"], gsel["clock_deg"]) & np.isin(h["cone_deg"], gsel["cone_deg"])
    keys = h["sc"].astype(np.int64) << 40 | h["interval"].astype(np.int64)
    clock_neff = [len(np.unique(keys[np.isin(h["cone_deg"], gsel["cone_deg"]) & (h["clock_deg"] == k)]))
                  for k in range(12)]
    return {"frame": "PGSM", "selection": sel, "quantity": "Np_ratio",
            "knn": knn_golden(out, manifest, sel), "voxel_knn": voxel_golden(out, manifest, sel),
            "vector_knn": vector_voxel_golden(out, manifest, sel),
            "cells": nz.tolist(), "n": q["n"][nz].tolist(), "neff_upper": q["neff_upper"][nz].tolist(),
            "median_axis": [round(float(v), 12) for v in med[nz]],
            "hours": {"frame": "GSM", "selection": gsel, "n": int(h["n"][in_sel].sum()),
                      "neff": len(np.unique(keys[in_sel])), "clock_marginal_neff": clock_neff,
                      "pgsm_n": int(hours["PGSM"]["n"].sum())}}


if __name__ == "__main__":
    ROOT.mkdir(exist_ok=True)
    core = {"grid": G.version, "boundaries": boundaries(), "reference": reference(), "rotation": rotation(),
            "binning": binning(), "atlas_mini": atlas_mini()}
    (ROOT / "core.json").write_text(json.dumps(core))
    print("wrote", ROOT / "core.json", "and", ROOT / "atlas-mini")
