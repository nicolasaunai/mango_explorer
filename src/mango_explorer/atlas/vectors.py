"""Vectors (ion velocity, magnetic field) for flow and field lines, see grid spec "vectors".

MANGO normalizes every position radially between the sample's own boundaries (R_mp, R_bs along its
direction) and fixed reference surfaces. A line through the data maps with the Jacobian of that
mapping, so each vector is pushed forward before averaging (vectors are those of the frame: GSM
served, PGSM `*_pgsm`); tangents to the sample's boundaries then
stay tangent to the reference ones. The sample's boundary slopes are not served: they are taken from
the reference shapes, scaled by R_mp / R*_mp and R_bs / R*_bs (approximation A1).
"""
from __future__ import annotations

import numpy as np

from mango_explorer.atlas.grid import Grid

VECTORS = {"V_vec": (("Vx", "Vy", "Vz"), False), "B_vec": (("Bx", "By", "Bz"), True)}
COMPONENTS = [f"{name}_{c}" for name in VECTORS for c in "xyz"]
_H = 1e-5


def _slope(f, theta):
    """d f / d theta (central difference; one-sided at the subsolar point)."""
    lo = np.maximum(theta - _H, 0.0)
    return (f(theta + _H) - f(lo)) / (theta + _H - lo)


def to_normalized(vec, xyz_norm, depth, r_mp, r_bs, grid: Grid) -> np.ndarray:
    """Push GSM vectors (n, 3) at normalized positions (n, 3) through MANGO's radial normalization.

    `depth` is MANGO's R_norm, (|r| - R_mp) / (R_bs - R_mp); r_mp, r_bs the sample's own boundaries.
    """
    vec, p = np.asarray(vec, dtype=float), np.asarray(xyz_norm, dtype=float)
    depth, r_mp, r_bs = (np.asarray(a, dtype=float) for a in (depth, r_mp, r_bs))
    with np.errstate(invalid="ignore", divide="ignore"):
        rn = np.linalg.norm(p, axis=1)
        er = p / rn[:, None]
        theta = np.arccos(np.clip(er[:, 0], -1.0, 1.0))
        rho = np.hypot(p[:, 1], p[:, 2])
        cphi = np.where(rho > 0, p[:, 1] / np.where(rho > 0, rho, 1.0), 1.0)
        sphi = np.where(rho > 0, p[:, 2] / np.where(rho > 0, rho, 1.0), 0.0)
        et = np.stack([-np.sin(theta), np.cos(theta) * cphi, np.cos(theta) * sphi], axis=1)
        ep = np.stack([np.zeros_like(theta), -sphi, cphi], axis=1)

        ref_mp, ref_bs = grid.reference_radii()
        mp_ref, bs_ref = ref_mp(theta), ref_bs(theta)
        dmp_ref, dbs_ref = _slope(ref_mp, theta), _slope(ref_bs, theta)
        dmp, dbs = r_mp / mp_ref * dmp_ref, r_bs / bs_ref * dbs_ref       # A1: scaled reference slopes
        thick, thick_ref = r_bs - r_mp, bs_ref - mp_ref
        r = r_mp + depth * thick

        vr, vt, vp = (vec * er).sum(1), (vec * et).sum(1), (vec * ep).sum(1)
        vr_n = (thick_ref / thick * vr
                + (dmp_ref + depth * (dbs_ref - dmp_ref) - thick_ref * (dmp + depth * (dbs - dmp)) / thick) * vt / r)
        k = rn / r
        return vr_n[:, None] * er + (k * vt)[:, None] * et + (k * vp)[:, None] * ep


def normalized_vectors(c: dict[str, np.ndarray], grid: Grid) -> dict[str, np.ndarray]:
    """Every vector of VECTORS, pushed into the frame's normalized space; NaN where an input is missing.

    In PGSM the pushforward is evaluated at the PGSM position (approximation A2 of the grid spec)."""
    n = len(c["R_norm"])
    nan = np.full(n, np.nan)
    xyz = np.stack([np.asarray(c[k], dtype=float) for k in ("X", "Y", "Z")], axis=1)
    depth = np.asarray(c["R_norm"], dtype=float)
    r_mp = np.asarray(c.get("R_mp", nan), dtype=float)
    r_bs = np.asarray(c.get("R_bs", nan), dtype=float)
    return {name: to_normalized(np.stack([np.asarray(c[k], dtype=float) for k in comps], axis=1),
                                xyz, depth, r_mp, r_bs, grid)
            for name, (comps, _) in VECTORS.items()}
