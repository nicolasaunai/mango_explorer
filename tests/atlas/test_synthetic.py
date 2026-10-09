import numpy as np
import polars as pl

from mango_explorer.atlas.columns import FRAME_COLUMNS, PGSM_CONE
from mango_explorer.atlas.synthetic import synthetic_frame, synthetic_magnetosheath


def test_gsm_rows_are_the_paired_normalized_rows():
    df = synthetic_magnetosheath(5_000, seed=1)
    g = synthetic_frame(df, "GSM")
    assert set(g.columns) == set(FRAME_COLUMNS["GSM"])
    assert g.height == df.filter(pl.col("SW_pairing") & pl.col("Norma_pos")).height


def test_pgsm_holds_every_row_twice_with_cones_f_and_180_minus_f():
    df = synthetic_magnetosheath(5_000, seed=2)
    p = synthetic_frame(df, "PGSM")
    assert set(FRAME_COLUMNS["PGSM"]) <= set(p.columns)
    plus, minus = p.filter(pl.col("bx_sign") == 1), p.filter(pl.col("bx_sign") == -1)
    assert plus.height == minus.height > 0
    np.testing.assert_allclose(plus[PGSM_CONE].to_numpy(), 180 - minus[PGSM_CONE].to_numpy())
    assert plus[PGSM_CONE].max() <= 90
    # the copy is the mirror Z -> -Z of positions and V, and (Bx, By, Bz) -> (-Bx, -By, Bz)
    for a, b, sign in (("Z_pgsm_norm", "Z_pgsm_norm", -1), ("Y_pgsm_norm", "Y_pgsm_norm", 1),
                       ("Vz_pgsm", "Vz_pgsm", -1), ("Bx_pgsm", "Bx_pgsm", -1), ("Bz_pgsm", "Bz_pgsm", 1)):
        np.testing.assert_allclose(minus[b].to_numpy(), sign * plus[a].to_numpy())


def test_pgsm_rotation_preserves_radius_so_depth_is_unchanged():
    df = synthetic_magnetosheath(5_000, seed=3)
    p = synthetic_frame(df, "PGSM").filter(pl.col("bx_sign") == 1)
    g = synthetic_frame(df, "GSM").filter(pl.col("Bx_imf").is_finite() & (pl.col("Bx_imf") ** 2 + pl.col("By_imf") ** 2 + pl.col("Bz_imf") ** 2 > 0))
    r = lambda d, f: np.sqrt(sum(d[f"{c}_{f}_norm"].to_numpy() ** 2 for c in "XYZ"))
    np.testing.assert_allclose(np.sort(r(p, "pgsm")), np.sort(r(g, "gsm")), rtol=1e-12)


def test_pgsm_puts_the_imf_of_bx_sign_plus_one_in_the_xz_plane_with_bx_and_bz_positive():
    # the IMF direction is the shift that maps the GSM IMF to PGSM; check it on the local B of a row
    # whose local field equals the IMF (synthetic B = compression * IMF)
    df = synthetic_magnetosheath(3_000, seed=4)
    p = synthetic_frame(df, "PGSM").filter(pl.col("bx_sign") == 1)
    bx, by, bz = (p[c].to_numpy() for c in ("Bx_pgsm", "By_pgsm", "Bz_pgsm"))
    assert np.nanmax(np.abs(by) / np.sqrt(bx**2 + by**2 + bz**2)) < 1e-9
    assert np.nanmin(bx) >= 0 and np.nanmin(bz) >= 0
