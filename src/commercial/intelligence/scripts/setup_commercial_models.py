#!/usr/bin/env python3
"""Download / verify commercial vision model weights for Intelligence."""

from __future__ import annotations

import argparse
import json
import os
import sys
import urllib.request
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[1]
MODELS = REPO_ROOT / "models"


def _download(url: str, dest: Path) -> None:
    dest.parent.mkdir(parents=True, exist_ok=True)
    print(f"downloading {url} -> {dest}")
    urllib.request.urlretrieve(url, dest)  # noqa: S310


def ensure_esrgan(*, force: bool = False) -> Path | None:
    env_path = str(os.environ.get("ILP_ESRGAN_MODEL_PATH", "") or "").strip()
    if env_path:
        p = Path(env_path)
        if p.is_file():
            return p
    dest = MODELS / "RealESRGAN_x4plus.onnx"
    if dest.is_file() and not force:
        return dest
    url = str(os.environ.get("ILP_ESRGAN_DOWNLOAD_URL", "") or "").strip()
    if not url:
        print(
            "skip Real-ESRGAN download: set ILP_ESRGAN_DOWNLOAD_URL or place "
            f"{dest} manually",
            file=sys.stderr,
        )
        return dest if dest.is_file() else None
    _download(url, dest)
    return dest if dest.is_file() else None


def ensure_edgesam(*, force: bool = False) -> tuple[Path | None, Path | None]:
    enc_env = str(os.environ.get("ILP_EDGESAM_ENCODER_PATH", "") or "").strip()
    dec_env = str(os.environ.get("ILP_EDGESAM_DECODER_PATH", "") or "").strip()
    enc = Path(enc_env) if enc_env else MODELS / "edgesam_encoder.onnx"
    dec = Path(dec_env) if dec_env else MODELS / "edgesam_decoder.onnx"
    if enc.is_file() and dec.is_file() and not force:
        return enc, dec

    enc_url = str(os.environ.get("ILP_EDGESAM_ENCODER_URL", "") or "").strip()
    dec_url = str(os.environ.get("ILP_EDGESAM_DECODER_URL", "") or "").strip()
    if enc_url:
        _download(enc_url, enc)
    if dec_url:
        _download(dec_url, dec)
    if not enc.is_file() or not dec.is_file():
        print(
            "EdgeSAM ONNX incomplete — export from EdgeSAM repo or set "
            "ILP_EDGESAM_ENCODER_URL / ILP_EDGESAM_DECODER_URL",
            file=sys.stderr,
        )
        return (enc if enc.is_file() else None, dec if dec.is_file() else None)
    return enc, dec


def ensure_hr_matting(*, force: bool = False) -> Path | None:
    sys.path.insert(0, str(REPO_ROOT / "src"))
    from image_layer_pipeline.stages.matting_model_paths import (
        REMBG_HR_MATTING_URL,
        hr_matting_download_dest,
        resolve_hr_matting_onnx,
    )

    existing = resolve_hr_matting_onnx()
    if existing is not None and not force:
        return existing

    dest = hr_matting_download_dest()
    dest.parent.mkdir(parents=True, exist_ok=True)
    if dest.is_file() and not force:
        return dest

    url = str(os.environ.get("ILP_HR_MATTING_DOWNLOAD_URL", "") or "").strip() or REMBG_HR_MATTING_URL
    print(f"downloading HR-matting (~1GB) from rembg releases...")
    _download(url, dest)
    return dest if dest.is_file() else None


def print_status() -> int:
    sys.path.insert(0, str(REPO_ROOT / "src"))
    from image_layer_pipeline.vision_capabilities import (
        vision_model_status,
        vision_ready_for_production,
    )

    from image_layer_pipeline.stages.matting_model_paths import (
        resolve_hr_matting_onnx,
        u2net_home,
    )

    status = vision_model_status()
    hr = resolve_hr_matting_onnx()
    status["matting"] = {
        "hr_matting_available": hr is not None,
        "hr_matting_path": str(hr) if hr else None,
        "u2net_home": str(u2net_home()),
        "production_default": "ben_custom" if hr else "birefnet-general",
    }
    print(json.dumps(status, indent=2, ensure_ascii=False))
    reason = vision_ready_for_production()
    if reason:
        print(f"production_blocker: {reason}", file=sys.stderr)
        return 1
    return 0


def main() -> int:
    parser = argparse.ArgumentParser(description="Setup commercial vision model weights")
    parser.add_argument("--esrgan", action="store_true", help="Ensure Real-ESRGAN ONNX")
    parser.add_argument("--edgesam", action="store_true", help="Ensure EdgeSAM encoder/decoder ONNX")
    parser.add_argument("--hr-matting", action="store_true", help="Download BiRefNet HR-matting ONNX (~1GB)")
    parser.add_argument("--check", action="store_true", help="Print vision_capabilities JSON and exit")
    parser.add_argument("--force", action="store_true", help="Re-download even if files exist")
    args = parser.parse_args()

    if args.esrgan:
        ensure_esrgan(force=args.force)
    if args.edgesam:
        ensure_edgesam(force=args.force)
    if args.hr_matting:
        ensure_hr_matting(force=args.force)

    if args.check or not (args.esrgan or args.edgesam or args.hr_matting):
        return print_status()
    return print_status()


if __name__ == "__main__":
    raise SystemExit(main())
