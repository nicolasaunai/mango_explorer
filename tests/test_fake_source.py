import numpy as np
import pytest
from mango_explorer.data.fake import FakeSource


@pytest.fixture
def src():
    return FakeSource(seed=42, n_points=5000)


def test_regions_include_magnetosheath(src):
    assert "magnetosheath" in src.regions()


def test_columns_match_real_mango_shape(src):
    cols = set(src.columns("magnetosheath"))
    must_have = {"Time", "spacecraft",
                 "X_gsm", "Y_gsm", "Z_gsm", "D_msh",
                 "Np", "Tp", "Bz",
                 "Bx_imf", "By_imf", "Bz_imf",
                 "Pd_sw", "Np_sw", "Tp_sw", "Vx_sw", "Beta_sw", "Ma_sw", "Tilt"}
    assert must_have <= cols


def test_filters_are_min_max_pairs(src):
    fl = src.filters("magnetosheath")
    names = {f["name"] for f in fl}
    assert {"bz_imf", "pd_sw", "ma_sw"} <= names
    for f in fl:
        assert {"name", "column", "unit", "description", "params"} <= set(f.keys())


def test_get_data_returns_dict_of_arrays(src):
    df = src.get_data("magnetosheath")
    assert isinstance(df, dict)
    assert len(df["X_gsm"]) > 0


def test_filters_respect_min_max(src):
    df = src.get_data("magnetosheath", ma_sw_min=3.0, ma_sw_max=5.0)
    ma = df["Ma_sw"]
    assert ma.min() >= 3.0 - 1e-9
    assert ma.max() <= 5.0 + 1e-9


def test_deterministic_with_seed():
    df1 = FakeSource(seed=42, n_points=1000).get_data("magnetosheath")
    df2 = FakeSource(seed=42, n_points=1000).get_data("magnetosheath")
    np.testing.assert_array_equal(df1["X_gsm"], df2["X_gsm"])


def test_points_lie_between_mp_and_bs(src):
    df = src.get_data("magnetosheath")
    d = df["D_msh"]
    assert d.min() >= 0.0
    assert d.max() <= 1.0


def test_invalid_filter_raises(src):
    with pytest.raises(ValueError):
        src.get_data("magnetosheath", bogus_min=1)


def test_events_region_present(src):
    assert "events" in src.regions()


def test_events_have_expected_columns(src):
    cols = set(src.columns("events"))
    must_have = {"id", "mission", "date", "type", "X_gsm", "Y_gsm", "Z_gsm",
                 "doi", "title", "authors", "year", "journal"}
    assert must_have <= cols


def test_events_mission_filter(src):
    df = src.get_data("events", mission=["MMS"])
    assert set(df["mission"].tolist()) <= {"MMS"}


def test_events_count_is_about_sixty(src):
    df = src.get_data("events")
    assert 40 <= len(df["id"]) <= 100
