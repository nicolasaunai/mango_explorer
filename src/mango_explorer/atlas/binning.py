"""Turn physical values into bin indices on the grid. -1 always means "dropped"."""
from __future__ import annotations

import numpy as np

from mango_explorer.atlas.grid import Grid


def digitize(values, edges) -> np.ndarray:
    """Index of the bin holding each value; the last edge is inclusive, outside values get -1."""
    v = np.asarray(values, dtype=float)
    edges = np.asarray(edges, dtype=float)
    idx = np.searchsorted(edges, v, side="right") - 1
    idx = np.where(v == edges[-1], len(edges) - 2, idx)
    bad = ~np.isfinite(v) | (v < edges[0]) | (v > edges[-1])
    return np.where(bad, -1, idx).astype(np.int64)


def periodic_digitize(values_deg, edges) -> np.ndarray:
    """Like digitize, after wrapping the angle into [edges[0], edges[-1])."""
    edges = np.asarray(edges, dtype=float)
    period = edges[-1] - edges[0]
    v = (np.asarray(values_deg, dtype=float) - edges[0]) % period + edges[0]
    return digitize(v, edges)


def depth_index(d, grid: Grid) -> np.ndarray:
    """D_msh bin; values inside the clip band but outside the edges go to the first/last bin."""
    edges = grid.d_edges
    lo, hi = grid.d_clip
    d = np.asarray(d, dtype=float)
    keep = np.isfinite(d) & (d >= lo) & (d <= hi)
    clipped = np.clip(d, edges[0], edges[-1])
    return np.where(keep, digitize(clipped, edges), -1)


def spatial_cells(d, theta_deg, phi_deg, grid: Grid) -> np.ndarray:
    """Flat cell index in (D_msh, theta, phi) order, -1 if any coordinate is dropped."""
    _, nt, nphi = grid.spatial_shape
    i = depth_index(d, grid)
    j = digitize(theta_deg, grid.theta_edges)
    k = periodic_digitize(phi_deg, grid.phi_edges)
    cell = (i * nt + j) * nphi + k
    return np.where((i < 0) | (j < 0) | (k < 0), -1, cell)


def condition_bins(values: dict[str, np.ndarray], grid: Grid) -> dict[str, np.ndarray]:
    out = {}
    for name, v in values.items():
        edges = grid.condition_edges(name)
        f = periodic_digitize if grid.condition_is_periodic(name) else digitize
        out[name] = f(v, edges)
    return out


def flat_condition_index(bins: dict[str, np.ndarray], dims, shape) -> np.ndarray:
    """Row-major flat index over the cube's condition dims, -1 if any dim is dropped."""
    flat = np.zeros_like(bins[dims[0]])
    bad = np.zeros(flat.shape, dtype=bool)
    for name, n in zip(dims, shape):
        flat = flat * n + bins[name]
        bad |= bins[name] < 0
    return np.where(bad, -1, flat)


def hist_bins(values, quantity: str, grid: Grid) -> np.ndarray:
    """Histogram bin in axis space; out-of-range values are clipped into the end bins."""
    v = np.asarray(values, dtype=float)
    edges = grid.hist_axis_edges(quantity)
    nb = grid.n_hist
    with np.errstate(invalid="ignore", divide="ignore"):
        axis = np.log10(v) if grid.is_log(quantity) else v
    ok = np.isfinite(axis)
    pos = (axis - edges[0]) / (edges[-1] - edges[0]) * nb
    idx = np.clip(np.floor(np.where(ok, pos, 0)), 0, nb - 1).astype(np.int64)
    return np.where(ok, idx, -1)
