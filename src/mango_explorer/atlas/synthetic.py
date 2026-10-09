"""Synthetic magnetosheath rows with the MANGO schema, for tests and offline development.

The physics is a caricature (compression rising toward the magnetopause, a hotter quasi-parallel
side); it exists so that pipelines and the web app can be exercised without the real dataset.
"""
from __future__ import annotations

import numpy as np

_SAMPLES_PER_PASS = 720  # one hour at 5 s


def synthetic_magnetosheath(n_rows: int = 100_000, seed: int = 0,
                            spacecraft=("THA", "C1", "MMS")):
    import polars as pl

    rng = np.random.default_rng(seed)
    n_pass = max(1, n_rows // _SAMPLES_PER_PASS)
    n = n_pass * _SAMPLES_PER_PASS
    per = lambda a: np.repeat(a, _SAMPLES_PER_PASS)
    s = np.tile(np.linspace(0.0, 1.0, _SAMPLES_PER_PASS), n_pass)

    start = (np.datetime64("2001-01-01T00:00:00") +
             rng.integers(0, 20 * 365 * 24, n_pass).astype("timedelta64[h]"))
    time = per(start) + np.tile(np.arange(_SAMPLES_PER_PASS) * 5, n_pass).astype("timedelta64[s]")
    sc = np.asarray(spacecraft, dtype=object)[per(rng.integers(0, len(spacecraft), n_pass))]

    clock = per(rng.uniform(0, 2 * np.pi, n_pass))
    cone = per(np.arccos(rng.uniform(0, 1, n_pass)))
    bmag = per(rng.lognormal(np.log(5.0), 0.4, n_pass))
    bx_sign = per(np.where(rng.random(n_pass) < 0.5, -1.0, 1.0))
    bx_imf = bx_sign * bmag * np.cos(cone)
    by_imf = bmag * np.sin(cone) * np.sin(clock)
    bz_imf = bmag * np.sin(cone) * np.cos(clock)
    np_sw = per(rng.lognormal(np.log(5.0), 0.5, n_pass))
    vx_sw = per(-rng.normal(430.0, 80.0, n_pass))
    vy_sw = per(rng.normal(0.0, 20.0, n_pass))
    vz_sw = per(rng.normal(0.0, 20.0, n_pass))
    tp_sw = per(rng.lognormal(np.log(1e5), 0.5, n_pass))
    ma_sw = per(rng.lognormal(np.log(8.0), 0.4, n_pass))
    beta_sw = per(rng.lognormal(np.log(1.0), 0.7, n_pass))
    pd_sw = 1.6726e-6 * np_sw * (vx_sw**2 + vy_sw**2 + vz_sw**2)

    theta = per(rng.uniform(0, 1.9, n_pass)) + s * per(rng.normal(0, 0.15, n_pass))
    phi = per(rng.uniform(0, 2 * np.pi, n_pass)) + s * per(rng.normal(0, 0.2, n_pass))
    d = np.clip(per(rng.uniform(-0.05, 1.05, n_pass)) + s * per(rng.normal(0, 0.3, n_pass)),
                -0.12, 1.12)
    theta = np.abs(theta)
    from mango_explorer.atlas.grid import load_grid

    ref_mp, ref_bs = load_grid().reference_radii()
    r_mp, r_bs = ref_mp(theta), ref_bs(theta)
    r = r_mp + d * (r_bs - r_mp)
    x, y, z = r * np.cos(theta), r * np.sin(theta) * np.cos(phi), r * np.sin(theta) * np.sin(phi)

    # quasi-parallel side: where the local shock normal (~ radial) is close to the IMF
    b_hat = np.stack([bx_imf, by_imf, bz_imf]) / bmag
    qpar = np.abs((x * b_hat[0] + y * b_hat[1] + z * b_hat[2]) / r) > np.cos(np.radians(45))
    compression = (1.5 + 2.5 * (1 - np.clip(d, 0, 1))) * rng.lognormal(0, 0.15, n)
    np_local = np_sw * compression * np.where(qpar, 1.2, 1.0)
    tp_local = tp_sw * (5 + 10 * (1 - np.clip(d, 0, 1))) * np.where(qpar, 1.6, 1.0)
    b_local = compression * np.stack([bx_imf, by_imf, bz_imf])
    v_scale = 0.25 + 0.6 * np.clip(d, 0, 1) + 0.3 * np.sin(theta)

    scale = np.random.default_rng(seed + 1000)   # separate stream: existing values stay identical
    a_mp = per(scale.lognormal(0.0, 0.06, n_pass))
    a_bs = per(scale.lognormal(0.0, 0.06, n_pass))

    def nan_some(a, frac=0.003):
        a = a.copy()
        a[rng.random(n) < frac] = np.nan
        return a

    return pl.DataFrame({
        "Time": time.astype("datetime64[ns]"), "SC": sc.astype(str),
        "Bx": b_local[0], "By": b_local[1], "Bz": b_local[2], "Np": np_local,
        "Vx": vx_sw * v_scale, "Vy": vy_sw * v_scale + 50 * np.sin(phi) * np.sin(theta),
        "Vz": vz_sw * v_scale + 50 * np.cos(phi) * np.sin(theta), "Tp": tp_local,
        "Bx_imf": nan_some(bx_imf), "By_imf": by_imf, "Bz_imf": bz_imf, "Np_sw": np_sw,
        "Vx_sw": vx_sw, "Vy_sw": vy_sw, "Vz_sw": vz_sw, "Tp_sw": tp_sw, "Pd_sw": pd_sw,
        "Beta_sw": beta_sw, "Ma_sw": ma_sw,
        "R_norm": d, "R_mp": a_mp * r_mp, "R_bs": a_bs * r_bs, "Norma_pos": np.ones(n, dtype=bool), "SW_pairing": np.ones(n, dtype=bool),
        "X_gsm_norm": x, "Y_gsm_norm": y, "Z_gsm_norm": z,
    })


def synthetic_frame(df, frame: str):
    """What space_mango returns for `frame` (the atlas columns), from synthetic_magnetosheath rows.

    GSM: the paired, normalized rows. PGSM at clock 0 with cone=[0, 180]: a caricature of MANGO's
    transform that holds when V_sw is along -X (synthetic V_sw is within a few degrees of it). Each row
    appears twice. bx_sign = +1: the row turned about X so that the IMF lies in the X-Z plane with
    Bx > 0 and Bz > 0 (B -> -B when Bx_imf < 0, as SWI does), cone f = arccos(|Bx_imf|/|B_imf|).
    bx_sign = -1: its mirror Z -> -Z (positions, V), B -> (-Bx, -By, Bz), cone 180 - f.
    """
    import polars as pl

    from mango_explorer.atlas.columns import (
        FRAME_COLUMNS,
        GSM_COLUMNS,
        PGSM_B_IMF,
        PGSM_CONE,
        PGSM_V_SW,
    )

    d = df.filter(pl.col("SW_pairing") & pl.col("Norma_pos"))
    if frame == "GSM":
        return d.select(GSM_COLUMNS)
    if frame != "PGSM":
        raise ValueError(f"unknown frame {frame!r}")
    c = {k: d[k].to_numpy() for k in d.columns}
    bx, by, bz = c["Bx_imf"], c["By_imf"], c["Bz_imf"]
    b_imf = np.sqrt(bx**2 + by**2 + bz**2)
    with np.errstate(invalid="ignore", divide="ignore"):
        f = np.degrees(np.arccos(np.clip(np.abs(bx) / b_imf, 0.0, 1.0)))
    keep = np.isfinite(f)
    c = {k: v[keep] for k, v in c.items()}
    bx, by, bz, b_imf, f = bx[keep], by[keep], bz[keep], b_imf[keep], f[keep]
    neg = bx < 0
    angle = np.arctan2(by, bz) + np.pi * neg          # azimuth atan2(z, y) increases by `angle`
    ca, sa = np.cos(angle), np.sin(angle)
    rot = lambda y, z: (y * ca - z * sa, y * sa + z * ca)
    y, z = rot(c["Y_gsm_norm"], c["Z_gsm_norm"])
    vy, vz = rot(c["Vy"], c["Vz"])
    sgn = np.where(neg, -1.0, 1.0)
    b_y, b_z = rot(c["By"], c["Bz"])
    b = (sgn * c["Bx"], sgn * b_y, sgn * b_z)
    scalars = {k: c[k] for k in FRAME_COLUMNS["PGSM"][:12]}  # Time ... R_bs
    scalars[PGSM_V_SW] = np.sqrt(c["Vx_sw"] ** 2 + c["Vy_sw"] ** 2 + c["Vz_sw"] ** 2)
    scalars[PGSM_B_IMF] = b_imf

    def copy(s: int):
        m = float(s)
        return pl.DataFrame({
            **scalars, PGSM_CONE: f if s > 0 else 180.0 - f,
            "X_pgsm_norm": c["X_gsm_norm"], "Y_pgsm_norm": y, "Z_pgsm_norm": m * z,
            "Bx_pgsm": m * b[0], "By_pgsm": m * b[1], "Bz_pgsm": b[2],
            "Vx_pgsm": c["Vx"], "Vy_pgsm": vy, "Vz_pgsm": m * vz,
            "bx_sign": np.full(len(f), s, dtype=np.int8), "mirrored": np.where(neg, 1, -1) == s,
        })

    return pl.concat([copy(1), copy(-1)]).sort("Time", maintain_order=True)
