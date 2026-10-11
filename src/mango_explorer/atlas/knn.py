"""k-nearest-neighbour statistics: the reference the web explorer's k-NN mode must match.

Samples sit at the frame's MANGO normalized positions. Distances are Euclidean in R_E in that
space; time plays no role.

A node gets the statistics of its k nearest samples, or NaN when the distance of the
ceil(k/2)-th nearest exceeds the cap ("the median neighbour distance exceeds the cap").
Only neighbours within search_factor * cap are searched, which leaves that test exact.
"""
from __future__ import annotations

import numpy as np

from mango_explorer.atlas.binning import flat_condition_index
from mango_explorer.atlas.grid import Grid
from mango_explorer.atlas.prepare import Prepared


def sample_keep(interval, t_ns, fraction: float) -> np.ndarray:
    """Deterministic pseudo-random selection of a fraction of samples (independent of chunking)."""
    if fraction >= 1:
        return np.ones(len(t_ns), dtype=bool)
    h = (np.asarray(t_ns, dtype=np.uint64) // np.uint64(1_000_000_000)) * np.uint64(2654435761)
    h ^= (np.asarray(interval, dtype=np.uint64) >> np.uint64(40)) * np.uint64(40503)
    h = (h * np.uint64(0x9E3779B97F4A7C15)) >> np.uint64(40)
    return (h.astype(np.float64) / float(1 << 24)) < fraction


def knn_stats(nodes, positions, values, intervals, k: int, cap: float, search_factor: float = 2.0):
    """Quartiles of the k nearest finite values, neighbour count, N_eff and median distance.

    Returns a dict of arrays with one entry per node; quartiles are NaN where the median
    neighbour distance exceeds `cap` (or fewer than ceil(k/2) neighbours were found).
    """
    from scipy.spatial import cKDTree

    nodes = np.atleast_2d(np.asarray(nodes, dtype=float))
    ok = np.isfinite(values)
    pos, val, iv = positions[ok], np.asarray(values, dtype=float)[ok], np.asarray(intervals)[ok]
    n_nodes = len(nodes)
    out = {name: np.full(n_nodes, np.nan) for name in ("q25", "median", "q75", "dist_median")}
    out["n"] = np.zeros(n_nodes, dtype=np.int64)
    out["neff"] = np.zeros(n_nodes, dtype=np.int64)
    if not len(pos):
        return out
    kk = min(k, len(pos))
    dist, idx = cKDTree(pos).query(nodes, k=kk, distance_upper_bound=search_factor * cap)
    dist, idx = dist.reshape(n_nodes, kk), idx.reshape(n_nodes, kk)
    half = (k + 1) // 2
    for i in range(n_nodes):
        found = np.isfinite(dist[i])
        out["n"][i] = int(found.sum())
        if out["n"][i] < half:
            continue
        d_med = dist[i][half - 1]
        out["dist_median"][i] = d_med
        neigh = idx[i][found]
        out["neff"][i] = len(np.unique(iv[neigh]))
        if d_med > cap:
            continue
        out["q25"][i], out["median"][i], out["q75"][i] = np.quantile(val[neigh], [0.25, 0.5, 0.75])
    return out


class SampleAccumulator:
    """Collects the per-sample table (a deterministic random fraction) that the web k-NN mode searches."""

    def __init__(self, grid: Grid, frame: str, fraction: float | None = None):
        self.grid, self.frame = grid, frame
        self.cube_id = grid.cube_of_frame(frame)
        self.fraction = grid.raw["knn"]["sample_fraction"] if fraction is None else fraction
        self.dims, self.shape = grid.cube_dims(self.cube_id), grid.cube_shape(self.cube_id)
        self._parts: list[dict[str, np.ndarray]] = []

    def add(self, prep: Prepared) -> None:
        cond = flat_condition_index(prep.cond_bins, self.dims, self.shape)
        keep = (cond >= 0) & (prep.cells[self.frame] >= 0)
        keep &= sample_keep(prep.interval, prep.t_ns, self.fraction)
        part = {
            "cond": cond, "x": prep.xyz[:, 0], "y": prep.xyz[:, 1], "z": prep.xyz[:, 2],
            "interval": prep.interval,
            **{f"q:{q}": v for q, v in prep.values.items()},
        }
        self._parts.append({k: np.asarray(v)[keep] for k, v in part.items()})

    def finalize(self) -> dict[str, np.ndarray]:
        cols = {k: np.concatenate([p[k] for p in self._parts]) for k in self._parts[0]}
        order = np.argsort(cols["cond"], kind="stable")
        cols = {k: v[order] for k, v in cols.items()}
        n_cond = int(np.prod(self.shape))
        sc = (cols["interval"] >> 40).astype(np.int64)
        hour = cols["interval"] & ((1 << 40) - 1)
        table = {
            "cond_offsets": np.searchsorted(cols["cond"], np.arange(n_cond + 1)).astype(np.uint32),
            "x": cols["x"].astype(np.float32), "y": cols["y"].astype(np.float32), "z": cols["z"].astype(np.float32),
            "interval": ((sc << 24) | hour).astype(np.uint32),
        }
        for k, v in cols.items():
            if k.startswith("q:"):
                q = k[2:]
                with np.errstate(invalid="ignore", divide="ignore"):
                    axis = np.log10(np.where(v > 0, v, np.nan)) if self.grid.is_log(q) else v
                table[k] = axis.astype(np.float32)
        return table
