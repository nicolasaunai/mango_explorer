import numpy as np
from scipy.spatial import cKDTree

from mango_explorer.atlas.binning import flat_condition_index
from mango_explorer.atlas.grid import load_grid
from mango_explorer.atlas.knn import frame_positions
from mango_explorer.atlas.pipeline import build_atlas
from mango_explorer.atlas.prepare import prepare
from mango_explorer.atlas.sources import columns_from_polars, iter_polars
from mango_explorer.atlas.store import read_atlas, read_voxels
from mango_explorer.atlas.synthetic import synthetic_magnetosheath
from mango_explorer.atlas.vectors import COMPONENTS, in_frame
from mango_explorer.atlas.voxels import (
    VoxelAccumulator,
    select_voxels,
    voxel_centers,
    voxel_ids,
    voxel_knn,
)

G = load_grid()


def test_voxel_ids_round_trip_to_centres():
    p = np.array([[0.1, 0.1, 0.1], [12.3, -4.56, 7.89], [-30.0, 25.0, -25.0]])
    c = voxel_centers(voxel_ids(p, G), G)
    assert np.all(np.abs(c - p) <= G.raw["voxels"]["size_re"] / 2 + 1e-12)


def test_voxel_sums_match_rows_and_knn_matches_exact_weighted_mean(tmp_path):
    df = synthetic_magnetosheath(300_000, seed=8)
    acc = VoxelAccumulator(G, "clock-cone-Ma", "PGSM_fold")
    for cols in iter_polars(df, 70_000):
        acc.add(prepare(cols, G))
    vox = acc.finalize()

    prep = prepare(columns_from_polars(df), G)
    sel = np.isin(prep.cond_bins["cone_deg"], [2, 3, 4])
    from mango_explorer.atlas.binning import flat_condition_index
    cond = flat_condition_index(prep.cond_bins, G.cube_dims("clock-cone-Ma"), G.cube_shape("clock-cone-Ma"))
    ok = sel & (cond >= 0) & (prep.cells["PGSM_fold"] >= 0) & np.isfinite(prep.values["Np_ratio"])
    conds = sorted(set(cond[sel & (cond >= 0)].tolist()))
    vid, n, s = select_voxels(vox["base"], vox["quantities"]["Np_ratio"], conds)
    assert int(n.sum()) == int(ok.sum())
    assert np.isclose(s.sum(), prep.values["Np_ratio"][ok].sum(), rtol=1e-5)

    pos = frame_positions("PGSM_fold", prep.xyz[ok], prep.clock_deg[ok], prep.bx_neg[ok])
    val = prep.values["Np_ratio"][ok]
    rng = np.random.default_rng(1)
    # off-sample points (on a sample, 1/d weights reduce the exact answer to that sample's value)
    nodes = pos[rng.choice(len(pos), 40, replace=False)] + rng.normal(0, 0.3, (40, 3))
    k = 2000
    dist, idx = cKDTree(pos).query(nodes, k=k)
    w = 1 / np.maximum(dist, 1e-9)
    exact = (w * val[idx]).sum(1) / w.sum(1)
    approx = voxel_knn(nodes, vid, n, s, G, k=k, cap=3.0)["value"]
    good = np.isfinite(approx)
    assert good.mean() > 0.5   # sparse synthetic passes: some points exceed the cap
    assert np.percentile(np.abs(np.log10(approx[good] / exact[good])), 90) < 0.01

    uniform = voxel_knn(nodes, vid, n, s, G, k=k, cap=3.0, weighted=False)["value"]
    plain = val[idx].mean(1)
    assert np.percentile(np.abs(np.log10(uniform[good] / plain[good])), 90) < 0.01


def test_voxel_knn_cap_and_partial_last_voxel():
    # two voxels: 10 samples at the node, 30 samples 1 R_E away; k = 20 uses 10 + 10
    vid = voxel_ids(np.array([[0.1, 0.1, 0.1], [1.1, 0.1, 0.1]]), G)
    n, s = np.array([10.0, 30.0]), np.array([10.0, 90.0])   # mean 1 and mean 3
    node = voxel_centers(vid[:1], G)
    r = voxel_knn(node, vid, n, s, G, k=20, cap=2.0, weighted=False)
    assert r["n"][0] == 20 and np.isclose(r["value"][0], 2.0)
    # the 10th sample (ceil(k/2)) lies in the node's own voxel, at distance size/2*sqrt(3)
    assert np.isnan(voxel_knn(node + 0.3, vid, n, s, G, k=20, cap=0.05, weighted=False)["value"][0])
    far = voxel_knn(node + 50, vid, n, s, G, k=20, cap=2.0)
    assert np.isnan(far["value"][0])


def test_voxels_round_trip_through_the_atlas(tmp_path):
    df = synthetic_magnetosheath(30_000, seed=9)
    build_atlas(iter_polars(df), G, tmp_path, frames=["PGSM"], log=lambda *_: None)
    manifest, _, _ = read_atlas(tmp_path)
    entry = manifest["voxels"]["frames"][0]
    base, qs = read_voxels(tmp_path, entry)
    assert entry["frame"] == "PGSM"
    assert base["cond_offsets"][-1] == len(base["voxel"]) == len(qs["Np"]["n"])


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
