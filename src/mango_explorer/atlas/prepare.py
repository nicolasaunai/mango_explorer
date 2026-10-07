"""Per-chunk preparation: every row becomes bin indices, once, shared by all cubes."""
from __future__ import annotations

from dataclasses import dataclass, field

import numpy as np

from mango_explorer.atlas.binning import condition_bins, hist_bins, spatial_cells
from mango_explorer.atlas.grid import Grid
from mango_explorer.atlas.quantities import (
    condition_values,
    interval_ids,
    normalized_angles,
    quantity_values,
    row_mask,
)


@dataclass
class Prepared:
    n_in: int
    n_kept: int
    cond_bins: dict[str, np.ndarray]
    interval: np.ndarray
    hist: dict[str, np.ndarray]
    cells: dict[str, np.ndarray]
    dropped: dict[str, int] = field(default_factory=dict)


def prepare(cols: dict[str, np.ndarray], grid: Grid, frames=None) -> Prepared:
    frames = tuple(frames or grid.frames)
    n_in = len(cols["R_norm"])
    mask = row_mask(cols)
    kept = {k: np.asarray(v)[mask] for k, v in cols.items()}
    conds = condition_bins(condition_values(kept), grid)
    qvals = quantity_values(kept)
    cells = {}
    for frame in frames:
        theta, phi = normalized_angles(kept, frame)
        cells[frame] = spatial_cells(kept["R_norm"], theta, phi, grid)
    any_frame = next(iter(cells.values()))
    return Prepared(
        n_in=n_in,
        n_kept=int(mask.sum()),
        cond_bins=conds,
        interval=interval_ids(kept, grid),
        hist={q: hist_bins(qvals[q], q, grid) for q in grid.quantity_names},
        cells=cells,
        dropped={
            "row_filter": int(n_in - mask.sum()),
            "outside_shell_or_theta": int((any_frame < 0).sum()),
        },
    )
