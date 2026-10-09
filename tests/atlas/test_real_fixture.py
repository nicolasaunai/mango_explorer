"""Checks against real space_mango output (tests/data/mango, recorded by scripts/record_fixture.py)."""
from pathlib import Path

import numpy as np
import polars as pl

from mango_explorer.atlas.grid import load_grid
from mango_explorer.atlas.pipeline import build_atlas
from mango_explorer.atlas.quantities import geometric_depth, row_mask
from mango_explorer.atlas.sources import canonical_columns, iter_polars
from mango_explorer.atlas.store import read_atlas
from mango_explorer.atlas.view import rotate_to_clock

DATA = Path(__file__).resolve().parents[1] / "data" / "mango"
G = load_grid()


def _read(name):
    return pl.read_parquet(DATA / f"{name}.parquet")


def test_gsm_depth_is_clipped_r_norm():
    c = canonical_columns(_read("GSM"), "GSM")
    m = row_mask(c, G, "GSM")
    d = geometric_depth({k: v[m] for k, v in c.items()}, G)
    assert np.nanmax(np.abs(d - np.clip(c["R_norm"][m], 0, 1))) < 1e-5


def test_rotating_the_atlas_reproduces_space_mango_at_another_clock():
    a, b = _read("PGSM"), _read("PGSM_clock37.5")
    assert a.height == b.height
    for cols in (("X_pgsm_norm", "Y_pgsm_norm", "Z_pgsm_norm"), ("Bx_pgsm", "By_pgsm", "Bz_pgsm"),
                 ("Vx_pgsm", "Vy_pgsm", "Vz_pgsm")):
        got = rotate_to_clock(a.select(cols).to_numpy(), 37.5, G.atlas_clock_deg)
        np.testing.assert_allclose(got, b.select(cols).to_numpy(), atol=1e-9)


def test_atlas_builds_from_real_rows(tmp_path):
    build_atlas({f: iter_polars(_read(f), f) for f in G.frames}, G, tmp_path, log=lambda *_: None)
    m, _, hours = read_atlas(tmp_path)
    assert m["stats"]["GSM"]["rows_kept"] > 0
    assert m["stats"]["PGSM"]["rows_in"] == 2 * (_read("PGSM")["bx_sign"] == 1).sum()
    assert hours["PGSM"]["n"].sum() > 0
