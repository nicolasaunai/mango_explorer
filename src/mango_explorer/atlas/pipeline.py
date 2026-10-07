"""Build an atlas from a stream of row chunks."""
from __future__ import annotations

import time
from collections import Counter
from pathlib import Path

from mango_explorer.atlas.cube import CubeAccumulator
from mango_explorer.atlas.grid import Grid
from mango_explorer.atlas.hours import HourAccumulator
from mango_explorer.atlas.prepare import prepare
from mango_explorer.atlas.store import write_atlas


def build_atlas(chunks, grid: Grid, out_dir: Path, *, frames=None, cube_ids=None,
                source: dict | None = None, log=print) -> dict:
    frames = tuple(frames or grid.frames)
    cube_ids = tuple(cube_ids or [c["id"] for c in grid.raw["cubes"]])
    accs = [CubeAccumulator(grid, cid, f) for cid in cube_ids for f in frames]
    hours = HourAccumulator(grid)
    stats = Counter()
    t0 = time.perf_counter()
    for cols in chunks:
        prep = prepare(cols, grid, frames)
        stats["rows_in"] += prep.n_in
        stats["rows_kept"] += prep.n_kept
        stats.update({f"dropped_{k}": v for k, v in prep.dropped.items()})
        for acc in accs:
            acc.add(prep)
        hours.add(prep)
        log(f"  {stats['rows_in']:>12,} rows  {time.perf_counter() - t0:7.1f} s")
    cubes = [a.finalize() for a in accs]
    manifest = write_atlas(out_dir, grid, cubes, hours.finalize(), {
        "source": source or {}, "stats": dict(stats),
        "build_seconds": round(time.perf_counter() - t0, 2),
    })
    return manifest
