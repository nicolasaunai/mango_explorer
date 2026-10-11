"""Per-chunk preparation of one frame: every row becomes bin indices, once, shared by all accumulators."""
from __future__ import annotations

from dataclasses import dataclass, field

import numpy as np

from mango_explorer.atlas.binning import condition_bins, hist_bins, spatial_cells
from mango_explorer.atlas.grid import Grid
from mango_explorer.atlas.quantities import (
    condition_values,
    geometric_depth,
    interval_ids,
    normalized_angles,
    quantity_values,
    row_mask,
)
from mango_explorer.atlas.vectors import normalized_vectors


@dataclass
class Prepared:
    frame: str
    n_in: int
    n_kept: int
    cond_bins: dict[str, np.ndarray]
    interval: np.ndarray
    hist: dict[str, np.ndarray]
    cells: dict[str, np.ndarray]          # {frame: flat cell index}, -1 = dropped
    dropped: dict[str, int] = field(default_factory=dict)
    d: np.ndarray | None = None
    t_ns: np.ndarray | None = None
    values: dict[str, np.ndarray] | None = None
    vectors: dict[str, np.ndarray] | None = None
    xyz: np.ndarray | None = None         # the frame's normalized positions (n, 3)


def prepare(c: dict[str, np.ndarray], grid: Grid, frame: str) -> Prepared:
    """`c`: canonical columns of one frame (atlas.columns.canonical)."""
    n_in = len(c["X"])
    mask = row_mask(c, grid, frame)
    kept = {k: np.asarray(v)[mask] for k, v in c.items()}
    qvals = quantity_values(kept)
    depth = geometric_depth(kept, grid)
    theta, phi = normalized_angles(kept)
    cells = spatial_cells(depth, theta, phi, grid)
    return Prepared(
        frame=frame,
        n_in=n_in,
        n_kept=int(mask.sum()),
        cond_bins=condition_bins(condition_values(kept, grid, frame), grid),
        interval=interval_ids(kept, grid),
        hist={q: hist_bins(qvals[q], q, grid) for q in grid.quantity_names},
        cells={frame: cells},
        dropped={"row_filter": int(n_in - mask.sum()), "outside_shell_or_theta": int((cells < 0).sum())},
        d=depth,
        t_ns=np.asarray(kept["Time"]).astype("datetime64[ns]").astype(np.int64),
        values=qvals,
        vectors=normalized_vectors(kept, grid),
        xyz=np.stack([np.asarray(kept[k], dtype=float) for k in ("X", "Y", "Z")], axis=1),
    )
