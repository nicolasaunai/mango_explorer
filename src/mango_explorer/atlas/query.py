"""Per-cell statistics straight from MANGO rows: the Python twin of what the web explorer shows.

    import space_mango as sm
    from mango_explorer.atlas import COLUMNS, cell_statistics
    result = sm.get_data("magnetosheath", columns=list(COLUMNS), sw_paired_only=True,
                         normalized_only=True, ma_sw_min=6, ma_sw_max=12)
    cells = cell_statistics(result, frame="PGSM_fold", quantity="Np_ratio",
                            selection={"cone_deg": [2, 3], "Ma_sw": [2, 3]})

`df` is a space_mango MangoResult (>= 0.2) or a polars DataFrame. `selection` lists grid bins
per conditioning variable (see grid-v2.json), exactly as the explorer's URL does. The `median`, `q25`, `q75` columns come from the same fixed-edge histograms
as the explorer; `median_exact` is the plain median of the samples in the cell.
"""
from __future__ import annotations

import numpy as np

from mango_explorer.atlas.grid import Grid, load_grid
from mango_explorer.atlas.prepare import prepare
from mango_explorer.atlas.quantities import quantity_values, row_mask
from mango_explorer.atlas.reference import reference_query
from mango_explorer.atlas.sources import columns_from_polars
from mango_explorer.atlas.stats import hist_quantile


def cell_statistics(df, frame: str, quantity: str, selection: dict | None = None,
                    grid: Grid | None = None):
    """One row per non-empty cell: bin ranges, N, exact N_eff, quartiles, reliability."""
    import polars as pl

    g = grid or load_grid()
    selection = selection or {}
    if hasattr(df, "to_polars"):  # space_mango >= 0.2 returns a MangoResult
        df = df.to_polars()
    cols = columns_from_polars(df)
    prep = prepare(cols, g, [frame])
    ref = reference_query(prep, g, frame, selection, quantity)
    cells = np.flatnonzero(ref["n"])
    edges = g.hist_axis_edges(quantity)
    back = (lambda a: 10.0 ** a) if g.is_log(quantity) else (lambda a: a)
    q = {p: back(hist_quantile(ref["hist"][cells], edges, p)) for p in (0.25, 0.5, 0.75)}

    # exact medians from the raw values of the selected rows
    keep = prep.cells[frame] >= 0
    for name, bins in selection.items():
        if bins is not None:
            keep &= np.isin(prep.cond_bins[name], list(bins))
    raw = quantity_values({k: np.asarray(v)[row_mask(cols)] for k, v in cols.items()})[quantity]
    ok = keep & np.isfinite(raw) & (prep.hist[quantity] >= 0)
    exact = (pl.DataFrame({"cell": prep.cells[frame][ok], "v": raw[ok]})
             .group_by("cell").agg(pl.col("v").median().alias("median_exact")))

    _, nt, nphi = g.spatial_shape
    i, j, k = cells // (nt * nphi), (cells // nphi) % nt, cells % nphi
    rel = g.raw["reliability"]
    out = pl.DataFrame({
        "cell": cells,
        "D_lo": g.d_edges[i], "D_hi": g.d_edges[i + 1],
        "theta_lo": g.theta_edges[j], "theta_hi": g.theta_edges[j + 1],
        "phi_lo": g.phi_edges[k], "phi_hi": g.phi_edges[k + 1],
        "n": ref["n"][cells], "neff": ref["neff"][cells],
        "q25": q[0.25], "median": q[0.5], "q75": q[0.75],
    })
    return (out.join(exact, on="cell", how="left")
            .with_columns(reliable=(pl.col("neff") >= rel["min_neff"]) & (pl.col("n") >= rel["min_n"])))
