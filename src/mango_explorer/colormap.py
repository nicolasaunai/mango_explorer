"""Colormap + colorbar info. No matplotlib dependency."""
from __future__ import annotations

import numpy as np

# 32-stop jet ramp (dark-blue → blue → cyan → green → yellow → red → dark-red)
_LUT_JET = np.array([
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

# 32-stop RdBu diverging ramp (red → white → blue), white centred at t=0.5.
# Sampled from the standard RdBu 11-stop control points so Bz=0 maps to neutral.
_LUT_RDBU = np.array([
    [0.404, 0.000, 0.122],
    [0.499, 0.030, 0.137],
    [0.594, 0.061, 0.152],
    [0.688, 0.091, 0.167],
    [0.739, 0.176, 0.208],
    [0.784, 0.267, 0.251],
    [0.830, 0.358, 0.293],
    [0.869, 0.446, 0.356],
    [0.908, 0.533, 0.423],
    [0.946, 0.621, 0.490],
    [0.965, 0.695, 0.571],
    [0.976, 0.763, 0.658],
    [0.988, 0.832, 0.745],
    [0.988, 0.880, 0.817],
    [0.980, 0.916, 0.878],
    [0.973, 0.951, 0.938],
    [0.945, 0.958, 0.964],
    [0.897, 0.935, 0.956],
    [0.849, 0.912, 0.946],
    [0.788, 0.882, 0.932],
    [0.708, 0.841, 0.909],
    [0.629, 0.801, 0.887],
    [0.543, 0.754, 0.861],
    [0.443, 0.691, 0.827],
    [0.343, 0.627, 0.792],
    [0.254, 0.565, 0.759],
    [0.211, 0.508, 0.730],
    [0.168, 0.451, 0.701],
    [0.126, 0.393, 0.666],
    [0.090, 0.325, 0.570],
    [0.055, 0.257, 0.475],
    [0.020, 0.188, 0.380],
], dtype=np.float32)

_LUTS = {"jet": _LUT_JET, "rdbu": _LUT_RDBU}


def to_rgba(values: np.ndarray, vmin: float, vmax: float, mask: np.ndarray,
            cmap: str = "jet") -> np.ndarray:
    """Map a 2D float array to (H, W, 4) Float32 RGBA via the named LUT.

    Masked-out bins receive alpha = 0; valid bins receive alpha = 1.
    """
    lut = _LUTS.get(cmap, _LUT_JET)
    t = (values - vmin) / max(vmax - vmin, 1e-12)
    t = np.clip(t, 0.0, 1.0)

    n_stops = lut.shape[0]
    f = t * (n_stops - 1)
    i0 = np.floor(f).astype(int)
    i1 = np.minimum(i0 + 1, n_stops - 1)
    frac = (f - i0).astype(np.float32)[..., None]
    rgb = lut[i0] * (1.0 - frac) + lut[i1] * frac

    alpha = mask.astype(np.float32)[..., None]
    out = np.concatenate([rgb, alpha], axis=-1).astype(np.float32)
    return out


def colorbar_info(vmin: float, vmax: float, n_ticks: int = 6) -> dict:
    """Return a dict with colorbar metadata for the frontend."""
    ticks = np.linspace(vmin, vmax, n_ticks).tolist()
    return {"vmin": float(vmin), "vmax": float(vmax), "ticks": ticks}
