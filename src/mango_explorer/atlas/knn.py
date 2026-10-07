"""k-nearest-neighbour statistics: the reference the web explorer's k-NN mode must match.

Samples are placed in the *displayed* magnetosheath of a frame: a sample at (D_msh, theta, phi)
sits at r = R_mp(theta) + D (R_bs(theta) - R_mp(theta)) between the boundaries the explorer
draws (grid spec "display_boundaries"). Distances are Euclidean in R_E in that space.

A node gets the statistics of its k nearest samples, or NaN when the distance of the
ceil(k/2)-th nearest exceeds the cap ("the median neighbour distance exceeds the cap").
Only neighbours within search_factor * cap are searched, which leaves that test exact.
"""
from __future__ import annotations

import numpy as np

from mango_explorer.atlas.binning import flat_condition_index
from mango_explorer.atlas.grid import Grid
from mango_explorer.atlas.prepare import Prepared
from mango_explorer.boundaries import jelinek_bs, shue_alpha, shue_mp, shue_r0


def display_radii(grid: Grid):
    """(R_mp(theta), R_bs(theta)) of the boundaries the explorer draws; theta in radians."""
    b = grid.raw["display_boundaries"]
    pd, bz = b["pd_nPa"], b["bz_nT"]
    r0, alpha = shue_r0(bz, pd), shue_alpha(bz, pd)
    return (lambda t: shue_mp(t, r0, alpha)), (lambda t: jelinek_bs(t, pd))


def frame_phi_deg(frame: str, phi_gsm, clock_deg, bx_neg):
    """Azimuth of a sample in `frame` from its GSM azimuth and its IMF clock angle / Bx sign."""
    phi = np.asarray(phi_gsm, dtype=float)
    if frame == "GSM":
        return phi % 360.0
    shift = np.asarray(clock_deg, dtype=float)
    if frame == "PGSM_fold":
        shift = shift + 180.0 * np.asarray(bx_neg, dtype=bool)
    return (phi + shift) % 360.0


def display_positions(d, theta_deg, phi_deg, grid: Grid) -> np.ndarray:
    """(n, 3) positions (X, Y, Z) in R_E between the displayed boundaries."""
    r_mp, r_bs = display_radii(grid)
    t = np.radians(np.asarray(theta_deg, dtype=float))
    p = np.radians(np.asarray(phi_deg, dtype=float))
    rm = r_mp(t)
    r = rm + np.asarray(d, dtype=float) * (r_bs(t) - rm)
    return np.stack([r * np.cos(t), r * np.sin(t) * np.cos(p), r * np.sin(t) * np.sin(p)], axis=1)


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
    """Collects the per-sample table (decimated in time) that the web k-NN mode searches."""

    def __init__(self, grid: Grid, cube_id: str, window_s: float | None = None):
        self.grid, self.cube_id = grid, cube_id
        self.window_ns = int(1e9 * (grid.raw["knn"]["sample_window_s"] if window_s is None else window_s))
        self.dims, self.shape = grid.cube_dims(cube_id), grid.cube_shape(cube_id)
        self._parts: list[dict[str, np.ndarray]] = []

    def add(self, prep: Prepared) -> None:
        cond = flat_condition_index(prep.cond_bins, self.dims, self.shape)
        keep = (cond >= 0) & (next(iter(prep.cells.values())) >= 0)
        sc = prep.interval >> 40
        win = prep.t_ns // self.window_ns if self.window_ns > 0 else np.arange(len(prep.t_ns))
        part = {
            "cond": cond, "sc": sc, "win": win, "d": prep.d, "theta": prep.theta,
            "phi_gsm": prep.phi_gsm, "clock_deg": prep.clock_deg, "bx_neg": prep.bx_neg,
            "interval": prep.interval, **{f"q:{q}": v for q, v in prep.values.items()},
        }
        self._parts.append({k: np.asarray(v)[keep] for k, v in part.items()})

    def finalize(self) -> dict[str, np.ndarray]:
        cols = {k: np.concatenate([p[k] for p in self._parts]) for k in self._parts[0]}
        # first sample of each (spacecraft, window), then grouped by condition bin
        order = np.lexsort((cols["win"], cols["sc"]))
        cols = {k: v[order] for k, v in cols.items()}
        if self.window_ns > 0:
            key = np.stack([cols["sc"], cols["win"]], axis=1)
            _, first = np.unique(key, axis=0, return_index=True)
            cols = {k: v[np.sort(first)] for k, v in cols.items()}
        order = np.argsort(cols["cond"], kind="stable")
        cols = {k: v[order] for k, v in cols.items()}
        n_cond = int(np.prod(self.shape))
        offsets = np.searchsorted(cols["cond"], np.arange(n_cond + 1)).astype(np.uint32)
        sc = (cols["interval"] >> 40).astype(np.int64)
        hour = cols["interval"] & ((1 << 40) - 1)
        table = {
            "cond_offsets": offsets,
            "d": cols["d"].astype(np.float32),
            "theta": cols["theta"].astype(np.float32),
            "phi_gsm": cols["phi_gsm"].astype(np.float32),
            "clock_deg": cols["clock_deg"].astype(np.float32),
            "interval": ((sc << 24) | hour).astype(np.uint32),
            "bx_neg": cols["bx_neg"].astype(np.uint8),
        }
        for k, v in cols.items():
            if k.startswith("q:"):
                q = k[2:]
                axis = np.log10(np.where(v > 0, v, np.nan)) if self.grid.is_log(q) else v
                table[k] = axis.astype(np.float32)
        return table
