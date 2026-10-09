"""Per-chunk preparation: every row becomes bin indices, once, shared by all cubes."""
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
    n_in: int
    n_kept: int
    cond_bins: dict[str, np.ndarray]
    interval: np.ndarray
    hist: dict[str, np.ndarray]
    cells: dict[str, np.ndarray]
    dropped: dict[str, int] = field(default_factory=dict)
    # per-sample geometry and values, for the k-NN sample table
    d: np.ndarray | None = None
    theta: np.ndarray | None = None
    phi_gsm: np.ndarray | None = None
    clock_deg: np.ndarray | None = None
    bx_neg: np.ndarray | None = None
    t_ns: np.ndarray | None = None
    values: dict[str, np.ndarray] | None = None
    vectors: dict[str, np.ndarray] | None = None
    xyz: np.ndarray | None = None  # normalized GSM positions (n, 3)


def prepare(cols: dict[str, np.ndarray], grid: Grid, frames=None) -> Prepared:
    frames = tuple(frames or grid.frames)
    n_in = len(cols["R_norm"])
    mask = row_mask(cols)
    kept = {k: np.asarray(v)[mask] for k, v in cols.items()}
    cvals = condition_values(kept)
    conds = condition_bins(cvals, grid)
    qvals = quantity_values(kept)
    depth = geometric_depth(kept, grid)
    cells = {}
    for frame in frames:
        theta, phi = normalized_angles(kept, frame)
        cells[frame] = spatial_cells(depth, theta, phi, grid)
    any_frame = next(iter(cells.values()))
    theta_gsm, phi_gsm = normalized_angles(kept, "GSM")
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
        d=depth,
        xyz=np.stack([np.asarray(kept[c], dtype=float) for c in ("X_gsm_norm", "Y_gsm_norm", "Z_gsm_norm")], 1),
        theta=theta_gsm,
        phi_gsm=phi_gsm,
        clock_deg=cvals["clock_deg"],
        bx_neg=np.asarray(kept["Bx_imf"], dtype=float) < 0,
        t_ns=np.asarray(kept["Time"]).astype("datetime64[ns]").astype(np.int64),
        values=qvals,
        vectors=normalized_vectors(kept, grid),
    )
