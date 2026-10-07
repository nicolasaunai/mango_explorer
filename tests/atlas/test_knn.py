import numpy as np
import pytest

from mango_explorer.atlas.grid import load_grid
from mango_explorer.atlas.knn import (
    SampleAccumulator, display_positions, display_radii, frame_phi_deg, knn_stats,
)
from mango_explorer.atlas.pipeline import build_atlas
from mango_explorer.atlas.prepare import prepare
from mango_explorer.atlas.sources import columns_from_polars, iter_polars
from mango_explorer.atlas.store import read_atlas, read_samples
from mango_explorer.atlas.synthetic import synthetic_magnetosheath
from mango_explorer.atlas.quantities import normalized_angles

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


def test_frame_rotation_of_azimuth_matches_frames_module():
    df = synthetic_magnetosheath(5_000, seed=2)
    cols = columns_from_polars(df)
    prep = prepare(cols, G)
    for frame in G.frames:
        _, phi = normalized_angles({k: np.asarray(v)[np.isfinite(cols["Bx_imf"])] for k, v in cols.items()}, frame)
        mine = frame_phi_deg(frame, prep.phi_gsm, prep.clock_deg, prep.bx_neg)
        diff = (mine - phi + 180) % 360 - 180
        assert np.nanmax(np.abs(diff)) < 1e-6


def test_display_positions_sit_between_the_displayed_boundaries():
    r_mp, r_bs = display_radii(G)
    p = display_positions([0.0, 1.0, 0.5], [0.0, 60.0, 90.0], [0.0, 90.0, 200.0], G)
    r = np.linalg.norm(p, axis=1)
    assert r[0] == pytest.approx(r_mp(0.0))
    assert r[1] == pytest.approx(r_bs(np.radians(60)))
    assert r[2] == pytest.approx((r_mp(np.pi / 2) + r_bs(np.pi / 2)) / 2)


def test_sample_table_decimation_and_round_trip(tmp_path):
    df = synthetic_magnetosheath(20_000, seed=4)
    acc_all, acc_min = SampleAccumulator(G, "clock-cone-Ma", 0), SampleAccumulator(G, "clock-cone-Ma", 60)
    for cols in iter_polars(df, 7_000):
        p = prepare(cols, G)
        acc_all.add(p)
        acc_min.add(p)
    t_all, t_min = acc_all.finalize(), acc_min.finalize()
    assert len(t_min["d"]) * 10 < len(t_all["d"]) < len(t_min["d"]) * 14   # ~12 samples per minute
    assert np.all(np.diff(t_all["cond_offsets"].astype(np.int64)) >= 0)
    assert t_all["cond_offsets"][-1] == len(t_all["d"])

    build_atlas(iter_polars(df), G, tmp_path, sample_window_s=60, log=lambda *_: None)
    manifest, _, _ = read_atlas(tmp_path)
    back = read_samples(tmp_path, manifest["samples"])
    for k in ("d", "theta", "interval", "q:Np_ratio"):
        np.testing.assert_array_equal(back[k], t_min[k])
