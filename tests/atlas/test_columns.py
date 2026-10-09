import numpy as np
import pytest

from mango_explorer.atlas.columns import (
    FRAME_COLUMNS,
    PGSM_B_IMF,
    PGSM_CONE,
    PGSM_V_SW,
    azimuth_deg,
    canonical,
    clock_angle_deg,
    mango_request,
    signed_cone_deg,
)
from mango_explorer.atlas.grid import load_grid


def _served(frame, n=3):
    cols = {c: np.ones(n) for c in FRAME_COLUMNS[frame]}
    cols["Time"] = np.arange(n).astype("datetime64[s]")
    cols["SC"] = np.array(["C1"] * n, dtype=object)
    if frame == "GSM":
        cols["SW_pairing"] = cols["Norma_pos"] = np.array([True, True, False])
    return cols


def test_angles():
    assert clock_angle_deg(0.0, 1.0) == pytest.approx(0.0)
    assert clock_angle_deg(1.0, 0.0) == pytest.approx(90.0)
    assert clock_angle_deg(-1.0, 0.0) == pytest.approx(270.0)
    assert signed_cone_deg(1.0, 0.0, 0.0) == pytest.approx(0.0)
    assert signed_cone_deg(-1.0, 0.0, 0.0) == pytest.approx(180.0)
    assert signed_cone_deg(-1.0, 1.0, 0.0) == pytest.approx(135.0)
    assert azimuth_deg(0.0, 1.0) == pytest.approx(90.0)
    assert azimuth_deg(0.0, -1.0) == pytest.approx(270.0)


def test_gsm_canonical_computes_imf_angles_and_magnitudes():
    cols = _served("GSM")
    cols["Bx_imf"], cols["By_imf"], cols["Bz_imf"] = np.array([-3.0, 0, 0]), np.array([0, 4.0, 0]), np.array([4.0, 0, 1.0])
    cols["Vx_sw"], cols["Vy_sw"], cols["Vz_sw"] = np.array([-400.0] * 3), np.zeros(3), np.zeros(3)
    c = canonical(cols, "GSM")
    np.testing.assert_allclose(c["cone_deg"], [np.degrees(np.arccos(-0.6)), 90.0, 90.0])
    np.testing.assert_allclose(c["clock_deg"], [0.0, 90.0, 0.0])
    np.testing.assert_allclose(c["B_imf"], [5.0, 4.0, 1.0])
    np.testing.assert_allclose(c["V_sw"], [400.0] * 3)
    assert c["usable"].tolist() == [True, True, False]
    np.testing.assert_array_equal(c["X"], cols["X_gsm_norm"])


def test_pgsm_canonical_reads_the_space_mango_columns():
    cols = _served("PGSM")
    cols[PGSM_CONE], cols[PGSM_V_SW], cols[PGSM_B_IMF] = np.array([10.0, 170.0, 95.0]), np.full(3, 450.0), np.full(3, 6.0)
    c = canonical(cols, "PGSM")
    np.testing.assert_array_equal(c["cone_deg"], [10.0, 170.0, 95.0])
    assert "clock_deg" not in c
    assert c["usable"].all()
    np.testing.assert_array_equal(c["Bz"], cols["Bz_pgsm"])


def test_pgsm_without_the_computed_columns_says_what_is_missing():
    cols = _served("PGSM")
    del cols[PGSM_CONE]
    with pytest.raises(KeyError, match="cone_pgsm"):
        canonical(cols, "PGSM")


def test_mango_requests():
    g = load_grid("grid-v3")
    gsm = mango_request("GSM", g)
    assert gsm["frame"] == "gsm" and gsm["sw_paired_only"] and gsm["normalized_only"]
    pgsm = mango_request("PGSM", g)
    assert pgsm["frame"] == "pgsm" and pgsm["cone"] == [0, 180] and pgsm["clock"] == 0.0
    assert set(pgsm["columns"]) == set(FRAME_COLUMNS["PGSM"])
