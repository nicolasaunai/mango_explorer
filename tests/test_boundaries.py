import math
import numpy as np
import pytest
from mango_explorer.boundaries import shue_mp


def test_shue_mp_subsolar_returns_r0():
    # At theta=0, r = r0 * (2/2)^alpha = r0
    assert shue_mp(theta=0.0, r0=10.5, alpha=0.6) == pytest.approx(10.5)


def test_shue_mp_terminator():
    # At theta=pi/2, r = r0 * 2^alpha
    r0, alpha = 10.5, 0.6
    expected = r0 * (2.0 ** alpha)
    assert shue_mp(theta=math.pi / 2, r0=r0, alpha=alpha) == pytest.approx(expected)


def test_shue_mp_vectorized():
    theta = np.linspace(0, math.pi * 0.85, 50)
    r = shue_mp(theta, r0=10.5, alpha=0.6)
    assert r.shape == theta.shape
    # Monotone increasing with theta in [0, pi*0.85]
    assert np.all(np.diff(r) >= -1e-9)


from mango_explorer.boundaries import shue_r0, shue_alpha


def test_shue_r0_nominal_solar_wind():
    # Bz=0 nT, Pd=2 nPa: r0 ~ 10.22 * (1 + tanh-term) * 2^(-1/6.6)
    r0 = shue_r0(bz=0.0, pd=2.0)
    assert 9.5 < r0 < 11.5


def test_shue_alpha_negative_bz_decreases_r0_increases_alpha():
    r0_pos = shue_r0(bz=5.0, pd=2.0)
    r0_neg = shue_r0(bz=-5.0, pd=2.0)
    assert r0_neg < r0_pos  # southward IMF → MP closer
    a_pos = shue_alpha(bz=5.0, pd=2.0)
    a_neg = shue_alpha(bz=-5.0, pd=2.0)
    assert a_neg > a_pos  # more flared under southward IMF
