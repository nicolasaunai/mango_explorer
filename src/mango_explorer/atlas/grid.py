"""Binning contract (spec/grid-vN.json) as a typed, cached object."""
from __future__ import annotations

import json
from dataclasses import dataclass
from functools import cache
from importlib import resources

import numpy as np


def _edges(spec: dict) -> np.ndarray:
    if "edges" in spec:
        return np.asarray(spec["edges"], dtype=float)
    lo, hi, step = spec["edges_range"]
    return np.arange(lo, hi + step / 2, step, dtype=float)


@dataclass(frozen=True)
class Grid:
    raw: dict

    @property
    def version(self) -> str:
        return self.raw["version"]

    @property
    def d_edges(self) -> np.ndarray:
        return _edges(self.raw["spatial"]["D_msh"])

    @property
    def d_clip(self) -> tuple[float, float]:
        lo, hi = self.raw["spatial"]["D_msh"]["clip"]
        return float(lo), float(hi)

    @property
    def theta_edges(self) -> np.ndarray:
        return _edges(self.raw["spatial"]["theta_deg"])

    @property
    def phi_edges(self) -> np.ndarray:
        return _edges(self.raw["spatial"]["phi_deg"])

    @property
    def spatial_shape(self) -> tuple[int, int, int]:
        return (len(self.d_edges) - 1, len(self.theta_edges) - 1, len(self.phi_edges) - 1)

    @property
    def n_cells(self) -> int:
        nd, nt, nphi = self.spatial_shape
        return nd * nt * nphi

    @property
    def frames(self) -> tuple[str, ...]:
        return tuple(self.raw["frames"])

    @property
    def spacecraft(self) -> tuple[str, ...]:
        return tuple(self.raw["spacecraft"])

    @property
    def condition_names(self) -> tuple[str, ...]:
        return tuple(self.raw["conditions"])

    def condition_edges(self, name: str) -> np.ndarray:
        return _edges(self.raw["conditions"][name])

    def condition_is_periodic(self, name: str) -> bool:
        return bool(self.raw["conditions"][name].get("periodic", False))

    def cube_dims(self, cube_id: str) -> tuple[str, ...]:
        for cube in self.raw["cubes"]:
            if cube["id"] == cube_id:
                return tuple(cube["dims"])
        raise KeyError(f"unknown cube {cube_id!r}; known: {[c['id'] for c in self.raw['cubes']]}")

    def cube_shape(self, cube_id: str) -> tuple[int, ...]:
        return tuple(len(self.condition_edges(d)) - 1 for d in self.cube_dims(cube_id))

    @property
    def quantity_names(self) -> tuple[str, ...]:
        return tuple(self.raw["quantities"])

    @property
    def n_hist(self) -> int:
        return int(self.raw["histogram"]["n_bins"])

    def hist_axis_edges(self, quantity: str) -> np.ndarray:
        """Histogram edges in axis space (log10 of the value for log quantities)."""
        q = self.raw["quantities"][quantity]
        lo, hi = q["range"]
        if q["scale"] == "log":
            lo, hi = np.log10(lo), np.log10(hi)
        return np.linspace(lo, hi, self.n_hist + 1)

    def is_log(self, quantity: str) -> bool:
        return self.raw["quantities"][quantity]["scale"] == "log"

    def reference_radii(self):
        """(R_mp,ref(theta), R_bs,ref(theta)): the surfaces MANGO normalizes between; theta in radians."""
        from mango_explorer.boundaries import paraboloid_r

        ref = self.raw["reference_boundaries"]
        mp, bs = ref["magnetopause"], ref["bow_shock"]
        return (lambda t: paraboloid_r(t, mp["nose"], mp["p"])), (lambda t: paraboloid_r(t, bs["nose"], bs["p"]))

    @property
    def neff_interval_s(self) -> int:
        return int(self.raw["neff"]["interval_s"])


@cache
def load_grid(version: str = "grid-v2") -> Grid:
    text = resources.files("mango_explorer").joinpath("spec", f"{version}.json").read_text()
    return Grid(json.loads(text))
