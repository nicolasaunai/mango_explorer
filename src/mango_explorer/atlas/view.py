"""How the explorer shows PGSM at a target clock (grid spec "pgsm.rotation"); the web app's
core/frames.ts is checked against this module through golden/core.json."""
from __future__ import annotations

import numpy as np


def rotate_to_clock(xyz, clock_deg: float, atlas_clock_deg: float = 0.0) -> np.ndarray:
    """PGSM rows held at `atlas_clock_deg`, as space_mango gives them at `clock_deg`:
    (Y, Z) -> (Y cos a + Z sin a, -Y sin a + Z cos a), a = clock - atlas clock."""
    xyz = np.atleast_2d(np.asarray(xyz, dtype=float))
    a = np.radians(clock_deg - atlas_clock_deg)
    c, s = np.cos(a), np.sin(a)
    return np.stack([xyz[:, 0], xyz[:, 1] * c + xyz[:, 2] * s, -xyz[:, 1] * s + xyz[:, 2] * c], axis=1)


def imf_direction(clock_deg: float, cone_deg: float) -> np.ndarray:
    """IMF unit vector: clock atan2(By, Bz) (0 = northward, 90 = +Y), cone arccos(Bx/|B|) (0 = sunward)."""
    c, t = np.radians(clock_deg), np.radians(cone_deg)
    return np.array([np.cos(t), np.sin(t) * np.sin(c), np.sin(t) * np.cos(c)])
