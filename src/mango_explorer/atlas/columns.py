"""MANGO columns as space_mango returns them per frame, and the canonical columns the atlas uses.

The atlas is built one frame at a time. `canonical` turns a space_mango result (numpy columns) into
the same names for every frame, so the binning code never looks at frame names.
"""
from __future__ import annotations

import numpy as np

# Computed by space_mango in its PGSM output (blocker B1 of the grid-v3 spec): the only place
# these names are spelled.
PGSM_CONE, PGSM_V_SW, PGSM_B_IMF = "cone_pgsm", "V_sw", "B_imf"

_SCALARS = ("Time", "SC", "Np", "Tp", "Np_sw", "Tp_sw", "Pd_sw", "Beta_sw", "Ma_sw", "R_norm", "R_mp", "R_bs")
GSM_COLUMNS = (
    *_SCALARS, "Bx", "By", "Bz", "Vx", "Vy", "Vz", "Bx_imf", "By_imf", "Bz_imf", "Vx_sw", "Vy_sw", "Vz_sw",
    "Norma_pos", "SW_pairing", "X_gsm_norm", "Y_gsm_norm", "Z_gsm_norm",
)
PGSM_COLUMNS = (
    *_SCALARS, PGSM_CONE, PGSM_V_SW, PGSM_B_IMF,
    "X_pgsm_norm", "Y_pgsm_norm", "Z_pgsm_norm", "Bx_pgsm", "By_pgsm", "Bz_pgsm", "Vx_pgsm", "Vy_pgsm", "Vz_pgsm",
    "bx_sign",
)
FRAME_COLUMNS = {"GSM": GSM_COLUMNS, "PGSM": PGSM_COLUMNS}
_VECTORS = {
    "GSM": (("X_gsm_norm", "Y_gsm_norm", "Z_gsm_norm"), ("Bx", "By", "Bz"), ("Vx", "Vy", "Vz")),
    "PGSM": (("X_pgsm_norm", "Y_pgsm_norm", "Z_pgsm_norm"), ("Bx_pgsm", "By_pgsm", "Bz_pgsm"),
             ("Vx_pgsm", "Vy_pgsm", "Vz_pgsm")),
}


def _norm(x, y, z):
    return np.sqrt(np.square(x) + np.square(y) + np.square(z))


def clock_angle_deg(by, bz):
    """IMF clock angle atan2(By, Bz) in [0, 360): 0 = northward, 90 = +By."""
    return np.degrees(np.arctan2(by, bz)) % 360.0


def signed_cone_deg(bx, by, bz):
    """IMF cone angle arccos(Bx/|B|) in [0, 180]: 0 = IMF sunward, 180 = earthward."""
    with np.errstate(invalid="ignore", divide="ignore"):
        return np.degrees(np.arccos(np.clip(np.asarray(bx, dtype=float) / _norm(bx, by, bz), -1.0, 1.0)))


def polar_angle_deg(x, y, z):
    """Angle from +X, in degrees."""
    with np.errstate(invalid="ignore", divide="ignore"):
        return np.degrees(np.arccos(np.clip(np.asarray(x, dtype=float) / _norm(x, y, z), -1.0, 1.0)))


def azimuth_deg(y, z):
    """atan2(Z, Y) in [0, 360): 90 = +Z."""
    return np.degrees(np.arctan2(z, y)) % 360.0


def mango_request(frame: str, grid) -> dict:
    """space_mango get_data arguments of one frame, besides spacecraft and time."""
    if frame == "GSM":
        return {"frame": "gsm", "columns": list(GSM_COLUMNS), "sw_paired_only": True, "normalized_only": True}
    if frame == "PGSM":
        lo, hi = grid.raw["pgsm"]["cone"]
        return {"frame": "pgsm", "cone": [lo, hi], "clock": grid.atlas_clock_deg, "columns": list(PGSM_COLUMNS)}
    raise ValueError(f"unknown frame {frame!r}")


def canonical(cols: dict, frame: str) -> dict[str, np.ndarray]:
    """The atlas columns of one frame (see the module docstring) from space_mango columns."""
    if frame not in _VECTORS:
        raise ValueError(f"unknown frame {frame!r}")
    f = lambda name: np.asarray(cols[name], dtype=float)
    out: dict[str, np.ndarray] = {"Time": np.asarray(cols["Time"]), "SC": np.asarray(cols["SC"], dtype=object)}
    for name in _SCALARS[2:]:
        out[name] = f(name)
    n = len(out["Time"])
    if frame == "GSM":
        bx, by, bz = f("Bx_imf"), f("By_imf"), f("Bz_imf")
        out["B_imf"] = _norm(bx, by, bz)
        out["V_sw"] = _norm(f("Vx_sw"), f("Vy_sw"), f("Vz_sw"))
        out["cone_deg"] = signed_cone_deg(bx, by, bz)
        out["clock_deg"] = clock_angle_deg(by, bz)
        out["usable"] = np.asarray(cols["SW_pairing"], dtype=bool) & np.asarray(cols["Norma_pos"], dtype=bool)
    else:
        missing = [c for c in (PGSM_CONE, PGSM_V_SW, PGSM_B_IMF) if c not in cols]
        if missing:
            raise KeyError(f"space_mango's PGSM output lacks {missing}: install a space_mango that returns "
                           "the computed PGSM columns (cone_pgsm, |V_sw|, |B_imf|)")
        out["B_imf"], out["V_sw"], out["cone_deg"] = f(PGSM_B_IMF), f(PGSM_V_SW), f(PGSM_CONE)
        out["usable"] = np.ones(n, dtype=bool)  # space_mango keeps only paired, normalized rows in PGSM
    pos, b, v = _VECTORS[frame]
    for keys, names in ((("X", "Y", "Z"), pos), (("Bx", "By", "Bz"), b), (("Vx", "Vy", "Vz"), v)):
        for k, name in zip(keys, names):
            out[k] = f(name)
    return out
