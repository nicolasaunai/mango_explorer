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
