"""Deterministic synthetic MANGO-shaped source for the POC."""
from __future__ import annotations

import datetime as _dt
from typing import Any, Final

import numpy as np

from .base import Source
from ..boundaries import shue_mp, jelinek_bs
from ..papers import EVENT_TYPES, PAPERS

_SPACECRAFT: Final = ["MMS1", "THA", "C1"]

# Filter catalog: (name, column, unit, description)
_FILTER_CATALOG: Final = [
    ("bz_imf", "Bz_imf", "nT",   "IMF Bz (GSM)"),
    ("by_imf", "By_imf", "nT",   "IMF By (GSM)"),
    ("pd_sw",  "Pd_sw",  "nPa",  "Solar wind dynamic pressure"),
    ("ma_sw",  "Ma_sw",  "",     "Solar wind Alfvén Mach number"),
    ("vx_sw",  "Vx_sw",  "km/s", "Solar wind Vx (GSM)"),
    ("np_sw",  "Np_sw",  "cm-3", "Solar wind proton density"),
]


def _compression_ratio(mach: np.ndarray, gamma: float = 5.0 / 3.0) -> np.ndarray:
    m2 = mach * mach
    return ((gamma + 1.0) * m2) / ((gamma - 1.0) * m2 + 2.0)


def _mask_dict(data: dict[str, Any], mask: np.ndarray) -> dict[str, Any]:
    result = {}
    for k, v in data.items():
        if isinstance(v, np.ndarray):
            result[k] = v[mask]
        else:
            result[k] = [item for item, m in zip(v, mask) if m]
    return result


class FakeSource(Source):
    """Deterministic fake MANGO data source."""

    def __init__(self, seed: int = 42, n_points: int = 50_000):
        self.seed = seed
        self.n_points = n_points
        self._cache: dict[str, dict[str, Any]] = {}

    def regions(self) -> list[str]:
        return ["magnetosheath", "events"]

    def filters(self, region: str) -> list[dict]:
        if region == "magnetosheath":
            return [
                {"name": n, "column": c, "unit": u, "description": d,
                 "params": f"{n}_min=..&{n}_max=.."}
                for (n, c, u, d) in _FILTER_CATALOG
            ]
        if region == "events":
            return []
        raise ValueError(f"Unknown region: {region}")

    def columns(self, region: str) -> list[str]:
        if region == "magnetosheath":
            return list(self._magnetosheath().keys())
        if region == "events":
            return list(self._events().keys())
        raise ValueError(f"Unknown region: {region}")

    def get_data(self, region: str, **kwargs) -> dict[str, Any]:
        if region == "magnetosheath":
            return self._apply_filters(self._magnetosheath(), kwargs)
        if region == "events":
            return self._apply_event_filters(self._events(), kwargs)
        raise ValueError(f"Unknown region: {region}")

    def _magnetosheath(self) -> dict[str, Any]:
        if "magnetosheath" in self._cache:
            return self._cache["magnetosheath"]

        rng = np.random.default_rng(self.seed)
        n = self.n_points

        theta = np.arccos(1.0 - 0.85 * rng.random(n))
        phi = rng.uniform(0.0, 2.0 * np.pi, n)
        d = rng.uniform(0.0, 1.0, n)

        ma_sw = np.clip(rng.lognormal(mean=np.log(6.0), sigma=0.3, size=n), 1.0, 12.0)
        pd_sw = np.clip(0.5 + 0.4 * (ma_sw - 6.0) + rng.normal(0.0, 0.5, n), 0.3, 12.0)
        bz_imf = rng.normal(0.0, 4.0, n)
        by_imf = rng.normal(0.0, 4.0, n)
        bx_imf = rng.normal(0.0, 3.0, n)
        np_sw = np.clip(rng.lognormal(mean=np.log(5.0), sigma=0.4, size=n), 0.5, 50.0)
        tp_sw = np.clip(rng.lognormal(mean=np.log(1e5), sigma=0.3, size=n), 1e3, 1e7)
        vx_sw = -np.clip(rng.normal(450.0, 80.0, n), 250.0, 900.0)
        beta_sw = np.clip(rng.lognormal(mean=np.log(1.0), sigma=0.5, size=n), 0.05, 20.0)
        tilt = rng.uniform(-30.0, 30.0, n)

        r_mp = shue_mp(theta, r0=10.5, alpha=0.6)
        r_bs = jelinek_bs(theta, pd=2.0)
        r = r_bs * (1.0 - d) + r_mp * d

        x = r * np.cos(theta)
        y = r * np.sin(theta) * np.cos(phi)
        z = r * np.sin(theta) * np.sin(phi)

        n_sw_base = 5.0
        comp = _compression_ratio(ma_sw)
        stagnation = 1.0 + 1.2 * d ** 1.5
        angular = 0.6 + 0.4 * np.clip(np.cos(theta), 0.0, 1.0) ** 0.5
        local_np = n_sw_base * comp * stagnation * angular

        local_tp = tp_sw * (1.0 + 8.0 * d)
        local_bz = bz_imf * (1.5 + 0.5 * d) + rng.normal(0.0, 0.5, n)

        t0 = _dt.datetime(2015, 1, 1)
        t1 = _dt.datetime(2024, 12, 31)
        dt = (t1 - t0).total_seconds()
        times = np.array([t0 + _dt.timedelta(seconds=float(s))
                          for s in rng.uniform(0.0, dt, n)], dtype=object)

        sc = rng.choice(_SPACECRAFT, size=n).astype(object)

        data: dict[str, Any] = {
            "Time": times,
            "spacecraft": sc,
            "X_gsm": x.astype(np.float32),
            "Y_gsm": y.astype(np.float32),
            "Z_gsm": z.astype(np.float32),
            "D_msh": d.astype(np.float32),
            "Np": local_np.astype(np.float32),
            "Tp": local_tp.astype(np.float32),
            "Bz": local_bz.astype(np.float32),
            "Bx_imf": bx_imf.astype(np.float32),
            "By_imf": by_imf.astype(np.float32),
            "Bz_imf": bz_imf.astype(np.float32),
            "Pd_sw": pd_sw.astype(np.float32),
            "Np_sw": np_sw.astype(np.float32),
            "Tp_sw": tp_sw.astype(np.float32),
            "Vx_sw": vx_sw.astype(np.float32),
            "Beta_sw": beta_sw.astype(np.float32),
            "Ma_sw": ma_sw.astype(np.float32),
            "Tilt": tilt.astype(np.float32),
        }
        self._cache["magnetosheath"] = data
        return data

    def _apply_filters(self, data: dict[str, Any], kwargs: dict) -> dict[str, Any]:
        name_to_col = {n: c for (n, c, _u, _d) in _FILTER_CATALOG}
        n = len(data["X_gsm"])
        mask = np.ones(n, dtype=bool)
        for key, val in kwargs.items():
            if key.endswith("_min"):
                name = key[:-4]
                if name not in name_to_col:
                    raise ValueError(f"Unknown filter '{name}'")
                mask &= data[name_to_col[name]] >= val
            elif key.endswith("_max"):
                name = key[:-4]
                if name not in name_to_col:
                    raise ValueError(f"Unknown filter '{name}'")
                mask &= data[name_to_col[name]] <= val
            else:
                raise ValueError(f"Filter kwargs must end with _min or _max; got {key}")
        return _mask_dict(data, mask)

    def _events(self) -> dict[str, Any]:
        if "events" in self._cache:
            return self._cache["events"]
        rng = np.random.default_rng(self.seed + 1)

        # Physical placement rules per event type:
        #   theta_range: (min, max) radians — controls which part of boundary
        #   d_range: fractional depth in magnetosheath (0=BS, 1=MP); None = on MP
        _PLACEMENT = {
            "FTE":           {"theta": (0.0, np.pi * 0.55), "d": (0.85, 1.05)},  # near MP, subsolar
            "EDR":           {"theta": (0.0, np.pi * 0.40), "d": (0.90, 1.05)},  # on MP, strongly subsolar
            "Jet":           {"theta": (0.0, np.pi * 0.50), "d": (0.55, 0.85)},  # magnetosheath near MP
            "Current Sheet": {"theta": (0.0, np.pi * 0.65), "d": (0.80, 1.05)},  # on/just inside MP
            "KH Wave":       {"theta": (np.pi * 0.50, np.pi * 0.80), "d": (0.88, 1.05)},  # flanks of MP
            "Mirror Mode":   {"theta": (0.0, np.pi * 0.70), "d": (0.20, 0.75)},  # deep magnetosheath
        }

        # Mission orbital/science biases: (preferred event types, theta_max, year range)
        _MISSIONS = {
            "MMS":    {"types": ["FTE", "EDR", "Current Sheet", "Jet"],
                       "theta_max": np.pi * 0.55, "years": (2015, 2024), "count": 25},
            "THEMIS": {"types": ["FTE", "Jet", "Mirror Mode", "KH Wave"],
                       "theta_max": np.pi * 0.75, "years": (2007, 2024), "count": 20},
            "Cluster":{"types": ["FTE", "KH Wave", "Mirror Mode", "Current Sheet"],
                       "theta_max": np.pi * 0.75, "years": (2001, 2020), "count": 15},
        }

        rows: list[dict] = []
        eid = 0
        for mission, cfg in _MISSIONS.items():
            yr0, yr1 = cfg["years"]
            for _ in range(cfg["count"]):
                etype = cfg["types"][int(rng.integers(0, len(cfg["types"])))]
                pl = _PLACEMENT[etype]

                theta_lo = pl["theta"][0]
                theta_hi = min(pl["theta"][1], cfg["theta_max"])
                theta = rng.uniform(theta_lo, theta_hi)
                phi = rng.uniform(0.0, 2.0 * np.pi)

                # d=1 → on MP, d=0 → on BS; allow slight overshoot (d>1) for MP-grazing
                d = np.clip(rng.uniform(pl["d"][0], pl["d"][1]), 0.0, 1.1)
                r_mp = float(shue_mp(theta, r0=10.5, alpha=0.6))
                r_bs = float(jelinek_bs(theta, pd=2.0))
                r = r_bs + d * (r_mp - r_bs)  # d=0→BS, d=1→MP
                r = float(np.clip(r, r_mp - 0.5, r_bs + 0.5))

                year = int(rng.integers(yr0, yr1 + 1))
                month = int(rng.integers(1, 13))
                day = int(rng.integers(1, 29))
                paper = rng.choice(PAPERS[etype])
                eid += 1
                rows.append({
                    "id": f"{mission}-{year:04d}{month:02d}{day:02d}-{eid:03d}",
                    "mission": mission,
                    "date": f"{year:04d}-{month:02d}-{day:02d}",
                    "type": etype,
                    "X_gsm": float(r * np.cos(theta)),
                    "Y_gsm": float(r * np.sin(theta) * np.cos(phi)),
                    "Z_gsm": float(r * np.sin(theta) * np.sin(phi)),
                    "doi": paper["doi"],
                    "title": paper["title"],
                    "authors": paper["authors"],
                    "year": int(paper["year"]),
                    "journal": paper["journal"],
                })

        keys = list(rows[0].keys())
        data: dict[str, Any] = {k: np.array([row[k] for row in rows]) for k in keys}
        self._cache["events"] = data
        return data

    def _apply_event_filters(self, data: dict[str, Any], kwargs: dict) -> dict[str, Any]:
        n = len(data["mission"])
        mask = np.ones(n, dtype=bool)
        for k, v in kwargs.items():
            if k == "mission":
                mask &= np.isin(data["mission"], list(v))
            else:
                raise ValueError(f"Unknown events filter: {k}")
        return _mask_dict(data, mask)
