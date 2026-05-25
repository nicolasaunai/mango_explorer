"""Colormap + colorbar info. No matplotlib dependency."""
from __future__ import annotations

import numpy as np

# 16-stop viridis-like ramp (R, G, B in [0, 1])
_LUT = np.array([
    [0.267, 0.005, 0.329],
    [0.283, 0.130, 0.449],
    [0.262, 0.242, 0.521],
    [0.221, 0.339, 0.549],
    [0.177, 0.428, 0.557],
    [0.143, 0.522, 0.553],
    [0.120, 0.622, 0.534],
    [0.166, 0.722, 0.483],
    [0.319, 0.812, 0.388],
    [0.535, 0.886, 0.261],
    [0.762, 0.929, 0.166],
    [0.957, 0.949, 0.143],
    [0.993, 0.906, 0.144],
    [0.995, 0.820, 0.160],
    [0.985, 0.711, 0.193],
    [0.964, 0.566, 0.234],
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
