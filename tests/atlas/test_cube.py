import numpy as np
import polars as pl
import pytest

from mango_explorer.atlas.columns import PGSM_CONE
from mango_explorer.atlas.cube import CubeAccumulator
from mango_explorer.atlas.grid import load_grid
from mango_explorer.atlas.hours import HourAccumulator
from mango_explorer.atlas.pipeline import build_atlas
from mango_explorer.atlas.prepare import prepare
from mango_explorer.atlas.reference import reference_query
from mango_explorer.atlas.sources import canonical_columns, iter_polars
from mango_explorer.atlas.store import read_atlas
from mango_explorer.atlas.synthetic import synthetic_frame, synthetic_magnetosheath

G = load_grid()
FRAMES = ("GSM", "PGSM")


@pytest.fixture(scope="module")
def rows():
    df = synthetic_magnetosheath(40_000, seed=3)
    return {f: synthetic_frame(df, f) for f in FRAMES}


@pytest.fixture(scope="module")
def prep(rows):
    return {f: prepare(canonical_columns(rows[f], f), G, f) for f in FRAMES}


@pytest.fixture(scope="module")
def cubes(rows):
    out = {}
    for f in FRAMES:
        acc = CubeAccumulator(G, G.cube_of_frame(f))
        for c in iter_polars(rows[f], f, chunk_rows=7_001):  # chunks deliberately split hours
            acc.add(prepare(c, G, f))
        out[f] = acc.finalize()
    return out


SELECTIONS = {
    "GSM": [{}, {"clock_deg": [11, 0, 1], "cone_deg": [2, 3]}, {"Ma_sw": [2, 3], "clock_deg": [3]}],
    "PGSM": [{}, {"cone_deg": [2, 3]}, {"Ma_sw": [2, 3], "cone_deg": [8, 9]}],
}


@pytest.mark.parametrize("frame,sel", [(f, s) for f in FRAMES for s in SELECTIONS[f]])
def test_cube_sum_equals_brute_force(cubes, prep, frame, sel):
    got = cubes[frame].query(sel)
    for q in ("Np", "Tp_ratio"):
        ref = reference_query(prep[frame], G, frame, sel, q)
        np.testing.assert_array_equal(got["hist"][q], ref["hist"])
        np.testing.assert_array_equal(got["n"], ref["n"])
        assert np.all(got["neff_upper"] >= ref["neff"])


def test_neff_exact_for_single_condition_bin(cubes, prep):
    sel = {"clock_deg": [2], "cone_deg": [4], "Ma_sw": [3]}
    got = cubes["GSM"].query(sel)
    ref = reference_query(prep["GSM"], G, "GSM", sel, "Np")
    np.testing.assert_array_equal(got["neff_upper"], ref["neff"])


def test_pgsm_cone_bins_hold_the_two_copies_apart(rows, prep):
    # cone=[0, 180]: copies of one sample sit in cone bins b and 11 - b
    p = prep["PGSM"]
    n = np.bincount(p.cond_bins["cone_deg"][p.cond_bins["cone_deg"] >= 0], minlength=12)
    np.testing.assert_array_equal(n, n[::-1])
    assert rows["PGSM"].filter(pl.col("bx_sign") == 1)[PGSM_CONE].max() <= 90


def test_pgsm_concentrates_quasi_parallel_heating_on_plus_z():
    # synthetic data heat the quasi-parallel side; at clock 0 with Bx > 0 (cone < 90) it sits at +Z
    from mango_explorer.atlas.stats import hist_quantile

    big = synthetic_frame(synthetic_magnetosheath(1_000_000, seed=11), "PGSM")
    acc = CubeAccumulator(G, "cone-Ma")
    for c in iter_polars(big, "PGSM", 500_000):
        acc.add(prepare(c, G, "PGSM"))
    hist = acc.finalize().query({"cone_deg": [2, 3]})["hist"]["Tp_ratio"]
    hist = hist.reshape(*G.spatial_shape, G.n_hist)[:, 3:8].sum(axis=(0, 1))  # theta 18-48
    north, south = hist[4:8].sum(axis=0), hist[16:20].sum(axis=0)             # phi 60-120, 240-300
    edges = G.hist_axis_edges("Tp_ratio")
    assert hist_quantile(north, edges, 0.5) > hist_quantile(south, edges, 0.5) + 0.1


def test_hour_tables(rows, prep):
    for f in FRAMES:
        h = HourAccumulator(G, f)
        for c in iter_polars(rows[f], f, chunk_rows=9_999):
            h.add(prepare(c, G, f))
        t = h.finalize()
        assert int(t["n"].sum()) == int((prep[f].cells[f] >= 0).sum())
        assert ("clock_deg" in t) == (f == "GSM")
    p = prep["GSM"]
    h = HourAccumulator(G, "GSM")
    h.add(p)
    t = h.finalize()
    sel = (t["clock_deg"] == 3) & (t["cone_deg"] == 2)
    in_sel = (p.cells["GSM"] >= 0) & (p.cond_bins["clock_deg"] == 3) & (p.cond_bins["cone_deg"] == 2)
    assert int(t["n"][sel].sum()) == int(in_sel.sum())
    keys = t["sc"][sel].astype(np.int64) << 40 | t["interval"][sel]
    assert len(np.unique(keys)) == len(np.unique(p.interval[in_sel]))


def _build(rows, out, **kw):
    return build_atlas({f: iter_polars(rows[f], f, 15_000) for f in FRAMES}, G, out, log=lambda *_: None, **kw)


def test_atlas_round_trip(tmp_path, rows, cubes):
    _build(rows, tmp_path)
    manifest, read, hours = read_atlas(tmp_path)
    assert manifest["grid"] == "grid-v3" and manifest["format"] == "mango-atlas/2"
    by_frame = {c.frame: c for c in read}
    for f in FRAMES:
        sel = SELECTIONS[f][1]
        a, b = cubes[f].query(sel), by_frame[f].query(sel)
        np.testing.assert_array_equal(a["hist"]["B"], b["hist"]["B"])
        np.testing.assert_array_equal(a["neff_upper"], b["neff_upper"])
        s = manifest["stats"][f]
        assert int(hours[f]["n"].sum()) == s["rows_kept"] - s["dropped_outside_shell_or_theta"]
    assert {h["frame"] for h in manifest["hours"]} == set(FRAMES)
    assert {s["frame"] for s in manifest["samples"]} == set(FRAMES)


def test_spacecraft_counts_sum_to_n(cubes):
    q = cubes["PGSM"].query({"cone_deg": [2, 3]})
    np.testing.assert_array_equal(q["n_by_sc"].sum(axis=1), q["n"])


@pytest.mark.parametrize("frame,sel", [("GSM", {"clock_deg": [0, 1, 2, 3], "cone_deg": [2, 3, 4]}),
                                        ("PGSM", {"cone_deg": [2, 3, 4]})])
def test_cell_statistics_matches_the_cube(rows, cubes, frame, sel):
    from mango_explorer.atlas import cell_statistics
    from mango_explorer.atlas.stats import hist_quantile

    cells = cell_statistics(rows[frame], frame, "Np_ratio", sel)
    q = cubes[frame].query(sel)
    idx = cells["cell"].to_numpy()
    np.testing.assert_array_equal(cells["n"].to_numpy(), q["n"][idx])
    assert np.all(cells["neff"].to_numpy() <= q["neff_upper"][idx])
    med = 10 ** hist_quantile(q["hist"]["Np_ratio"][idx], G.hist_axis_edges("Np_ratio"), 0.5)
    np.testing.assert_allclose(cells["median"].to_numpy(), med, rtol=1e-12)
    ratio = np.log10(cells["median"].to_numpy() / cells["median_exact"].to_numpy())
    assert np.nanmax(np.abs(ratio)) < (np.log10(20) - np.log10(0.05)) / 48


def test_packed_atlas_reads_back_identically(tmp_path, rows):
    from mango_explorer.atlas.store import pack_atlas, read_samples

    _build(rows, tmp_path / "raw")
    manifest = pack_atlas(tmp_path / "raw", tmp_path / "packed")
    assert manifest["encoding"] == "gzip"
    assert not list((tmp_path / "packed").rglob("*.bin"))
    m1, c1, h1 = read_atlas(tmp_path / "raw")
    m2, c2, h2 = read_atlas(tmp_path / "packed")
    for f in FRAMES:
        np.testing.assert_array_equal(h1[f]["n"], h2[f]["n"])
    a, b = c1[1].query({"cone_deg": [2]}), c2[1].query({"cone_deg": [2]})
    np.testing.assert_array_equal(a["hist"]["Np"], b["hist"]["Np"])
    for e1, e2 in zip(m1["samples"], m2["samples"]):
        np.testing.assert_array_equal(read_samples(tmp_path / "raw", e1)["x"], read_samples(tmp_path / "packed", e2)["x"])


def test_pack_can_thin_the_sample_tables(tmp_path, rows):
    from mango_explorer.atlas.store import pack_atlas, read_samples

    _build(rows, tmp_path / "raw", sample_fraction=0.5)
    m = pack_atlas(tmp_path / "raw", tmp_path / "packed", sample_fraction=0.1)
    raw, _, _ = read_atlas(tmp_path / "raw")
    for e_raw, e in zip(raw["samples"], m["samples"]):
        assert e["fraction"] == 0.1
        a, b = read_samples(tmp_path / "raw", e_raw), read_samples(tmp_path / "packed", e)
        assert 0.12 < len(b["x"]) / len(a["x"]) < 0.28
        assert b["cond_offsets"][-1] == len(b["x"])
        assert np.isin(b["x"], a["x"]).all()
