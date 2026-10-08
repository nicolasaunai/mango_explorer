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
from mango_explorer.atlas.knn import frame_positions, knn_stats
from mango_explorer.atlas.pipeline import build_atlas
from mango_explorer.atlas.sources import iter_polars
from mango_explorer.atlas.stats import hist_quantile
from mango_explorer.atlas.store import read_atlas, read_samples, read_voxels
from mango_explorer.atlas.synthetic import synthetic_magnetosheath
from mango_explorer.atlas.voxels import select_voxels, voxel_centers, voxel_knn

ROOT = Path(__file__).resolve().parents[1] / "golden"
G = load_grid()


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


def knn_golden(root, manifest, sel):
    t = read_samples(root, manifest["samples"])
    conds = cubes_selected(manifest, sel)
    off = t["cond_offsets"].astype(np.int64)
    rows = np.concatenate([np.arange(off[c], off[c + 1]) for c in conds])
    xyz = np.stack([t["x"][rows], t["y"][rows], t["z"][rows]], 1).astype(float)
    pos = frame_positions("PGSM_fold", xyz, t["clock_deg"][rows], t["bx_neg"][rows])
    rng = np.random.default_rng(9)
    nodes = pos[rng.choice(len(pos), 12, replace=False)] + rng.normal(0, 0.5, (12, 3))
    nodes = np.concatenate([nodes, [[0.0, 40.0, 0.0]]])   # far outside: NaN
    k, cap = 20, 2.0
    r = knn_stats(nodes, pos, t["q:Np_ratio"][rows], t["interval"][rows], k, cap)
    nan = lambda a: [None if not np.isfinite(v) else round(float(v), 12) for v in a]
    return {"k": k, "cap": cap, "nodes": lst(nodes), "median": nan(r["median"]), "q25": nan(r["q25"]),
            "q75": nan(r["q75"]), "n": r["n"].tolist(), "neff": r["neff"].tolist(),
            "dist_median": nan(r["dist_median"]), "n_samples": len(rows)}


def voxel_golden(root, manifest, sel):
    entry = next(v for v in manifest["voxels"]["frames"] if v["frame"] == "PGSM_fold")
    base, qs = read_voxels(root, entry)
    vid, n, s = select_voxels(base, qs["Np_ratio"], cubes_selected(manifest, sel))
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


def cubes_selected(manifest, sel):
    entry = manifest["cubes"][0]
    axes = [sel.get(d, list(range(n))) for d, n in zip(entry["dims"], entry["shape"])]
    import itertools
    return [int(np.ravel_multi_index(c, entry["shape"])) for c in itertools.product(*axes)]


def atlas_mini():
    out = ROOT / "atlas-mini"
    shutil.rmtree(out, ignore_errors=True)
    df = synthetic_magnetosheath(30_000, seed=5)
    build_atlas(iter_polars(df), G, out, frames=["PGSM_fold"], source={"kind": "synthetic"},
                sample_fraction=0.5, log=lambda *_: None)
    manifest, cubes, hours = read_atlas(out)
    sel = {"clock_deg": [11, 0, 1, 2], "cone_deg": [2, 3, 4]}
    q = cubes[0].query(sel)
    med = hist_quantile(q["hist"]["Np_ratio"], G.hist_axis_edges("Np_ratio"), 0.5)
    nz = np.flatnonzero(q["n"])
    in_sel = np.isin(hours["clock_deg"], sel["clock_deg"]) & np.isin(hours["cone_deg"], sel["cone_deg"])
    keys = hours["sc"].astype(np.int64) << 40 | hours["interval"].astype(np.int64)
    clock_neff = [len(np.unique(keys[np.isin(hours["cone_deg"], sel["cone_deg"])
                                          & (hours["clock_deg"] == k)])) for k in range(12)]
    knn = knn_golden(out, manifest, sel)
    vox = voxel_golden(out, manifest, sel)
    return {"selection": sel, "frame": "PGSM_fold", "quantity": "Np_ratio", "knn": knn, "voxel_knn": vox,
            "hours_n": int(hours["n"][in_sel].sum()), "hours_neff": len(np.unique(keys[in_sel])),
            "clock_marginal_neff": clock_neff,
            "cells": nz.tolist(), "n": q["n"][nz].tolist(),
            "neff_upper": q["neff_upper"][nz].tolist(),
            "median_axis": [round(float(v), 12) for v in med[nz]]}


if __name__ == "__main__":
    ROOT.mkdir(exist_ok=True)
    core = {"grid": G.version, "boundaries": boundaries(), "reference": reference(), "frames": frames(),
            "binning": binning(), "atlas_mini": atlas_mini()}
    (ROOT / "core.json").write_text(json.dumps(core))
    print("wrote", ROOT / "core.json", "and", ROOT / "atlas-mini")
