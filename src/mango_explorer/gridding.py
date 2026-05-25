"""2D binning of scattered point clouds for slice planes."""
from __future__ import annotations

import numpy as np
import polars as pl

_PLANE_AXES = {
    "xy": ("X_gsm", "Y_gsm", "Z_gsm"),
    "xz": ("X_gsm", "Z_gsm", "Y_gsm"),
    "yz": ("Y_gsm", "Z_gsm", "X_gsm"),
}


def bin_scattered_2d(
    df: pl.DataFrame,
    plane: str,
    position: float,
    variable: str,
    extent: float = 25.0,
    n: int = 256,
    slab: float = 1.0,
):
    """Bin scattered points within a slab around a plane into a 2D mean-grid.

    Returns (grid[n,n] float32, mask[n,n] bool). NaN bins are zeroed and masked.
    Coordinates in `df` are expected as columns X_gsm, Y_gsm, Z_gsm (RE).
    Axes for the plane:
      "xy" → u=X, v=Y, perpendicular=Z
      "xz" → u=X, v=Z, perpendicular=Y
      "yz" → u=Y, v=Z, perpendicular=X
    """
    u_col, v_col, p_col = _PLANE_AXES[plane]
    sub = df.filter(
        (pl.col(p_col) >= position - slab) & (pl.col(p_col) <= position + slab)
    )
    u = sub[u_col].to_numpy()
    v = sub[v_col].to_numpy()
    w = sub[variable].to_numpy()

    edges = np.linspace(-extent, extent, n + 1)
    sum_grid, _, _ = np.histogram2d(u, v, bins=[edges, edges], weights=w)
    cnt_grid, _, _ = np.histogram2d(u, v, bins=[edges, edges])

    mask = cnt_grid > 0
    grid = np.zeros_like(sum_grid, dtype=np.float32)
    np.divide(sum_grid, cnt_grid, out=grid, where=mask, casting="unsafe")
    return grid, mask
