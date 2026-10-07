"""Condition cubes: per (condition bin, spatial cell) histograms, stored sparse.

A key packs (flat condition index, cell, histogram bin) into one int64:
    key = (cond * n_cells + cell) * n_hist + hbin
Summing histograms over any set of condition bins is exact, so medians and quantiles of any
selection come out right; N_eff summed the same way is an upper bound (an interval can fall in
several condition bins).
"""
from __future__ import annotations

import itertools
from dataclasses import dataclass

import numpy as np

from mango_explorer.atlas.binning import flat_condition_index
from mango_explorer.atlas.grid import Grid
from mango_explorer.atlas.prepare import Prepared


def _merge(keys_parts, count_parts) -> tuple[np.ndarray, np.ndarray]:
    if not keys_parts:
        return np.zeros(0, np.int64), np.zeros(0, np.int64)
    keys = np.concatenate(keys_parts)
    counts = np.concatenate(count_parts)
    u, inv = np.unique(keys, return_inverse=True)
    return u, np.bincount(inv, weights=counts, minlength=len(u)).astype(np.int64)


@dataclass
class CubeData:
    grid: Grid
    cube_id: str
    frame: str
    hist: dict[str, tuple[np.ndarray, np.ndarray]]   # quantity -> (sorted keys, counts)
    samples: tuple[np.ndarray, np.ndarray]            # (cond*n_cells+cell, n)
    neff: tuple[np.ndarray, np.ndarray]               # (cond*n_cells+cell, distinct intervals)
    by_sc: tuple[np.ndarray, np.ndarray]              # ((cond*n_cells+cell)*n_sc+sc, n)

    @property
    def dims(self) -> tuple[str, ...]:
        return self.grid.cube_dims(self.cube_id)

    @property
    def shape(self) -> tuple[int, ...]:
        return self.grid.cube_shape(self.cube_id)

    @property
    def n_conditions(self) -> int:
        return int(np.prod(self.shape))

    def selected_conditions(self, selection: dict[str, list[int] | None]) -> np.ndarray:
        """Flat condition indices for a per-dimension list of bins (None or missing = all)."""
        axes = []
        for name, n in zip(self.dims, self.shape):
            bins = selection.get(name)
            axes.append(range(n) if bins is None else sorted(set(bins)))
        flat = [np.ravel_multi_index(c, self.shape) for c in itertools.product(*axes)]
        return np.asarray(flat, dtype=np.int64)

    def query(self, selection: dict[str, list[int] | None]) -> dict:
        """Dense per-cell results of summing the selected condition bins."""
        g = self.grid
        nc, nb = g.n_cells, g.n_hist
        conds = self.selected_conditions(selection)
        out = {"hist": {}}
        for q, (keys, counts) in self.hist.items():
            ok = np.isin(keys // (nc * nb), conds)
            dense = np.zeros(nc * nb, dtype=np.int64)
            np.add.at(dense, keys[ok] % (nc * nb), counts[ok])
            out["hist"][q] = dense.reshape(nc, nb)
        n_sc = len(g.spacecraft)
        keys, values = self.by_sc
        ok = np.isin(keys // (nc * n_sc), conds)
        dense = np.zeros(nc * n_sc, dtype=np.int64)
        np.add.at(dense, keys[ok] % (nc * n_sc), values[ok])
        out["n_by_sc"] = dense.reshape(nc, n_sc)
        for name, (keys, values) in (("n", self.samples), ("neff_upper", self.neff)):
            ok = np.isin(keys // nc, conds)
            dense = np.zeros(nc, dtype=np.int64)
            np.add.at(dense, keys[ok] % nc, values[ok])
            out[name] = dense
        return out


class CubeAccumulator:
    """Streams Prepared chunks into one cube for one frame."""

    def __init__(self, grid: Grid, cube_id: str, frame: str):
        self.grid, self.cube_id, self.frame = grid, cube_id, frame
        self.dims = grid.cube_dims(cube_id)
        self.shape = grid.cube_shape(cube_id)
        self._hist = {q: ([], []) for q in grid.quantity_names}
        self._samples = ([], [])
        self._by_sc = ([], [])
        self._pairs: list[np.ndarray] = []

    _COMPACT_EVERY = 8

    def _compact(self) -> None:
        """Merge accumulated per-chunk parts so memory stays bounded on long builds."""
        for q, parts in self._hist.items():
            k, c = _merge(*parts)
            self._hist[q] = ([k], [c])
        k, c = _merge(*self._samples)
        self._samples = ([k], [c])
        k, c = _merge(*self._by_sc)
        self._by_sc = ([k], [c])
        pairs = np.concatenate(self._pairs)
        self._pairs = [np.unique(pairs, axis=0) if len(pairs) else pairs]

    def add(self, prep: Prepared) -> None:
        if len(self._pairs) >= self._COMPACT_EVERY:
            self._compact()
        nc, nb = self.grid.n_cells, self.grid.n_hist
        cond = flat_condition_index(prep.cond_bins, self.dims, self.shape)
        cell = prep.cells[self.frame]
        ok = (cond >= 0) & (cell >= 0)
        cc = cond * nc + cell
        u, c = np.unique(cc[ok], return_counts=True)
        self._samples[0].append(u)
        self._samples[1].append(c)
        n_sc = len(self.grid.spacecraft)
        u, c = np.unique(cc[ok] * n_sc + (prep.interval[ok] >> 40), return_counts=True)
        self._by_sc[0].append(u)
        self._by_sc[1].append(c)
        pairs = np.stack([cc[ok], prep.interval[ok]], axis=1)
        self._pairs.append(np.unique(pairs, axis=0) if len(pairs) else pairs)
        for q, hb in prep.hist.items():
            okq = ok & (hb >= 0)
            u, c = np.unique(cc[okq] * nb + hb[okq], return_counts=True)
            self._hist[q][0].append(u)
            self._hist[q][1].append(c)

    def finalize(self) -> CubeData:
        pairs = np.concatenate(self._pairs) if self._pairs else np.zeros((0, 2), np.int64)
        pairs = np.unique(pairs, axis=0) if len(pairs) else pairs
        neff_keys, neff = np.unique(pairs[:, 0], return_counts=True)
        return CubeData(
            grid=self.grid,
            cube_id=self.cube_id,
            frame=self.frame,
            hist={q: _merge(*parts) for q, parts in self._hist.items()},
            samples=_merge(*self._samples),
            by_sc=_merge(*self._by_sc),
            neff=(neff_keys.astype(np.int64), neff.astype(np.int64)),
        )
