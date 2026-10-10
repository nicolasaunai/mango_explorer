"""space_mango rows as canonical atlas columns (atlas.columns), chunk by chunk."""
from __future__ import annotations

from collections.abc import Iterator

import numpy as np

from mango_explorer.atlas.columns import FRAME_COLUMNS, canonical

CHUNK_ROWS = 2_000_000


def columns_from_polars(df, names) -> dict[str, np.ndarray]:
    cols = {}
    for name in names:
        s = df[name]
        cols[name] = s.to_numpy() if name != "SC" else np.asarray(s.to_list(), dtype=object)
    return cols


def canonical_columns(df, frame: str) -> dict[str, np.ndarray]:
    """A space_mango result (polars) of `frame` as canonical columns."""
    names = [n for n in FRAME_COLUMNS[frame] if n in df.columns]
    return canonical(columns_from_polars(df, names), frame)


def iter_polars(df, frame: str, chunk_rows: int = CHUNK_ROWS) -> Iterator[dict[str, np.ndarray]]:
    for start in range(0, df.height, chunk_rows):
        yield canonical_columns(df.slice(start, chunk_rows), frame)


def iter_mango_api(frame: str, grid, spacecraft=None, years=None, log=print) -> Iterator[dict[str, np.ndarray]]:
    """Canonical rows of one frame from the MANGO server through space_mango (>= 0.3, frames API),
    one spacecraft-year at a time. The client caches monthly per-column fragments locally (keyed by
    dataset version), so an interrupted build resumes without re-downloading, and the second frame
    downloads only the columns the first did not."""
    import space_mango as sm

    from mango_explorer.atlas.columns import mango_request

    request = mango_request(frame, grid)
    table = sm.spacecraft("magnetosheath")
    rows = table.iter_rows(named=True) if hasattr(table, "iter_rows") else table
    for info in rows:
        sc, start, stop = info["sc"], info["start"], info["stop"]
        if spacecraft and sc not in spacecraft:
            continue
        for year in range(int(str(start)[:4]), int(str(stop)[:4]) + 1):
            if years and year not in years:
                continue
            df = sm.get_data("magnetosheath", spacecraft=sc, start=f"{year}-01-01", stop=f"{year + 1}-01-01",
                             **request).to_polars()
            log(f"  {frame} {sc} {year}: {df.height:,} rows")
            if df.height:
                yield from iter_polars(df, frame)
