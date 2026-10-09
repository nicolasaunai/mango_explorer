import numpy as np
import pytest

from mango_explorer.atlas.binning import (
    depth_index,
    digitize,
    flat_condition_index,
    hist_bins,
    periodic_digitize,
    spatial_cells,
)
from mango_explorer.atlas.grid import load_grid
from mango_explorer.atlas.stats import hist_quantile

G = load_grid()


def test_grid_shapes():
    assert G.spatial_shape == (10, 20, 24)
    assert G.n_cells == 4800
    assert G.cube_shape("clock-cone-Ma") == (12, 12, 5)
    assert G.cube_shape("cone-Ma") == (12, 5)
    assert G.n_hist == 48


def test_digitize_edges_and_outside():
    e = np.array([0.0, 1.0, 2.0])
    assert digitize([0.0, 0.5, 1.0, 2.0, -0.1, 2.1, np.nan], e).tolist() == [0, 0, 1, 1, -1, -1, -1]


def test_periodic_wraps():
    e = np.arange(0, 361, 30.0)
    assert periodic_digitize([-10, 365, 359.9, 720], e).tolist() == [11, 0, 11, 0]


def test_depth_clip_band():
    assert depth_index([-0.05, -0.2, 0.05, 1.05, 1.2, 1.0], G).tolist() == [0, -1, 0, 9, -1, 9]


def test_spatial_cell_order_is_d_theta_phi():
    cell = spatial_cells([0.95], [119.0], [359.0], G)
    assert cell[0] == G.n_cells - 1
    assert spatial_cells([0.5], [125.0], [10.0], G)[0] == -1


def test_flat_condition_index_row_major():
    bins = {"clock_deg": np.array([11, 0]), "cone_deg": np.array([11, -1]), "Ma_sw": np.array([4, 0])}
    flat = flat_condition_index(bins, ("clock_deg", "cone_deg", "Ma_sw"), (12, 12, 5))
    assert flat.tolist() == [12 * 12 * 5 - 1, -1]


def test_hist_bins_log_axis_and_clipping():
    lo, hi = G.raw["quantities"]["Np"]["range"]
    b = hist_bins([lo, hi, lo / 10, hi * 10, -1.0, np.nan], "Np", G)
    assert b.tolist() == [0, 47, 0, 47, -1, -1]


def test_hist_quantile_uniform_bins():
    edges = np.linspace(0, 4, 5)
    counts = np.array([[1, 1, 1, 1], [0, 0, 0, 0], [0, 4, 0, 0]])
    med = hist_quantile(counts, edges, 0.5)
    assert med[0] == pytest.approx(2.0)
    assert np.isnan(med[1])
    assert med[2] == pytest.approx(1.5)
