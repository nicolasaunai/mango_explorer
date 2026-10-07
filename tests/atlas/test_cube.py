import numpy as np
import pytest

from mango_explorer.atlas.cube import CubeAccumulator
from mango_explorer.atlas.grid import load_grid
from mango_explorer.atlas.hours import HourAccumulator
from mango_explorer.atlas.pipeline import build_atlas
from mango_explorer.atlas.prepare import prepare
from mango_explorer.atlas.reference import reference_query
from mango_explorer.atlas.sources import columns_from_polars, iter_polars
from mango_explorer.atlas.store import read_atlas
from mango_explorer.atlas.synthetic import synthetic_magnetosheath

G = load_grid()


@pytest.fixture(scope="module")
def df():
    return synthetic_magnetosheath(40_000, seed=3)


@pytest.fixture(scope="module")
def prep(df):
    return prepare(columns_from_polars(df), G)


@pytest.fixture(scope="module")
def cubes(df):
    accs = {f: CubeAccumulator(G, "clock-cone-Ma", f) for f in G.frames}
    for cols in iter_polars(df, chunk_rows=7_001):  # chunks deliberately split hours
        p = prepare(cols, G)
        for a in accs.values():
            a.add(p)
    return {f: a.finalize() for f, a in accs.items()}


SELECTIONS = [
    {},
    {"clock_deg": [11, 0, 1], "cone_deg": [2, 3]},
    {"Ma_sw": [2, 3], "clock_deg": [3]},
]


@pytest.mark.parametrize("frame", ["GSM", "PGSM", "PGSM_fold"])
@pytest.mark.parametrize("sel", SELECTIONS)
def test_cube_sum_equals_brute_force(cubes, prep, frame, sel):
    got = cubes[frame].query(sel)
    for q in ("Np", "Tp_ratio"):
        ref = reference_query(prep, G, frame, sel, q)
        np.testing.assert_array_equal(got["hist"][q], ref["hist"])
        np.testing.assert_array_equal(got["n"], ref["n"])
        assert np.all(got["neff_upper"] >= ref["neff"])


def test_neff_exact_for_single_condition_bin(cubes, prep):
    sel = {"clock_deg": [2], "cone_deg": [4], "Ma_sw": [3]}
    got = cubes["PGSM"].query(sel)
    ref = reference_query(prep, G, "PGSM", sel, "Np")
    np.testing.assert_array_equal(got["neff_upper"], ref["neff"])


def test_frames_only_move_phi(cubes):
    # the same rows land in every frame: totals per (D, theta) ring are frame independent
    totals = {f: c.query({})["n"].reshape(G.spatial_shape).sum(axis=2) for f, c in cubes.items()}
    np.testing.assert_array_equal(totals["GSM"], totals["PGSM"])
    np.testing.assert_array_equal(totals["GSM"], totals["PGSM_fold"])


def test_pgsm_fold_concentrates_quasi_parallel_heating_on_plus_z():
    # synthetic data heat the quasi-parallel side; after folding it must sit at +Z (phi ~ 90),
    # while plain PGSM splits it between +Z and -Z according to the sign of Bx
    from mango_explorer.atlas.stats import hist_quantile

    big = synthetic_magnetosheath(1_500_000, seed=11)
    acc = CubeAccumulator(G, "clock-cone-Ma", "PGSM_fold")
    for cols in iter_polars(big, 500_000):
        acc.add(prepare(cols, G))
    hist = acc.finalize().query({"cone_deg": [2, 3]})["hist"]["Tp_ratio"]
    hist = hist.reshape(*G.spatial_shape, G.n_hist)[:, 3:8].sum(axis=(0, 1))  # theta 18-48
    north = hist[4:8].sum(axis=0)    # phi 60-120
    south = hist[16:20].sum(axis=0)  # phi 240-300
    edges = G.hist_axis_edges("Tp_ratio")
    assert hist_quantile(north, edges, 0.5) > hist_quantile(south, edges, 0.5) + 0.1


def test_hour_table_counts_match_rows(df, prep):
    h = HourAccumulator(G)
    for cols in iter_polars(df, chunk_rows=9_999):
        h.add(prepare(cols, G))
    t = h.finalize()
    assert int(t["n"].sum()) == int((prep.cells["GSM"] >= 0).sum())
    sel = (t["clock_deg"] == 3) & (t["cone_deg"] == 2)
    in_sel = (prep.cells["GSM"] >= 0) & (prep.cond_bins["clock_deg"] == 3) \
        & (prep.cond_bins["cone_deg"] == 2)
    assert int(t["n"][sel].sum()) == int(in_sel.sum())
    keys = t["sc"][sel].astype(np.int64) << 40 | t["interval"][sel]
    assert len(np.unique(keys)) == len(np.unique(prep.interval[in_sel]))


def test_atlas_round_trip(tmp_path, df, cubes):
    build_atlas(iter_polars(df, 15_000), G, tmp_path, log=lambda *_: None)
    manifest, read, hours = read_atlas(tmp_path)
    assert manifest["grid"] == "grid-v1"
    by_frame = {c.frame: c for c in read}
    for frame, cube in cubes.items():
        a, b = cube.query({"clock_deg": [1, 2]}), by_frame[frame].query({"clock_deg": [1, 2]})
        np.testing.assert_array_equal(a["hist"]["B"], b["hist"]["B"])
        np.testing.assert_array_equal(a["neff_upper"], b["neff_upper"])
    assert int(hours["n"].sum()) == manifest["stats"]["rows_kept"] - \
        manifest["stats"]["dropped_outside_shell_or_theta"]
