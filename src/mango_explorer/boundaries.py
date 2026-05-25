"""Magnetopause and bow-shock boundary models."""
from __future__ import annotations

import numpy as np


def shue_mp(theta, r0: float, alpha: float):
    """Shue+1998 magnetopause: r(theta) = r0 * (2/(1+cos theta))**alpha.

    theta : float or ndarray, radians, 0 = subsolar.
    r0    : subsolar standoff distance (RE).
    alpha : flaring exponent.
    """
    theta = np.asarray(theta, dtype=float)
    return r0 * (2.0 / (1.0 + np.cos(theta))) ** alpha


def shue_r0(bz: float, pd: float) -> float:
    """Shue+1998 subsolar standoff distance (RE).

    bz : IMF Bz (nT), GSM.
    pd : solar wind dynamic pressure (nPa).
    """
    return (10.22 + 1.29 * np.tanh(0.184 * (bz + 8.14))) * pd ** (-1.0 / 6.6)


def shue_alpha(bz: float, pd: float) -> float:
    """Shue+1998 flaring exponent."""
    return (0.58 - 0.007 * bz) * (1.0 + 0.024 * np.log(pd))


_JEL_LAMBDA = 15.02   # RE at 1 nPa, per Jelínek+2012 fit
_JEL_EPS = 6.55       # pressure exponent
_JEL_ALPHA = 0.78     # flaring exponent (verify against paper)


def jelinek_r0(pd: float) -> float:
    """Jelínek+2012 bow-shock subsolar standoff (RE) as a function of Pd_sw."""
    return _JEL_LAMBDA * pd ** (-1.0 / _JEL_EPS)


def jelinek_bs(theta, pd: float, alpha: float = _JEL_ALPHA):
    """Jelínek+2012 bow shock surface: r(theta)."""
    theta = np.asarray(theta, dtype=float)
    r0 = jelinek_r0(pd)
    return r0 * (2.0 / (1.0 + np.cos(theta))) ** alpha


def tessellate_surface(
    r_of_theta,
    n_theta: int = 50,
    n_phi: int = 64,
    theta_max: float = np.pi * 0.85,
):
    """Tessellate an axisymmetric surface r(theta) into a triangle mesh.

    Sun-Earth axis is +x. Returns (positions[Nv,3] float32, indices[Nt,3] uint32).
    Topology: n_theta rings × n_phi meridians, with quad cells split into 2 triangles.
    """
    theta = np.linspace(0.0, theta_max, n_theta)
    phi = np.linspace(0.0, 2.0 * np.pi, n_phi, endpoint=False)
    r = np.asarray(r_of_theta(theta), dtype=float)

    # x along sun-earth axis; rho = r sin(theta) revolves around x
    x = (r * np.cos(theta))[:, None] * np.ones_like(phi)[None, :]
    rho = (r * np.sin(theta))[:, None]
    y = rho * np.cos(phi)[None, :]
    z = rho * np.sin(phi)[None, :]

    pos = np.stack([x, y, z], axis=-1).reshape(-1, 3).astype(np.float32)

    # Index buffer
    tris = []
    for i in range(n_theta - 1):
        for j in range(n_phi):
            j1 = (j + 1) % n_phi
            a = i * n_phi + j
            b = i * n_phi + j1
            c = (i + 1) * n_phi + j
            d = (i + 1) * n_phi + j1
            tris.append((a, c, d))
            tris.append((a, d, b))
    idx = np.asarray(tris, dtype=np.uint32)
    return pos, idx
