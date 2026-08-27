"""Resolve high-precision general matting ONNX (BiRefNet HR-matting)."""

from __future__ import annotations

import os
from pathlib import Path

HR_MATTING_FILENAME = "BiRefNet_HR-matting-epoch_135.onnx"
REMBG_HR_MATTING_URL = (
    "https://github.com/danielgatis/rembg/releases/download/v0.0.0/"
    f"{HR_MATTING_FILENAME}"
)

_PRECISION_ENV_KEYS = (
    "ILP_MATTING_ONNX",
    "ILP_MATTING_GENERAL_ONNX",
    "ILP_HR_MATTING_ONNX",
)


def _repo_models_dir() -> Path:
    return Path(__file__).resolve().parents[3] / "models"


def u2net_home() -> Path:
    raw = str(os.environ.get("U2NET_HOME", "") or "").strip()
    if raw:
        return Path(raw)
    return _repo_models_dir()


def _usable_onnx(path: Path) -> bool:
    """Reject empty / truncated CDN pulls; accept small fixture files for tests."""
    if not path.is_file():
        return False
    size = path.stat().st_size
    if size <= 0:
        return False
    name = path.name
    # Full HR weights are ~940MB–1GB; mid-download stubs must not win routing.
    if name == HR_MATTING_FILENAME and size < 500_000_000:
        return False
    if name == "BiRefNet_lite.onnx" and size < 50_000_000:
        return False
    return True


def _path_from_env(key: str) -> Path | None:
    raw = str(os.environ.get(key, "") or "").strip()
    if not raw:
        return None
    path = Path(raw)
    return path if _usable_onnx(path) else None


def _bundled_hr_matting() -> Path | None:
    for base in (u2net_home(), _repo_models_dir()):
        candidate = base / HR_MATTING_FILENAME
        if _usable_onnx(candidate):
            return candidate
        lite = base / "BiRefNet_lite.onnx"
        if _usable_onnx(lite):
            return lite
    return None


def resolve_preset_onnx(preset_env: str) -> Path | None:
    """Benchmark / fine-tune preset ONNX — does not fall back to production HR weights."""
    if not preset_env:
        return None
    return _path_from_env(preset_env)


def resolve_production_onnx() -> Path | None:
    """Default precision weights for general matting."""
    for key in _PRECISION_ENV_KEYS:
        found = _path_from_env(key)
        if found is not None:
            return found
    return _bundled_hr_matting()


def resolve_hr_matting_onnx() -> Path | None:
    """Alias kept for scripts and docs."""
    legacy = _path_from_env("ILP_MATTING_TRANSPARENT_ONNX")
    if legacy is not None:
        return legacy
    return resolve_production_onnx()


def hr_matting_download_dest() -> Path:
    return u2net_home() / HR_MATTING_FILENAME
