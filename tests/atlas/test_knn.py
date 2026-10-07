import numpy as np

from mango_explorer.atlas.frames import vector_to_frame
from mango_explorer.atlas.grid import load_grid
from mango_explorer.atlas.knn import SampleAccumulator, frame_positions, knn_stats, sample_keep
from mango_explorer.atlas.pipeline import build_atlas
from mango_explorer.atlas.prepare import prepare
from mango_explorer.atlas.quantities import geometric_depth
from mango_explorer.atlas.sources import columns_from_polars, iter_polars
from mango_explorer.atlas.store import read_atlas, read_samples
from mango_explorer.atlas.synthetic import synthetic_magnetosheath

G = load_grid()


def brute(nodes, pos, val, iv, k, cap, factor=2.0):
    out = []
    for p in nodes:
        d = np.linalg.norm(pos - p, axis=1)
        ok = np.isfinite(val)
        order = np.argsort(np.where(ok, d, np.inf))[:k]
        order = order[(d[order] <= factor * cap) & ok[order]]
        half = (k + 1) // 2
        if len(order) < half or d[order][half - 1] > cap:
            out.append(np.nan)
        else:
            out.append(np.median(val[order]))
    return np.array(out)


def test_knn_matches_brute_force_and_applies_the_cap():
    rng = np.random.default_rng(0)
    pos = rng.uniform(0, 10, (3000, 3))
    pos[:200] = rng.uniform(30, 31, (200, 3))       # a dense far cluster
    val = rng.normal(0, 1, 3000)
    val[::17] = np.nan
    iv = rng.integers(0, 40, 3000)
    nodes = np.concatenate([rng.uniform(0, 10, (50, 3)), [[30.5, 30.5, 30.5], [20, 20, 20]]])
    got = knn_stats(nodes, pos, val, iv, k=20, cap=2.0)
    np.testing.assert_allclose(got["median"], brute(nodes, pos, val, iv, 20, 2.0), equal_nan=True)
    assert np.isnan(got["median"][-1])       # empty region: NaN
    assert np.isfinite(got["median"][-2])    # dense cluster: value
    assert np.all(got["neff"][np.isfinite(got["median"])] <= 20)


def test_cap_rule_uses_the_median_neighbour_distance():
    # 10 neighbours at distance 1 and 10 at distance 5: k=20 median distance is 1 (valid), k=24 is 5 (NaN)
    pos = np.array([[1, 0, 0]] * 10 + [[5, 0, 0]] * 10 + [[50, 0, 0]] * 10, dtype=float)
    val = np.arange(30, dtype=float)
    iv = np.arange(30)
    assert np.isfinite(knn_stats([[0, 0, 0]], pos, val, iv, k=20, cap=2.0, search_factor=3.0)["median"][0])
    assert np.isnan(knn_stats([[0, 0, 0]], pos, val, iv, k=24, cap=2.0, search_factor=3.0)["median"][0])


def test_frame_positions_match_the_frames_module():
    df = synthetic_magnetosheath(5_000, seed=2)
    prep = prepare(columns_from_polars(df), G)
    imf = {k: np.asarray(columns_from_polars(df)[k])[np.isfinite(columns_from_polars(df)["Bx_imf"])]
           for k in ("Bx_imf", "By_imf", "Bz_imf")}
    for frame in G.frames:
        mine = frame_positions(frame, prep.xyz, prep.clock_deg, prep.bx_neg)
        ref = np.stack(vector_to_frame(frame, *prep.xyz.T, magnetic=False,
                                       bx_imf=imf["Bx_imf"], by_imf=imf["By_imf"], bz_imf=imf["Bz_imf"]), 1)
        np.testing.assert_allclose(mine, ref, atol=1e-9)


def test_geometric_depth_of_synthetic_positions_is_the_generated_depth():
    df = synthetic_magnetosheath(5_000, seed=3)
    cols = columns_from_polars(df)
    np.testing.assert_allclose(geometric_depth(cols, G), cols["R_norm"], atol=1e-9)


def test_sample_fraction_is_random_but_deterministic(tmp_path):
    t = np.arange(200_000, dtype=np.int64) * 5_000_000_000
    iv = np.zeros_like(t)
    keep = sample_keep(iv, t, 0.1)
    assert 0.09 < keep.mean() < 0.11
    np.testing.assert_array_equal(keep, sample_keep(iv, t, 0.1))
    # not periodic in time: kept samples are not evenly spaced
    assert np.std(np.diff(np.flatnonzero(keep))) > 3

    df = synthetic_magnetosheath(20_000, seed=4)
    acc = SampleAccumulator(G, "clock-cone-Ma", 0.25)
    for cols in iter_polars(df, 7_000):
        acc.add(prepare(cols, G))
    table = acc.finalize()
    assert np.all(np.diff(table["cond_offsets"].astype(np.int64)) >= 0)
    assert table["cond_offsets"][-1] == len(table["x"])

    build_atlas(iter_polars(df), G, tmp_path, sample_fraction=0.25, log=lambda *_: None)
    manifest, _, _ = read_atlas(tmp_path)
    back = read_samples(tmp_path, manifest["samples"])
    for k in ("x", "z", "interval", "q:Np_ratio"):
        np.testing.assert_array_equal(back[k], table[k])
