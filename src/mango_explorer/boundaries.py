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
