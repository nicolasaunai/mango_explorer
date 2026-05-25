"""Colormap + colorbar info. No matplotlib dependency."""
from __future__ import annotations

import numpy as np

# 32-stop jet ramp (dark-blue → blue → cyan → green → yellow → red → dark-red)
_LUT = np.array([
    [0.000, 0.000, 0.500],
    [0.000, 0.000, 0.627],
    [0.000, 0.000, 0.753],
    [0.000, 0.000, 0.878],
    [0.000, 0.000, 1.000],
    [0.000, 0.125, 1.000],
    [0.000, 0.251, 1.000],
    [0.000, 0.376, 1.000],
    [0.000, 0.502, 1.000],
    [0.000, 0.627, 1.000],
    [0.000, 0.753, 1.000],
    [0.000, 0.878, 1.000],
    [0.000, 1.000, 1.000],
    [0.125, 1.000, 0.875],
    [0.251, 1.000, 0.749],
    [0.376, 1.000, 0.624],
    [0.502, 1.000, 0.498],
    [0.627, 1.000, 0.373],
    [0.753, 1.000, 0.247],
    [0.878, 1.000, 0.122],
    [1.000, 1.000, 0.000],
    [1.000, 0.875, 0.000],
    [1.000, 0.749, 0.000],
    [1.000, 0.624, 0.000],
    [1.000, 0.498, 0.000],
    [1.000, 0.373, 0.000],
    [1.000, 0.247, 0.000],
    [1.000, 0.122, 0.000],
    [1.000, 0.000, 0.000],
    [0.875, 0.000, 0.000],
    [0.749, 0.000, 0.000],
    [0.500, 0.000, 0.000],
], dtype=np.float32)


def to_rgba(values: np.ndarray, vmin: float, vmax: float, mask: np.ndarray) -> np.ndarray:
    """Map a 2D float array to (H, W, 4) Float32 RGBA via the LUT.

    Masked-out bins receive alpha = 0; valid bins receive alpha = 1.
    """
    t = (values - vmin) / max(vmax - vmin, 1e-12)
    t = np.clip(t, 0.0, 1.0)

    n_stops = _LUT.shape[0]
    f = t * (n_stops - 1)
    i0 = np.floor(f).astype(int)
    i1 = np.minimum(i0 + 1, n_stops - 1)
    frac = (f - i0).astype(np.float32)[..., None]
    rgb = _LUT[i0] * (1.0 - frac) + _LUT[i1] * frac

    alpha = mask.astype(np.float32)[..., None]
    out = np.concatenate([rgb, alpha], axis=-1).astype(np.float32)
    return out


def colorbar_info(vmin: float, vmax: float, n_ticks: int = 6) -> dict:
    """Return a dict with colorbar metadata for the frontend."""
    ticks = np.linspace(vmin, vmax, n_ticks).tolist()
    return {"vmin": float(vmin), "vmax": float(vmax), "ticks": ticks}
