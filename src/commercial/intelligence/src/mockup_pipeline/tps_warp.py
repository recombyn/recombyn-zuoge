"""Thin Plate Spline (TPS) non-rigid warp grid generation."""

from __future__ import annotations

import numpy as np


def _tps_kernel(r: np.ndarray) -> np.ndarray:
    with np.errstate(divide="ignore", invalid="ignore"):
        out = r * r * np.log(np.maximum(r, 1e-10))
    out[~np.isfinite(out)] = 0.0
    return out


def _solve_tps(points: np.ndarray, values: np.ndarray, *, reg: float = 1e-6) -> np.ndarray:
    """Solve TPS coefficients for scalar or vector values."""
    n = points.shape[0]
    diff = points[:, None, :] - points[None, :, :]
    r = np.linalg.norm(diff, axis=-1)
    k = _tps_kernel(r)
    k.flat[:: n + 1] += reg
    p = np.concatenate([np.ones((n, 1), dtype=np.float64), points.astype(np.float64)], axis=1)
    l = np.zeros((n + 3, n + 3), dtype=np.float64)
    l[:n, :n] = k
    l[:n, n:] = p
    l[n:, :n] = p.T
    y = np.zeros((n + 3, values.shape[1]), dtype=np.float64)
    y[:n] = values.astype(np.float64)
    return np.linalg.solve(l, y)


def tps_evaluate(
    points: np.ndarray,
    coeffs: np.ndarray,
    query: np.ndarray,
) -> np.ndarray:
    """Evaluate TPS field at query positions (m, 2) → (m, d)."""
    n = points.shape[0]
    w = coeffs[:n]
    a = coeffs[n:]
    diff = query[:, None, :] - points[None, :, :]
    r = np.linalg.norm(diff, axis=-1)
    u = _tps_kernel(r)
    return query @ a[1:].T + a[0] + u @ w


def build_tps_uv_map(
    height: int,
    width: int,
    control_xy: np.ndarray,
    control_uv: np.ndarray,
) -> np.ndarray:
    """
    Interpolate dense UV from sparse surface control points.

    control_xy: (N, 2) pixel coords on template (x, y)
    control_uv: (N, 2) normalized texture coords (u, v) in [0, 1]
    """
    if control_xy.shape[0] < 4:
        raise ValueError("TPS requires at least 4 control points")
    coeffs = _solve_tps(control_xy, control_uv)
    ys, xs = np.mgrid[0:height, 0:width].astype(np.float64)
    grid = np.stack([xs.ravel(), ys.ravel()], axis=-1)
    uv = tps_evaluate(control_xy.astype(np.float64), coeffs, grid)
    uv = np.clip(uv.reshape(height, width, 2), 0.0, 1.0).astype(np.float32)
    return uv


def default_cylinder_tps_controls(
    width: int,
    height: int,
    *,
    curve_factor: float = 0.25,
) -> tuple[np.ndarray, np.ndarray]:
    """Sparse TPS landmarks for a cylindrical printable area."""
    return cylinder_tps_controls_in_rect(0, 0, width, height, curve_factor=curve_factor)


def cylinder_tps_controls_in_rect(
    x0: float,
    y0: float,
    rw: float,
    rh: float,
    *,
    curve_factor: float = 0.25,
) -> tuple[np.ndarray, np.ndarray]:
    """Sparse TPS landmarks centered on a printable bbox (pixel coords)."""
    cx, cy = x0 + rw * 0.5, y0 + rh * 0.52
    rx, ry = rw * 0.42, rh * 0.40
    angles = np.linspace(-np.pi * 0.45, np.pi * 0.45, 9)
    xy: list[list[float]] = []
    uv: list[list[float]] = []
    for a in angles:
        x = cx + rx * np.sin(a)
        y = cy + ry * np.cos(a) * 0.88
        u = (a / np.pi + 1.0) / 2.0
        v = 0.5 + curve_factor * (1.0 - (np.sin(a)) ** 2) * 0.08
        xy.append([x, y])
        uv.append([float(np.clip(u, 0.0, 1.0)), float(np.clip(v, 0.0, 1.0))])
    for x, y, u, v in [
        (cx - rx, cy, 0.05, 0.5),
        (cx + rx, cy, 0.95, 0.5),
        (cx, cy - ry * 0.7, 0.5, 0.12),
        (cx, cy + ry * 0.7, 0.5, 0.88),
    ]:
        xy.append([x, y])
        uv.append([u, v])
    return np.asarray(xy, dtype=np.float32), np.asarray(uv, dtype=np.float32)
