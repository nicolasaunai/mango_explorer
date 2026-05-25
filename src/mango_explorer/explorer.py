"""High-level entry points called by the frontend via Pyodide."""
from __future__ import annotations

import numpy as np

from . import data
from .boundaries import shue_mp, jelinek_bs, tessellate_surface
from .colormap import to_rgba, colorbar_info
from .gridding import bin_scattered_2d


def build_boundary(name: str, r0: float | None = None, alpha: float = 0.6,
                   pd: float = 2.0, n_theta: int = 50, n_phi: int = 64) -> dict:
    """Tessellate a boundary surface and return (positions, indices)."""
    if name == "mp":
        def r_of_theta(t):
            return shue_mp(t, r0=r0 if r0 is not None else 10.5, alpha=alpha)
        theta_max = np.pi * 0.85
    elif name == "bs":
        def r_of_theta(t):
            return jelinek_bs(t, pd=pd)
        theta_max = np.pi * 0.7
    else:
        raise ValueError(f"Unknown boundary '{name}'")

    pos, idx = tessellate_surface(r_of_theta, n_theta=n_theta, n_phi=n_phi,
                                  theta_max=theta_max)
    return {"positions": pos, "indices": idx}


def build_slice(plane: str, position: float, variable: str = "Np",
                extent: float = 25.0, n: int = 256,
                filters: dict | None = None) -> dict:
    df = data.get_data("magnetosheath", **(filters or {}))
    grid, mask = bin_scattered_2d(df, plane=plane, position=position,
                                  variable=variable, extent=extent, n=n)
    if mask.any():
        vmin = float(np.nanpercentile(grid[mask], 2))
        vmax = float(np.nanpercentile(grid[mask], 98))
    else:
        vmin, vmax = 0.0, 1.0
    rgba = to_rgba(grid, vmin=vmin, vmax=vmax, mask=mask)
    cb = colorbar_info(vmin, vmax)
    return {"rgba": rgba, "vmin": cb["vmin"], "vmax": cb["vmax"], "ticks": cb["ticks"]}


def build_events(missions: list[str] | None = None) -> dict:
    kwargs = {"mission": missions} if missions else {}
    df = data.get_data("events", **kwargs)
    pos = np.stack([
        df["X_gsm"].to_numpy(),
        df["Y_gsm"].to_numpy(),
        df["Z_gsm"].to_numpy(),
    ], axis=-1).astype(np.float32)
    meta = df.select(["id", "mission", "date", "type", "doi",
                      "title", "authors", "year", "journal"]).to_dicts()
    return {"positions": pos, "meta": meta}
