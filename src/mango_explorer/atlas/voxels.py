"""Voxel sums for full-data k-NN means (sklearn KNeighborsRegressor style), see grid spec "voxels".

The browser cannot hold all samples, but it can hold, for every (frame, condition bin, voxel),
the number of samples and the sum of each quantity. Sums over any clock/cone/M_A selection are
exact, and the k nearest samples of a point are approximated by the samples of its nearest
voxels (0.25 R_E): against an exact 1/d-weighted k-NN on dataset 2026.0 (k = 7000) the error is
below 1.3 % for 95 % of points.
"""
from __future__ import annotations

import numpy as np

from mango_explorer.atlas.binning import flat_condition_index
from mango_explorer.atlas.grid import Grid
from mango_explorer.atlas.knn import frame_positions
from mango_explorer.atlas.prepare import Prepared
from mango_explorer.atlas.vectors import COMPONENTS, VECTORS, in_frame


def voxel_ids(xyz, grid: Grid) -> np.ndarray:
    s, off = grid.raw["voxels"]["size_re"], grid.raw["voxels"]["index_offset"]
    ijk = np.floor(np.asarray(xyz, dtype=float) / s).astype(np.int64) + off
    ok = np.all((ijk >= 0) & (ijk < 1024), axis=1)
    vid = (ijk[:, 0] << 20) | (ijk[:, 1] << 10) | ijk[:, 2]
    return np.where(ok, vid, -1)


def voxel_centers(vid, grid: Grid) -> np.ndarray:
    s, off = grid.raw["voxels"]["size_re"], grid.raw["voxels"]["index_offset"]
    vid = np.asarray(vid, dtype=np.int64)
    ijk = np.stack([(vid >> 20) & 1023, (vid >> 10) & 1023, vid & 1023], axis=1) - off
    return (ijk + 0.5) * s


class VoxelAccumulator:
    """Counts and sums per (condition bin, voxel) for one frame and every quantity."""

    def __init__(self, grid: Grid, cube_id: str, frame: str):
        self.grid, self.frame = grid, frame
        self.dims, self.shape = grid.cube_dims(cube_id), grid.cube_shape(cube_id)
        self._parts: dict[str, list[tuple[np.ndarray, np.ndarray, np.ndarray]]] = {
            q: [] for q in [*grid.quantity_names, *COMPONENTS]}

    def add(self, prep: Prepared) -> None:
        cond = flat_condition_index(prep.cond_bins, self.dims, self.shape)
        vid = voxel_ids(frame_positions(self.frame, prep.xyz, prep.clock_deg, prep.bx_neg), self.grid)
        ok = (cond >= 0) & (vid >= 0) & (next(iter(prep.cells.values())) >= 0)
        key = (cond << 32) + vid
        for q, v in prep.values.items():
            m = ok & np.isfinite(v)
            u, inv = np.unique(key[m], return_inverse=True)
            self._push(q, u, np.bincount(inv, minlength=len(u)), np.bincount(inv, weights=v[m], minlength=len(u)))
        if prep.vectors is None:
            return
        for name, (_, magnetic) in VECTORS.items():
            vec = in_frame(self.frame, prep.vectors[name], prep.clock_deg, prep.bx_neg, magnetic)
            m = ok & np.all(np.isfinite(vec), axis=1)
            u, inv = np.unique(key[m], return_inverse=True)
            n = np.bincount(inv, minlength=len(u))
            for i, c in enumerate("xyz"):
                self._push(f"{name}_{c}", u, n, np.bincount(inv, weights=vec[m, i], minlength=len(u)))

    def _push(self, q, u, n, s) -> None:
        self._parts[q].append((u, n, s))
        if len(self._parts[q]) >= 8:
            self._parts[q] = [self._merge(self._parts[q])]

    @staticmethod
    def _merge(parts):
        keys = np.concatenate([p[0] for p in parts])
        u, inv = np.unique(keys, return_inverse=True)
        n = np.bincount(inv, weights=np.concatenate([p[1] for p in parts]), minlength=len(u))
        s = np.bincount(inv, weights=np.concatenate([p[2] for p in parts]), minlength=len(u))
        return u, n.astype(np.int64), s

    def finalize(self) -> dict:
        merged = {q: self._merge(p) if p else (np.zeros(0, np.int64),) * 3 for q, p in self._parts.items()}
        keys = np.unique(np.concatenate([m[0] for m in merged.values()]))   # sorted by cond, then voxel
        n_cond = int(np.prod(self.shape))
        table = {"cond_offsets": np.searchsorted(keys >> 32, np.arange(n_cond + 1)).astype(np.uint32),
                 "voxel": (keys & 0xFFFFFFFF).astype(np.uint32)}
        quantities = {}
        for q, (u, n, s) in merged.items():
            at = np.searchsorted(keys, u)
            nn = np.zeros(len(keys), np.int64)
            ss = np.zeros(len(keys), np.float64)
            nn[at], ss[at] = n, s
            ndt = np.uint16 if (len(nn) == 0 or nn.max() < 65535) else np.uint32
            quantities[q] = {"n": nn.astype(ndt), "sum": ss.astype(np.float32)}
        return {"frame": self.frame, "base": table, "quantities": quantities}


def select_voxels(table: dict, qarrays: dict, conds) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    """Sum the selected condition bins: unique voxel ids with their counts and sums."""
    off = table["cond_offsets"].astype(np.int64)
    rows = np.concatenate([np.arange(off[c], off[c + 1]) for c in conds]) if len(conds) else np.zeros(0, np.int64)
    vid = table["voxel"][rows].astype(np.int64)
    u, inv = np.unique(vid, return_inverse=True)
    n = np.bincount(inv, weights=qarrays["n"][rows].astype(float), minlength=len(u))
    s = np.bincount(inv, weights=qarrays["sum"][rows].astype(float), minlength=len(u))
    keep = n > 0
    return u[keep], n[keep], s[keep]


def voxel_knn(nodes, vid, n, s, grid: Grid, k: int, cap: float, factor: float = 2.0, weighted: bool = True):
    """k-NN mean over voxels (grid spec "voxels.knn"); returns value, used count and median distance."""
    from scipy.spatial import cKDTree

    size = grid.raw["voxels"]["size_re"]
    nodes = np.atleast_2d(np.asarray(nodes, dtype=float))
    out = {"value": np.full(len(nodes), np.nan), "n": np.zeros(len(nodes), np.int64),
           "dist_median": np.full(len(nodes), np.nan), "n_voxels": np.zeros(len(nodes), np.int64)}
    if not len(vid):
        return out
    centers = voxel_centers(vid, grid)
    tree = cKDTree(centers)
    half = (k + 1) // 2
    for i, p in enumerate(nodes):
        idx = np.asarray(tree.query_ball_point(p, factor * cap), dtype=np.int64)
        if not len(idx):
            continue
        d = np.linalg.norm(centers[idx] - p, axis=1)
        order = np.lexsort((vid[idx], d))
        idx, d = idx[order], d[order]
        cum = np.cumsum(n[idx])
        if cum[-1] < half:
            continue
        out["dist_median"][i] = d[np.searchsorted(cum, half)]
        m = int(np.searchsorted(cum, k)) + 1 if cum[-1] >= k else len(idx)
        idx, d, cum = idx[:m], d[:m], cum[:m]
        used = n[idx].astype(float)
        if cum[-1] > k:
            used[-1] -= cum[-1] - k
        frac = used / n[idx]
        w = 1.0 / np.maximum(d, size / 2) if weighted else np.ones_like(d)
        out["n"][i], out["n_voxels"][i] = int(used.sum()), m
        if out["dist_median"][i] > cap:
            continue
        out["value"][i] = (w * frac * s[idx]).sum() / (w * used).sum()
    return out
