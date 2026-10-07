"""Coordinate frames used by the explorer. Every rotation is about X_GSM.

The boundary-normalized reference surfaces are axisymmetric about X_GSM, so rotating a
normalized position about X leaves its depth D_msh and polar angle theta unchanged: only the
azimuth phi moves. This is what makes a per-sample rotation exact in normalized space.
"""
from __future__ import annotations

import numpy as np

FRAMES = ("GSM", "PGSM", "PGSM_fold")


def clock_angle_deg(by, bz):
    """IMF clock angle atan2(By, Bz) in [0, 360): 0 = northward, 90 = +By."""
    return np.degrees(np.arctan2(by, bz)) % 360.0


def cone_angle_deg(bx, by, bz):
    """IMF cone angle arccos(|Bx|/|B|) in [0, 90]: 0 = radial IMF."""
    b = np.sqrt(np.square(bx) + np.square(by) + np.square(bz))
    with np.errstate(invalid="ignore", divide="ignore"):
        return np.degrees(np.arccos(np.clip(np.abs(bx) / b, 0.0, 1.0)))


def rotate_about_x(y, z, angle_rad):
    """Rotate (y, z) by +angle about X: the azimuth atan2(z, y) increases by angle."""
    c, s = np.cos(angle_rad), np.sin(angle_rad)
    return y * c - z * s, y * s + z * c


def frame_angle_rad(frame: str, bx_imf, by_imf, bz_imf):
    """Rotation angle about X that takes GSM to `frame`, per sample, and the polarity flip mask.

    PGSM: angle = clock angle, which maps the IMF (By, Bz) onto (0, +|B_perp|).
    PGSM_fold: for Bx_imf < 0 add pi and flip magnetic vectors (B -> -B), so the IMF ends up
    in the X-Z plane with Bx > 0 and Bz > 0 for every sample.
    """
    by_imf = np.asarray(by_imf, dtype=float)
    if frame == "GSM":
        return np.zeros_like(by_imf), np.zeros(by_imf.shape, dtype=bool)
    clock = np.arctan2(by_imf, np.asarray(bz_imf, dtype=float))
    if frame == "PGSM":
        return clock, np.zeros(by_imf.shape, dtype=bool)
    if frame == "PGSM_fold":
        flip = np.asarray(bx_imf, dtype=float) < 0
        return clock + np.pi * flip, flip
    raise ValueError(f"unknown frame {frame!r}; expected one of {FRAMES}")


def vector_to_frame(frame: str, vx, vy, vz, *, magnetic: bool, bx_imf, by_imf, bz_imf):
    """Express a GSM vector (position, velocity, or magnetic field) in `frame`."""
    angle, flip = frame_angle_rad(frame, bx_imf, by_imf, bz_imf)
    vx = np.asarray(vx, dtype=float)
    y, z = rotate_about_x(np.asarray(vy, dtype=float), np.asarray(vz, dtype=float), angle)
    if magnetic:
        sign = np.where(flip, -1.0, 1.0)
        return vx * sign, y * sign, z * sign
    return vx.copy(), y, z


def azimuth_in_frame_deg(frame: str, y_gsm, z_gsm, *, bx_imf, by_imf, bz_imf):
    """Azimuth atan2(Z, Y) of a GSM position, expressed in `frame`, in [0, 360)."""
    angle, _ = frame_angle_rad(frame, bx_imf, by_imf, bz_imf)
    return (np.degrees(np.arctan2(z_gsm, y_gsm) + angle)) % 360.0


def polar_angle_deg(x, y, z):
    """Angle from +X, in degrees."""
    r = np.sqrt(np.square(x) + np.square(y) + np.square(z))
    with np.errstate(invalid="ignore", divide="ignore"):
        return np.degrees(np.arccos(np.clip(x / r, -1.0, 1.0)))
