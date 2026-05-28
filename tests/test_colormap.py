import numpy as np
import pytest
from mango_explorer.colormap import to_rgba, colorbar_info


def test_to_rgba_shape_and_dtype():
    values = np.array([[0.0, 0.5], [1.0, 0.25]], dtype=np.float32)
    mask = np.ones_like(values, dtype=bool)
    out = to_rgba(values, vmin=0.0, vmax=1.0, mask=mask)
    assert out.shape == (2, 2, 4)
    assert out.dtype == np.float32


def test_to_rgba_endpoints():
    values = np.array([[0.0, 1.0]], dtype=np.float32)
    mask = np.ones_like(values, dtype=bool)
    out = to_rgba(values, vmin=0.0, vmax=1.0, mask=mask)
    # Endpoints should differ in RGB
    assert not np.allclose(out[0, 0, :3], out[0, 1, :3])


def test_masked_bins_have_zero_alpha():
    values = np.array([[0.5, 0.5]], dtype=np.float32)
    mask = np.array([[True, False]])
    out = to_rgba(values, vmin=0.0, vmax=1.0, mask=mask)
    assert out[0, 0, 3] == pytest.approx(1.0)
    assert out[0, 1, 3] == pytest.approx(0.0)


def test_colorbar_info():
    info = colorbar_info(vmin=0.0, vmax=50.0, n_ticks=6)
    assert info["vmin"] == 0.0
    assert info["vmax"] == 50.0
    assert len(info["ticks"]) == 6
    assert info["ticks"][0] == pytest.approx(0.0)
    assert info["ticks"][-1] == pytest.approx(50.0)


def test_to_rgba_rdbu_midpoint_is_white():
    # Centre of a symmetric range should map to the middle of RdBu (near white)
    values = np.array([[0.0]], dtype=np.float32)
    mask = np.ones_like(values, dtype=bool)
    out = to_rgba(values, vmin=-1.0, vmax=1.0, mask=mask, cmap="rdbu")
    rgb = out[0, 0, :3]
    assert np.all(rgb > 0.9), f"expected near-white at centre, got {rgb}"


def test_to_rgba_rdbu_endpoints_differ_from_jet():
    values = np.array([[0.0, 1.0]], dtype=np.float32)
    mask = np.ones_like(values, dtype=bool)
    jet_out = to_rgba(values, vmin=0.0, vmax=1.0, mask=mask, cmap="jet")
    rdbu_out = to_rgba(values, vmin=0.0, vmax=1.0, mask=mask, cmap="rdbu")
    assert not np.allclose(jet_out[0, 0, :3], rdbu_out[0, 0, :3])


def test_colorbar_info_symmetric():
    info = colorbar_info(vmin=-10.0, vmax=10.0, n_ticks=5)
    assert info["ticks"][0] == pytest.approx(-10.0)
    assert info["ticks"][-1] == pytest.approx(10.0)
    assert info["ticks"][2] == pytest.approx(0.0)
