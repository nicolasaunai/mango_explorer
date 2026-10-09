"""Per-sample quantities and conditioning variables from the canonical columns of one frame.

Ratios and magnitudes are formed per sample, before any binning: the median of a ratio is not
the ratio of medians.
"""
from __future__ import annotations

import numpy as np

from mango_explorer.atlas.columns import azimuth_deg, polar_angle_deg
from mango_explorer.atlas.grid import Grid


def _norm(x, y, z):
    return np.sqrt(np.square(x) + np.square(y) + np.square(z))


def row_mask(c: dict[str, np.ndarray], grid: Grid, frame: str) -> np.ndarray:
    """Rows usable for any statistic: kept by space_mango, finite position and conditioning angles."""
    mask = np.asarray(c["usable"], dtype=bool).copy()
    angles = [n for n in ("cone_deg", "clock_deg") if n in grid.frame_conditions(frame)]
    for name in ("X", "Y", "Z", *angles):
        mask &= np.isfinite(np.asarray(c[name], dtype=float))
    return mask


def condition_values(c: dict[str, np.ndarray], grid: Grid, frame: str) -> dict[str, np.ndarray]:
    return {name: np.asarray(c[name], dtype=float) for name in grid.frame_conditions(frame)}


def quantity_values(c: dict[str, np.ndarray]) -> dict[str, np.ndarray]:
    b = _norm(c["Bx"], c["By"], c["Bz"])
    v = _norm(c["Vx"], c["Vy"], c["Vz"])
    with np.errstate(invalid="ignore", divide="ignore"):
        return {
            "Np": np.asarray(c["Np"], dtype=float),
            "Tp": np.asarray(c["Tp"], dtype=float),
            "B": b,
            "V": v,
            "Np_ratio": c["Np"] / c["Np_sw"],
            "B_ratio": b / c["B_imf"],
            "Tp_ratio": c["Tp"] / c["Tp_sw"],
            "V_ratio": v / c["V_sw"],
        }


def geometric_depth(c: dict[str, np.ndarray], grid: Grid) -> np.ndarray:
    """Depth of the normalized position between MANGO's reference boundaries (0 = MP, 1 = BS)."""
    x, y, z = (np.asarray(c[k], dtype=float) for k in ("X", "Y", "Z"))
    r = np.sqrt(x * x + y * y + z * z)
    with np.errstate(invalid="ignore", divide="ignore"):
        theta = np.arccos(np.clip(x / r, -1.0, 1.0))
        r_mp, r_bs = grid.reference_radii()
        return (r - r_mp(theta)) / (r_bs(theta) - r_mp(theta))


def normalized_angles(c: dict[str, np.ndarray]) -> tuple[np.ndarray, np.ndarray]:
    """(theta, phi) in degrees of the frame's normalized position."""
    return polar_angle_deg(c["X"], c["Y"], c["Z"]), azimuth_deg(c["Y"], c["Z"])


def interval_ids(c: dict[str, np.ndarray], grid: Grid) -> np.ndarray:
    """One integer per (spacecraft, N_eff interval): the unit used to count N_eff."""
    sc_code = {name: i for i, name in enumerate(grid.spacecraft)}
    sc = np.array([sc_code[s] for s in np.asarray(c["SC"]).tolist()], dtype=np.int64) \
        if len(c["SC"]) else np.zeros(0, dtype=np.int64)
    t = np.asarray(c["Time"]).astype("datetime64[ns]").astype(np.int64)
    return (sc << 40) + t // (grid.neff_interval_s * 1_000_000_000)
