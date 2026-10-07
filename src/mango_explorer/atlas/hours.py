"""The hour table: one row per (spacecraft, N_eff interval, combination of condition bins).

It is small (one row per interval and condition combination actually observed) and lets the web
app give exact sample counts and exact N_eff for any condition selection, including the live
availability histograms next to every control.
"""
from __future__ import annotations

import numpy as np

from mango_explorer.atlas.grid import Grid
from mango_explorer.atlas.prepare import Prepared

MISSING = 255


class HourAccumulator:
    def __init__(self, grid: Grid):
        self.grid = grid
        self.names = grid.condition_names
        self._keys: list[np.ndarray] = []
        self._counts: list[np.ndarray] = []

    def _pack(self, prep: Prepared, ok: np.ndarray) -> np.ndarray:
        packed = np.zeros(int(ok.sum()), dtype=np.int64)
        for name in self.names:
            b = prep.cond_bins[name][ok]
            packed = (packed << 8) | np.where(b < 0, MISSING, b)
        return packed

    def add(self, prep: Prepared) -> None:
        if len(self._keys) >= 8:  # keep memory bounded on long builds
            rows, inv = np.unique(np.concatenate(self._keys), axis=0, return_inverse=True)
            counts = np.bincount(inv.ravel(), weights=np.concatenate(self._counts)).astype(np.int64)
            self._keys, self._counts = [rows], [counts]
        ok = next(iter(prep.cells.values())) >= 0
        rows = np.stack([prep.interval[ok], self._pack(prep, ok)], axis=1)
        if not len(rows):
            return
        u, c = np.unique(rows, axis=0, return_counts=True)
        self._keys.append(u)
        self._counts.append(c)

    def finalize(self) -> dict[str, np.ndarray]:
        if not self._keys:
            rows, counts = np.zeros((0, 2), np.int64), np.zeros(0, np.int64)
        else:
            rows, inv = np.unique(np.concatenate(self._keys), axis=0, return_inverse=True)
            counts = np.bincount(inv.ravel(), weights=np.concatenate(self._counts)).astype(np.int64)
        table = {
            "sc": (rows[:, 0] >> 40).astype(np.uint8),
            "interval": (rows[:, 0] & ((1 << 40) - 1)).astype(np.int32),
        }
        packed = rows[:, 1]
        for i, name in enumerate(reversed(self.names)):
            table[name] = ((packed >> (8 * i)) & 0xFF).astype(np.uint8)
        table["n"] = counts.astype(np.uint32)
        return table
