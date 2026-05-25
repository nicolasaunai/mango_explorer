import numpy as np
import pytest
from mango_explorer.gridding import bin_scattered_2d


def _df(points):
    return {
        "X_gsm": np.array([p[0] for p in points], dtype=np.float32),
        "Y_gsm": np.array([p[1] for p in points], dtype=np.float32),
        "Z_gsm": np.array([p[2] for p in points], dtype=np.float32),
        "Np":    np.array([p[3] for p in points], dtype=np.float32),
    }


def test_single_point_lands_in_one_bin():
    df = _df([(5.0, 1.0, 0.0, 7.0)])
    grid, mask = bin_scattered_2d(df, plane="xy", position=0.0,
                                  variable="Np", extent=10.0, n=8, slab=2.0)
    assert grid.shape == (8, 8)
    assert mask.dtype == bool
    assert mask.sum() == 1
    assert grid[mask].item() == pytest.approx(7.0)


def test_points_outside_slab_are_ignored():
    df = _df([(0.0, 0.0, 5.0, 99.0)])  # z=5, slab is ±1 around z=0
    grid, mask = bin_scattered_2d(df, plane="xy", position=0.0,
                                  variable="Np", extent=10.0, n=8, slab=1.0)
    assert mask.sum() == 0


def test_mean_aggregation():
    df = _df([(0.5, 0.5, 0.0, 4.0), (0.4, 0.6, 0.0, 6.0)])
    grid, mask = bin_scattered_2d(df, plane="xy", position=0.0,
                                  variable="Np", extent=10.0, n=4, slab=1.0)
    nonempty = grid[mask]
    assert nonempty.size == 1
    assert nonempty.item() == pytest.approx(5.0)


def test_yz_plane_uses_y_z_axes():
    df = _df([(0.0, 3.0, 4.0, 1.0)])
    grid, mask = bin_scattered_2d(df, plane="yz", position=0.0,
                                  variable="Np", extent=10.0, n=10, slab=1.0)
    assert mask.sum() == 1
