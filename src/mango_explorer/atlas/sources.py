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
    return canonical(columns_from_polars(df, FRAME_COLUMNS[frame]), frame)


def iter_polars(df, frame: str, chunk_rows: int = CHUNK_ROWS) -> Iterator[dict[str, np.ndarray]]:
    for start in range(0, df.height, chunk_rows):
        yield canonical_columns(df.slice(start, chunk_rows), frame)
