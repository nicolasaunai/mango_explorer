import numpy as np
import pytest

from mango_explorer.atlas.grid import load_grid

G3 = load_grid("grid-v3")


def test_frames_and_cubes():
    assert G3.version == "grid-v3"
    assert G3.frames == ("GSM", "PGSM")
    assert G3.cube_of_frame("GSM") == "clock-cone-Ma"
    assert G3.cube_shape("clock-cone-Ma") == (12, 12, 5)
    assert G3.cube_of_frame("PGSM") == "cone-Ma"
    assert G3.cube_shape("cone-Ma") == (12, 5)
    assert G3.cube_frame("cone-Ma") == "PGSM"
    with pytest.raises(KeyError):
        G3.cube_of_frame("SM")


def test_clock_applies_to_gsm_only():
    assert G3.frame_conditions("GSM") == ("clock_deg", "cone_deg", "Ma_sw", "Pd_sw", "Beta_sw", "V_sw")
    assert G3.frame_conditions("PGSM") == ("cone_deg", "Ma_sw", "Pd_sw", "Beta_sw", "V_sw")


def test_mean_reference_boundaries():
    r_mp, r_bs = G3.reference_radii()
    assert r_mp(0.0) == pytest.approx(10.209, abs=1e-3)   # mean Shue98, Pd 2.056, Bz -0.001
    assert r_bs(0.0) == pytest.approx(13.455, abs=1e-3)   # mean Jelinek2012, Pd 2.056
    th = np.linspace(0, 2.0, 30)
    assert np.all(r_mp(th) < r_bs(th))


def test_atlas_clock():
    assert G3.atlas_clock_deg == 0.0
