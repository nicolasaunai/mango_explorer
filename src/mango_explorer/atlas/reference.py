"""Brute-force statistics straight from rows. Slow; used to check the cubes and the web app."""
from __future__ import annotations

import numpy as np

from mango_explorer.atlas.grid import Grid
from mango_explorer.atlas.prepare import Prepared


def reference_query(prep: Prepared, grid: Grid, frame: str, selection: dict, quantity: str) -> dict:
    """Per-cell histogram, sample count and exact N_eff for rows inside `selection`.

    `selection` maps condition names to lists of allowed bins; any condition may be used,
    not only the dims of a cube.
    """
    nc, nb = grid.n_cells, grid.n_hist
    cell = prep.cells[frame]
    keep = cell >= 0
    for name, bins in selection.items():
        if bins is not None:
            keep &= np.isin(prep.cond_bins[name], list(bins))
    hb = prep.hist[quantity]
    hist = np.zeros((nc, nb), dtype=np.int64)
    okq = keep & (hb >= 0)
    np.add.at(hist, (cell[okq], hb[okq]), 1)
    n = np.bincount(cell[keep], minlength=nc).astype(np.int64)
    neff = np.zeros(nc, dtype=np.int64)
    for c in np.unique(cell[keep]):
        neff[c] = len(np.unique(prep.interval[keep & (cell == c)]))
    return {"hist": hist, "n": n, "neff": neff}
