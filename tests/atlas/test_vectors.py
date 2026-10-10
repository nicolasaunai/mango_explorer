import numpy as np
import pytest

from mango_explorer.atlas.grid import load_grid
from mango_explorer.atlas.vectors import normalized_vectors, to_normalized

G = load_grid()
REF_MP, REF_BS = G.reference_radii()


def _sample(theta, phi, depth, a, b):
    """A sample at depth `depth` between boundaries a*R*_mp and b*R*_bs (approximation A1 holds exactly)."""
    mp, bs = a * REF_MP(theta), b * REF_BS(theta)
    rn = REF_MP(theta) + depth * (REF_BS(theta) - REF_MP(theta))
    d = np.array([np.cos(theta), np.sin(theta) * np.cos(phi), np.sin(theta) * np.sin(phi)])
    return rn * d, mp, bs


def _tangent(f, theta, phi, h=1e-6):
    """d/dtheta of the surface point f(theta) * r_hat(theta, phi): a tangent in the meridian plane."""
    def pt(t):
        return f(t) * np.array([np.cos(t), np.sin(t) * np.cos(phi), np.sin(t) * np.sin(phi)])
    return (pt(theta + h) - pt(theta - h)) / (2 * h)


def _map(v, xyz, depth, mp, bs):
    return to_normalized(np.atleast_2d(v), xyz[None], np.array([depth]), np.array([mp]), np.array([bs]), G)[0]


@pytest.mark.parametrize("theta", [0.3, 0.9, 1.5])
@pytest.mark.parametrize("which", ["mp", "bs"])
def test_tangent_to_the_sample_boundary_maps_tangent_to_the_reference(theta, which):
    a, b, phi = 0.9, 1.15, 0.7
    depth = 0.0 if which == "mp" else 1.0
    xyz, mp, bs = _sample(theta, phi, depth, a, b)
    sample = (lambda t: a * REF_MP(t)) if which == "mp" else (lambda t: b * REF_BS(t))
    ref = REF_MP if which == "mp" else REF_BS
    out, want = _map(_tangent(sample, theta, phi), xyz, depth, mp, bs), _tangent(ref, theta, phi)
    assert out @ want / np.linalg.norm(out) / np.linalg.norm(want) == pytest.approx(1.0, abs=1e-6)


def test_radial_vector_stays_radial_and_scales_with_the_sheath_thickness():
    theta, phi, depth, a, b = 0.6, 2.0, 0.4, 0.9, 1.2
    xyz, mp, bs = _sample(theta, phi, depth, a, b)
    er = xyz / np.linalg.norm(xyz)
    k = (REF_BS(theta) - REF_MP(theta)) / (bs - mp)
    np.testing.assert_allclose(_map(3.0 * er, xyz, depth, mp, bs), 3.0 * k * er, rtol=1e-9, atol=1e-12)


def test_identity_when_the_sample_boundaries_are_the_reference():
    rng = np.random.default_rng(3)
    for _ in range(20):
        theta, phi, depth = rng.uniform(0, 1.9), rng.uniform(0, 2 * np.pi), rng.uniform(0, 1)
        xyz, mp, bs = _sample(theta, phi, depth, 1.0, 1.0)
        v = rng.normal(0, 100, 3)
        np.testing.assert_allclose(_map(v, xyz, depth, mp, bs), v, rtol=1e-6, atol=1e-6)


def test_subsolar_point_gives_finite_vectors():
    xyz, mp, bs = _sample(0.0, 0.0, 0.5, 0.9, 1.1)
    assert np.all(np.isfinite(_map([-300.0, 20.0, 10.0], xyz, 0.5, mp, bs)))


def test_missing_boundaries_give_nan_vectors():
    xyz, _, bs = _sample(0.5, 0.0, 0.5, 1.0, 1.0)
    assert np.all(np.isnan(_map([1.0, 0.0, 0.0], xyz, 0.5, np.nan, bs)))


def test_normalized_vectors_without_boundary_columns_are_nan():
    cols = {c: np.ones(3) for c in ("Vx", "Vy", "Vz", "Bx", "By", "Bz", "R_norm")}
    cols |= {"X": np.full(3, 12.0), "Y": np.zeros(3), "Z": np.zeros(3)}
    out = normalized_vectors(cols, G)
    assert set(out) == {"V_vec", "B_vec"} and np.all(np.isnan(out["V_vec"]))


def test_build_counts_rows_with_vectors_and_warns_when_few(tmp_path):
    import polars as pl

    from mango_explorer.atlas.pipeline import build_atlas
    from mango_explorer.atlas.prepare import prepare
    from mango_explorer.atlas.sources import canonical_columns, iter_polars
    from mango_explorer.atlas.store import read_atlas
    from mango_explorer.atlas.synthetic import synthetic_frame, synthetic_magnetosheath

    df = synthetic_magnetosheath(20_000, seed=5)
    for frac, warned in ((0.0, False), (0.2, True)):
        r_mp = df["R_mp"].to_numpy().copy()
        r_mp[np.random.default_rng(6).random(len(r_mp)) < frac] = np.nan
        rows = synthetic_frame(df.with_columns(pl.Series("R_mp", r_mp)), "PGSM")
        prep = prepare(canonical_columns(rows, "PGSM"), G, "PGSM")
        want = int(np.all([np.isfinite(v).all(axis=1) for v in prep.vectors.values()], axis=0).sum())
        lines = []
        out = tmp_path / f"f{frac}"
        build_atlas({"PGSM": iter_polars(rows, "PGSM", 7_000)}, G, out, log=lines.append)
        stats = read_atlas(out)[0]["stats"]["PGSM"]
        assert stats["rows_with_vectors"] == want
        assert (want < stats["rows_kept"]) == (frac > 0)
        assert any("rows_with_vectors" in str(m) for m in lines) == warned
