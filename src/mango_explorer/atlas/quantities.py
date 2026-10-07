"""Per-sample quantities and conditioning variables computed from MANGO columns.

Ratios and magnitudes are formed per sample, before any binning: the median of a ratio is not
the ratio of medians.
"""
from __future__ import annotations

import numpy as np

from mango_explorer.atlas.frames import (
    azimuth_in_frame_deg,
    clock_angle_deg,
    cone_angle_deg,
    polar_angle_deg,
)
from mango_explorer.atlas.grid import Grid

COLUMNS = (
    "Time", "SC",
    "Bx", "By", "Bz", "Np", "Vx", "Vy", "Vz", "Tp",
    "Bx_imf", "By_imf", "Bz_imf", "Np_sw", "Vx_sw", "Vy_sw", "Vz_sw", "Tp_sw",
    "Pd_sw", "Beta_sw", "Ma_sw",
    "R_norm", "Norma_pos", "SW_pairing", "X_gsm_norm", "Y_gsm_norm", "Z_gsm_norm",
)

_FINITE_REQUIRED = ("Bx_imf", "By_imf", "Bz_imf", "X_gsm_norm", "Y_gsm_norm", "Z_gsm_norm")


def _norm(x, y, z):
    return np.sqrt(np.square(x) + np.square(y) + np.square(z))


def row_mask(cols: dict[str, np.ndarray]) -> np.ndarray:
    """Rows usable for any statistic: paired with OMNI, normalized, finite geometry and IMF."""
    mask = np.asarray(cols["SW_pairing"], dtype=bool) & np.asarray(cols["Norma_pos"], dtype=bool)
    for name in _FINITE_REQUIRED:
        mask &= np.isfinite(cols[name])
    return mask


def condition_values(cols: dict[str, np.ndarray]) -> dict[str, np.ndarray]:
    return {
        "clock_deg": clock_angle_deg(cols["By_imf"], cols["Bz_imf"]),
        "cone_deg": cone_angle_deg(cols["Bx_imf"], cols["By_imf"], cols["Bz_imf"]),
        "Ma_sw": np.asarray(cols["Ma_sw"], dtype=float),
        "Pd_sw": np.asarray(cols["Pd_sw"], dtype=float),
        "Beta_sw": np.asarray(cols["Beta_sw"], dtype=float),
        "V_sw": _norm(cols["Vx_sw"], cols["Vy_sw"], cols["Vz_sw"]),
    }


def quantity_values(cols: dict[str, np.ndarray]) -> dict[str, np.ndarray]:
    b = _norm(cols["Bx"], cols["By"], cols["Bz"])
    v = _norm(cols["Vx"], cols["Vy"], cols["Vz"])
    b_imf = _norm(cols["Bx_imf"], cols["By_imf"], cols["Bz_imf"])
    v_sw = _norm(cols["Vx_sw"], cols["Vy_sw"], cols["Vz_sw"])
    with np.errstate(invalid="ignore", divide="ignore"):
        return {
            "Np": np.asarray(cols["Np"], dtype=float),
            "Tp": np.asarray(cols["Tp"], dtype=float),
            "B": b,
            "V": v,
            "Np_ratio": cols["Np"] / cols["Np_sw"],
            "B_ratio": b / b_imf,
            "Tp_ratio": cols["Tp"] / cols["Tp_sw"],
            "V_ratio": v / v_sw,
        }


def geometric_depth(cols: dict[str, np.ndarray], grid: Grid) -> np.ndarray:
    """Depth of the normalized position between MANGO's reference boundaries (0 = MP, 1 = BS)."""
    x, y, z = (np.asarray(cols[c], dtype=float) for c in ("X_gsm_norm", "Y_gsm_norm", "Z_gsm_norm"))
    r = np.sqrt(x * x + y * y + z * z)
    with np.errstate(invalid="ignore", divide="ignore"):
        theta = np.arccos(np.clip(x / r, -1.0, 1.0))
        r_mp, r_bs = grid.reference_radii()
        return (r - r_mp(theta)) / (r_bs(theta) - r_mp(theta))


def normalized_angles(cols: dict[str, np.ndarray], frame: str) -> tuple[np.ndarray, np.ndarray]:
    """(theta, phi) in degrees of the boundary-normalized position, phi expressed in `frame`."""
    x, y, z = cols["X_gsm_norm"], cols["Y_gsm_norm"], cols["Z_gsm_norm"]
    theta = polar_angle_deg(x, y, z)
    phi = azimuth_in_frame_deg(
        frame, y, z, bx_imf=cols["Bx_imf"], by_imf=cols["By_imf"], bz_imf=cols["Bz_imf"]
    )
    return theta, phi


def interval_ids(cols: dict[str, np.ndarray], grid: Grid) -> np.ndarray:
    """One integer per (spacecraft, N_eff interval): the unit used to count N_eff."""
    sc_code = {name: i for i, name in enumerate(grid.spacecraft)}
    sc = np.array([sc_code[s] for s in np.asarray(cols["SC"]).tolist()], dtype=np.int64) \
        if len(cols["SC"]) else np.zeros(0, dtype=np.int64)
    t = np.asarray(cols["Time"]).astype("datetime64[ns]").astype(np.int64)
    interval = t // (grid.neff_interval_s * 1_000_000_000)
    return (sc << 40) + interval
