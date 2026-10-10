"""Build an atlas from per-frame streams of canonical column chunks."""
from __future__ import annotations

import time
from collections import Counter
from pathlib import Path

import numpy as np

from mango_explorer.atlas.cube import CubeAccumulator
from mango_explorer.atlas.grid import Grid
from mango_explorer.atlas.hours import HourAccumulator
from mango_explorer.atlas.knn import SampleAccumulator
from mango_explorer.atlas.prepare import prepare
from mango_explorer.atlas.store import write_atlas
from mango_explorer.atlas.voxels import VoxelAccumulator


def build_atlas(streams, grid: Grid, out_dir: Path, *, source: dict | None = None,
                sample_fraction: float | None = None, log=print) -> dict:
    """`streams`: {frame: iterable of canonical column chunks}; frames are built one after the other."""
    fraction = grid.raw["knn"]["sample_fraction"] if sample_fraction is None else sample_fraction
    parts, stats = [], {}
    t0 = time.perf_counter()
    for frame, chunks in streams.items():
        cube = CubeAccumulator(grid, grid.cube_of_frame(frame))
        hours, samples, voxels = HourAccumulator(grid, frame), SampleAccumulator(grid, frame, fraction), \
            VoxelAccumulator(grid, frame)
        s = Counter()
        for c in chunks:
            prep = prepare(c, grid, frame)
            s["rows_in"] += prep.n_in
            s["rows_kept"] += prep.n_kept
            s.update({f"dropped_{k}": v for k, v in prep.dropped.items()})
            # rows whose mapped V and B are both finite (they need R_mp and R_bs): the flow/field line sums
            s["rows_with_vectors"] += 0 if prep.vectors is None else int(
                np.all([np.isfinite(v).all(axis=1) for v in prep.vectors.values()], axis=0).sum())
            for acc in (cube, hours, samples, voxels):
                acc.add(prep)
            log(f"  {frame} {s['rows_in']:>12,} rows  {time.perf_counter() - t0:7.1f} s")
        if s["rows_with_vectors"] < 0.9 * s["rows_kept"]:
            log(f"  WARNING {frame}: only {s['rows_with_vectors']:,} of {s['rows_kept']:,} kept rows have finite "
                "V and B mapped to normalized space (rows_with_vectors < 90 %): check R_mp / R_bs")
        stats[frame] = dict(s)
        parts.append({"frame": frame, "cube": cube.finalize(), "hours": hours.finalize(),
                      "samples": samples.finalize(), "voxels": voxels.finalize()})
    return write_atlas(out_dir, grid, parts, {"source": source or {}, "stats": stats,
                                              "build_seconds": round(time.perf_counter() - t0, 2)}, fraction)
