"""2D binning of scattered point clouds for slice planes."""
from __future__ import annotations

from typing import Any

import numpy as np

_PLANE_AXES = {
    "xy": ("X_gsm", "Y_gsm", "Z_gsm"),
    "xz": ("X_gsm", "Z_gsm", "Y_gsm"),
    "yz": ("Y_gsm", "Z_gsm", "X_gsm"),
}


def bin_scattered_2d(
    df: dict[str, Any],
    plane: str,
    position: float,
    variable: str,
    extent: float = 25.0,
    n: int = 256,
    slab: float = 1.0,
):
    """Bin scattered points within a slab around a plane into a 2D mean-grid.

    Returns (grid[n,n] float32, mask[n,n] bool). NaN bins are zeroed and masked.
    Coordinates in `df` are expected as arrays keyed X_gsm, Y_gsm, Z_gsm (RE).
    Axes for the plane:
      "xy" → u=X, v=Y, perpendicular=Z
      "xz" → u=X, v=Z, perpendicular=Y
      "yz" → u=Y, v=Z, perpendicular=X
    """
    u_col, v_col, p_col = _PLANE_AXES[plane]
    perp = df[p_col]
    slab_mask = (perp >= position - slab) & (perp <= position + slab)
    u = df[u_col][slab_mask]
    v = df[v_col][slab_mask]
    w = df[variable][slab_mask]

    edges = np.linspace(-extent, extent, n + 1)
    sum_grid, _, _ = np.histogram2d(u, v, bins=[edges, edges], weights=w)
    cnt_grid, _, _ = np.histogram2d(u, v, bins=[edges, edges])

    mask = cnt_grid > 0
    grid = np.zeros_like(sum_grid, dtype=np.float32)
    np.divide(sum_grid, cnt_grid, out=grid, where=mask, casting="unsafe")
    return grid, mask
