"""Fit MANGO's normalization reference surfaces from the served normalized positions.

MANGO maps each magnetosheath sample radially between two fixed reference surfaces, so
|r_norm| = R_mp,ref(theta) + D (R_bs,ref(theta) - R_mp,ref(theta)). The exact surfaces are not
published with the data; this fits axisymmetric paraboloids x = x0 - rho^2 / (4 p) to every
spacecraft (random rows) and prints the parameters and residuals for grid-vN.json.

Run: .venv/bin/python scripts/fit_reference_boundaries.py   (uses the space_mango cache)
"""
from __future__ import annotations

import numpy as np
import space_mango as sm
from scipy.optimize import least_squares

from mango_explorer.boundaries import paraboloid_r

COLS = ["X_gsm_norm", "Y_gsm_norm", "Z_gsm_norm", "R_norm"]


def main(rows_per_sc: int = 400_000, seed: int = 0) -> None:
    rng = np.random.default_rng(seed)
    parts = []
    for sc in sm.spacecraft("magnetosheath")["sc"].to_list():
        df = sm.get_data("magnetosheath", columns=COLS, spacecraft=sc, normalized_only=True).to_polars()
        idx = rng.choice(df.height, min(rows_per_sc, df.height), replace=False)
        parts.append(df[idx].to_numpy())
        print(f"  {sc}: {df.height:,} rows, kept {len(idx):,}")
    a = np.concatenate(parts)
    x, y, z, d = a.T
    r = np.sqrt(x * x + y * y + z * z)
    th = np.arccos(x / r)

    def model(q, t, dd):
        rm, rb = paraboloid_r(t, q[0], q[1]), paraboloid_r(t, q[2], q[3])
        return rm + dd * (rb - rm)

    fit = least_squares(lambda q: model(q, th, d) - r, [10.4, 6.0, 13.4, 9.8], loss="soft_l1", f_scale=0.1)
    res = model(fit.x, th, d) - r
    print(f"magnetopause: nose {fit.x[0]:.4f}  p {fit.x[1]:.4f}")
    print(f"bow shock:    nose {fit.x[2]:.4f}  p {fit.x[3]:.4f}")
    q = np.percentile(np.abs(res), [50, 95, 99, 100])
    print(f"|residual| R_E: median {q[0]:.3f}  95% {q[1]:.3f}  99% {q[2]:.3f}  max {q[3]:.3f}  (n={len(r):,})")


if __name__ == "__main__":
    main()
