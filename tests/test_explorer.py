import numpy as np
import pytest
from mango_explorer import config, explorer


@pytest.fixture(autouse=True)
def _setup():
    config.use_source("fake", seed=42, n_points=2000)


def test_build_boundary_mp():
    out = explorer.build_boundary("mp", r0=10.5, alpha=0.6)
    assert out["positions"].dtype == np.float32
    assert out["indices"].dtype == np.uint32
    assert out["positions"].ndim == 1 and out["positions"].size % 3 == 0


def test_build_boundary_bs():
    out = explorer.build_boundary("bs", pd=2.0)
    assert out["positions"].dtype == np.float32


def test_build_slice_returns_rgba_and_meta():
    out = explorer.build_slice(plane="xy", position=0.0, variable="Np",
                               extent=25.0, n=64,
                               filters={"ma_sw_min": 3.0, "ma_sw_max": 6.0})
    assert out["rgba"].ndim == 1 and out["rgba"].size == 64 * 64 * 4  # n=64 passed explicitly
    assert out["rgba"].dtype == np.float32
    assert "vmin" in out and "vmax" in out and "ticks" in out


def test_build_slice_bz_has_symmetric_range():
    out = explorer.build_slice(plane="xy", position=0.0, variable="Bz",
                               extent=25.0, n=32)
    assert out["vmin"] == pytest.approx(-out["vmax"], abs=1e-6)


def test_build_slice_tp_has_positive_range():
    out = explorer.build_slice(plane="xy", position=0.0, variable="Tp",
                               extent=25.0, n=32)
    assert out["vmin"] >= 0.0
    assert out["vmax"] > out["vmin"]


def test_build_events_returns_positions_and_metadata():
    out = explorer.build_events(missions=["MMS", "THEMIS"])
    assert out["positions"].dtype == np.float32
    assert out["positions"].ndim == 1 and out["positions"].size % 3 == 0
    assert len(out["meta"]) == out["positions"].size // 3
    # Each metadata row has id/mission/date/type/doi
    assert {"id", "mission", "date", "type", "doi"} <= set(out["meta"][0].keys())
