"""Statistics read from fixed-edge histograms."""
from __future__ import annotations

import numpy as np


def hist_quantile(counts, axis_edges, q: float):
    """Quantile q of histogram(s) along the last axis, in axis space.

    Cumulative counts with linear interpolation inside the bin that crosses q * total.
    Empty histograms give NaN. For log quantities take 10**result.
    """
    counts = np.asarray(counts, dtype=float)
    edges = np.asarray(axis_edges, dtype=float)
    total = counts.sum(axis=-1, keepdims=True)
    cum = np.cumsum(counts, axis=-1)
    target = q * total
    i = np.argmax(cum >= target, axis=-1)[..., None]
    below = np.take_along_axis(cum, i, axis=-1) - np.take_along_axis(counts, i, axis=-1)
    in_bin = np.take_along_axis(counts, i, axis=-1)
    with np.errstate(invalid="ignore", divide="ignore"):
        frac = np.where(in_bin > 0, (target - below) / in_bin, 0.0)
    lo, hi = edges[i], edges[i + 1]
    value = (lo + frac * (hi - lo))[..., 0]
    return np.where(total[..., 0] > 0, value, np.nan)
