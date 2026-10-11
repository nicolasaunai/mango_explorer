import numpy as np
from scipy.spatial import cKDTree

from mango_explorer.atlas.binning import flat_condition_index
from mango_explorer.atlas.grid import load_grid
from mango_explorer.atlas.pipeline import build_atlas
from mango_explorer.atlas.prepare import prepare
from mango_explorer.atlas.sources import canonical_columns, iter_polars
from mango_explorer.atlas.store import read_atlas, read_voxels
from mango_explorer.atlas.synthetic import synthetic_frame, synthetic_magnetosheath
from mango_explorer.atlas.vectors import COMPONENTS
from mango_explorer.atlas.voxels import (
    VoxelAccumulator,
    select_voxels,
    voxel_centers,
    voxel_ids,
    voxel_knn,
)

G = load_grid()
CUBE = G.cube_of_frame("PGSM")


def _pgsm(n, seed):
    return synthetic_frame(synthetic_magnetosheath(n, seed=seed), "PGSM")


def test_voxel_ids_round_trip_to_centres():
    p = np.array([[0.1, 0.1, 0.1], [12.3, -4.56, 7.89], [-30.0, 25.0, -25.0]])
    c = voxel_centers(voxel_ids(p, G), G)
    assert np.all(np.abs(c - p) <= G.raw["voxels"]["size_re"] / 2 + 1e-12)


def test_voxel_sums_match_rows_and_knn_matches_exact_weighted_mean():
    rows = _pgsm(150_000, 8)
    acc = VoxelAccumulator(G, "PGSM")
    for c in iter_polars(rows, "PGSM", 70_000):
        acc.add(prepare(c, G, "PGSM"))
    vox = acc.finalize()

    prep = prepare(canonical_columns(rows, "PGSM"), G, "PGSM")
    sel = np.isin(prep.cond_bins["cone_deg"], [2, 3, 4])
    cond = flat_condition_index(prep.cond_bins, G.cube_dims(CUBE), G.cube_shape(CUBE))
    ok = sel & (cond >= 0) & (prep.cells["PGSM"] >= 0) & np.isfinite(prep.values["Np_ratio"])
    conds = sorted(set(cond[sel & (cond >= 0)].tolist()))
    vid, n, s = select_voxels(vox["base"], vox["quantities"]["Np_ratio"], conds)
    assert int(n.sum()) == int(ok.sum())
    assert np.isclose(s.sum(), prep.values["Np_ratio"][ok].sum(), rtol=1e-5)

    pos, val = prep.xyz[ok], prep.values["Np_ratio"][ok]
    rng = np.random.default_rng(1)
    nodes = pos[rng.choice(len(pos), 40, replace=False)] + rng.normal(0, 0.3, (40, 3))
    k = 2000
    dist, idx = cKDTree(pos).query(nodes, k=k)
    w = 1 / np.maximum(dist, 1e-9)
    exact = (w * val[idx]).sum(1) / w.sum(1)
    approx = voxel_knn(nodes, vid, n, s, G, k=k, cap=3.0)["value"]
    good = np.isfinite(approx)
    assert good.mean() > 0.5
    assert np.percentile(np.abs(np.log10(approx[good] / exact[good])), 90) < 0.01
    uniform = voxel_knn(nodes, vid, n, s, G, k=k, cap=3.0, weighted=False)["value"]
    assert np.percentile(np.abs(np.log10(uniform[good] / val[idx].mean(1)[good])), 90) < 0.01


def test_voxel_knn_cap_and_partial_last_voxel():
    vid = voxel_ids(np.array([[0.1, 0.1, 0.1], [1.1, 0.1, 0.1]]), G)
    n, s = np.array([10.0, 30.0]), np.array([10.0, 90.0])
    node = voxel_centers(vid[:1], G)
    r = voxel_knn(node, vid, n, s, G, k=20, cap=2.0, weighted=False)
    assert r["n"][0] == 20 and np.isclose(r["value"][0], 2.0)
    assert np.isnan(voxel_knn(node + 0.3, vid, n, s, G, k=20, cap=0.05, weighted=False)["value"][0])
    assert np.isnan(voxel_knn(node + 50, vid, n, s, G, k=20, cap=2.0)["value"][0])


def test_voxels_round_trip_through_the_atlas(tmp_path):
    df = synthetic_magnetosheath(30_000, seed=9)
    build_atlas({f: iter_polars(synthetic_frame(df, f), f) for f in G.frames}, G, tmp_path, log=lambda *_: None)
    manifest, _, _ = read_atlas(tmp_path)
    assert [e["frame"] for e in manifest["voxels"]["frames"]] == list(G.frames)
    for entry in manifest["voxels"]["frames"]:
        base, qs = read_voxels(tmp_path, entry)
        assert base["cond_offsets"][-1] == len(base["voxel"]) == len(qs["Np"]["n"])


def _all_conds():
    return list(range(int(np.prod(G.cube_shape(CUBE)))))


def test_vector_voxel_sums_match_rows():
    prep = prepare(canonical_columns(_pgsm(30_000, 12), "PGSM"), G, "PGSM")
    acc = VoxelAccumulator(G, "PGSM")
    acc.add(prep)
    vox = acc.finalize()
    assert set(COMPONENTS) <= set(vox["quantities"])
    cond = flat_condition_index(prep.cond_bins, G.cube_dims(CUBE), G.cube_shape(CUBE))
    for name in ("V_vec", "B_vec"):
        vec = prep.vectors[name]
        ok = (cond >= 0) & (prep.cells["PGSM"] >= 0) & np.all(np.isfinite(vec), axis=1)
        for i, c in enumerate("xyz"):
            _, n, s = select_voxels(vox["base"], vox["quantities"][f"{name}_{c}"], _all_conds())
            assert int(n.sum()) == int(ok.sum())
            assert np.isclose(s.sum(), vec[ok, i].sum(), rtol=1e-4, atol=1e-3)


def test_rows_without_boundaries_leave_scalars_unchanged():
    c = canonical_columns(_pgsm(30_000, 13), "PGSM")
    full = VoxelAccumulator(G, "PGSM")
    full.add(prepare(c, G, "PGSM"))
    holed_cols = {k: np.array(v, copy=True) for k, v in c.items()}
    holed_cols["R_mp"][::10] = np.nan
    holed = VoxelAccumulator(G, "PGSM")
    holed.add(prepare(holed_cols, G, "PGSM"))
    a, b = full.finalize(), holed.finalize()
    for q in G.quantity_names:
        np.testing.assert_array_equal(a["quantities"][q]["n"], b["quantities"][q]["n"])
    na = select_voxels(a["base"], a["quantities"]["V_vec_x"], _all_conds())[1].sum()
    nb = select_voxels(b["base"], b["quantities"]["V_vec_x"], _all_conds())[1].sum()
    assert 0.85 * na < nb < 0.95 * na
