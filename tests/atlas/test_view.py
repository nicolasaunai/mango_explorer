import numpy as np
import pytest

from mango_explorer.atlas.columns import azimuth_deg, clock_angle_deg, signed_cone_deg
from mango_explorer.atlas.view import imf_direction, rotate_to_clock


def test_rotation_shifts_the_azimuth_by_minus_the_clock():
    rng = np.random.default_rng(0)
    p = rng.normal(0, 10, (50, 3))
    for clock in (0.0, 37.5, 90.0, 251.3):
        q = rotate_to_clock(p, clock)
        np.testing.assert_allclose(q[:, 0], p[:, 0])
        np.testing.assert_allclose(np.linalg.norm(q, axis=1), np.linalg.norm(p, axis=1))
        d = (azimuth_deg(q[:, 1], q[:, 2]) - (azimuth_deg(p[:, 1], p[:, 2]) - clock) + 540) % 360 - 180
        np.testing.assert_allclose(d, 0, atol=1e-9)


@pytest.mark.parametrize("clock,cone", [(0, 30), (90, 60), (200, 140), (330, 90)])
def test_imf_direction_has_the_given_clock_and_cone(clock, cone):
    b = imf_direction(clock, cone)
    assert np.linalg.norm(b) == pytest.approx(1.0)
    assert signed_cone_deg(*b) == pytest.approx(cone)
    assert clock_angle_deg(b[1], b[2]) == pytest.approx(clock % 360)


def test_imf_at_clock_t_is_the_atlas_imf_rotated():
    # the atlas holds PGSM at clock 0: IMF (cos c, 0, sin c); a target clock t rotates it
    for t in (15.0, 120.0, 300.0):
        np.testing.assert_allclose(rotate_to_clock(imf_direction(0, 40)[None], t)[0], imf_direction(t, 40), atol=1e-12)
