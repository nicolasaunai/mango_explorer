import numpy as np
import pytest
from hypothesis import given, settings
from hypothesis import strategies as st

from mango_explorer.atlas.frames import (
    azimuth_in_frame_deg,
    clock_angle_deg,
    cone_angle_deg,
    vector_to_frame,
)

comp = st.floats(-50, 50, allow_nan=False)
imf = st.tuples(comp, comp, comp).filter(lambda b: b[1] ** 2 + b[2] ** 2 > 1e-6)


def test_clock_angle_conventions():
    assert clock_angle_deg(0.0, 1.0) == pytest.approx(0.0)     # northward
    assert clock_angle_deg(1.0, 0.0) == pytest.approx(90.0)    # +By
    assert clock_angle_deg(0.0, -1.0) == pytest.approx(180.0)  # southward
    assert clock_angle_deg(-1.0, 0.0) == pytest.approx(270.0)


def test_cone_angle_conventions():
    assert cone_angle_deg(1.0, 0.0, 0.0) == pytest.approx(0.0)
    assert cone_angle_deg(-1.0, 0.0, 0.0) == pytest.approx(0.0)
    assert cone_angle_deg(0.0, 1.0, 0.0) == pytest.approx(90.0)
    assert cone_angle_deg(1.0, 1.0, 0.0) == pytest.approx(45.0)


@settings(max_examples=300)
@given(imf)
def test_pgsm_puts_imf_along_plus_z(b):
    bx, by, bz = b
    x, y, z = vector_to_frame("PGSM", bx, by, bz, magnetic=True, bx_imf=bx, by_imf=by, bz_imf=bz)
    assert y == pytest.approx(0.0, abs=1e-9)
    assert z == pytest.approx(np.hypot(by, bz), rel=1e-9)
    assert x == pytest.approx(bx)


@settings(max_examples=300)
@given(imf)
def test_fold_puts_imf_in_first_quadrant_of_xz(b):
    bx, by, bz = b
    x, y, z = vector_to_frame("PGSM_fold", bx, by, bz, magnetic=True,
                              bx_imf=bx, by_imf=by, bz_imf=bz)
    assert y == pytest.approx(0.0, abs=1e-9)
    assert z == pytest.approx(np.hypot(by, bz), rel=1e-9)
    assert x == pytest.approx(abs(bx))


@settings(max_examples=200)
@given(imf, st.tuples(comp, comp, comp), st.sampled_from(["GSM", "PGSM", "PGSM_fold"]),
       st.booleans())
def test_rotations_preserve_norm_and_x_axis_angle(b, v, frame, magnetic):
    bx, by, bz = b
    x, y, z = vector_to_frame(frame, *v, magnetic=magnetic, bx_imf=bx, by_imf=by, bz_imf=bz)
    assert np.hypot(np.hypot(x, y), z) == pytest.approx(np.linalg.norm(v), rel=1e-9, abs=1e-9)
    if not magnetic:
        assert x == v[0]


@settings(max_examples=200)
@given(imf, comp, comp, st.sampled_from(["GSM", "PGSM", "PGSM_fold"]))
def test_azimuth_shift_matches_vector_rotation(b, py, pz, frame):
    if py * py + pz * pz < 1e-6:
        return
    bx, by, bz = b
    _, y, z = vector_to_frame(frame, 0.0, py, pz, magnetic=False, bx_imf=bx, by_imf=by, bz_imf=bz)
    phi = azimuth_in_frame_deg(frame, py, pz, bx_imf=bx, by_imf=by, bz_imf=bz)
    expected = np.degrees(np.arctan2(z, y)) % 360
    diff = (phi - expected + 180) % 360 - 180
    assert diff == pytest.approx(0.0, abs=1e-7)


def test_unknown_frame_raises():
    with pytest.raises(ValueError):
        vector_to_frame("SM", 1, 1, 1, magnetic=False, bx_imf=1, by_imf=1, bz_imf=1)
