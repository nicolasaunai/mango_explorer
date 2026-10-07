"""Readers that yield MANGO magnetosheath rows as dicts of numpy columns, chunk by chunk."""
from __future__ import annotations

from collections.abc import Iterator
from pathlib import Path

import numpy as np

from mango_explorer.atlas.quantities import COLUMNS

CHUNK_ROWS = 2_000_000


def columns_from_polars(df) -> dict[str, np.ndarray]:
    cols = {}
    for name in COLUMNS:
        s = df[name]
        cols[name] = s.to_numpy() if name != "SC" else np.asarray(s.to_list(), dtype=object)
    return cols


def iter_polars(df, chunk_rows: int = CHUNK_ROWS) -> Iterator[dict[str, np.ndarray]]:
    for start in range(0, df.height, chunk_rows):
        yield columns_from_polars(df.slice(start, chunk_rows))


def iter_arrow_files(paths, chunk_rows: int = CHUNK_ROWS) -> Iterator[dict[str, np.ndarray]]:
    """Arrow IPC files as returned by the MANGO server (`format=arrow`)."""
    import polars as pl

    for p in paths:
        yield from iter_polars(pl.read_ipc(p, columns=list(COLUMNS)), chunk_rows)


def iter_mango_api(spacecraft=None, years=None, log=print) -> Iterator[dict[str, np.ndarray]]:
    """Rows from the MANGO server through space_mango (>= 0.2), one spacecraft-year at a time.

    The client caches monthly per-column fragments locally (keyed by dataset version), so an
    interrupted build resumes without re-downloading. Only the columns the atlas uses are fetched.
    """
    import space_mango as sm

    table = sm.spacecraft("magnetosheath")
    rows = table.iter_rows(named=True) if hasattr(table, "iter_rows") else table
    for info in rows:
        sc, start, stop = info["sc"], info["start"], info["stop"]
        if spacecraft and sc not in spacecraft:
            continue
        for year in range(int(str(start)[:4]), int(str(stop)[:4]) + 1):
            if years and year not in years:
                continue
            df = sm.get_data("magnetosheath", columns=list(COLUMNS), spacecraft=sc,
                             start=f"{year}-01-01", stop=f"{year + 1}-01-01",
                             sw_paired_only=True, normalized_only=True).to_polars()
            log(f"  {sc} {year}: {df.height:,} rows")
            if df.height:
                yield from iter_polars(df)


def iter_hive_parquet(region_dir, chunk_rows: int = CHUNK_ROWS) -> Iterator[dict[str, np.ndarray]]:
    """The server's on-disk layout: <region>/SC=<name>/part-*.parquet, streamed by row batches."""
    import polars as pl
    import pyarrow.parquet as pq

    wanted = [c for c in COLUMNS if c != "SC"]
    for path in sorted(Path(region_dir).glob("SC=*/*.parquet")):
        sc = path.parent.name.split("=", 1)[1]
        for batch in pq.ParquetFile(path).iter_batches(batch_size=chunk_rows, columns=wanted):
            df = pl.from_arrow(batch).with_columns(pl.lit(sc).alias("SC"))
            yield columns_from_polars(df)
