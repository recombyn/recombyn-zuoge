#!/usr/bin/env python3
"""Benchmark matting models on golden images — compare precision variants."""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

import numpy as np
import yaml
from PIL import Image

REPO = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(REPO / "src"))

from image_layer_pipeline.matting import run_matting  # noqa: E402
from image_layer_pipeline.stages.matting_model_paths import resolve_production_onnx  # noqa: E402


def _load_rgb(path: Path) -> np.ndarray:
    return np.asarray(Image.open(path).convert("RGB"), dtype=np.uint8)


def _alpha_stats(rgba: np.ndarray) -> dict[str, float]:
    alpha = rgba[:, :, 3].astype(np.float32) / 255.0
    fringe = ((alpha > 0.05) & (alpha < 0.95)).sum()
    return {
        "alpha_mean": float(alpha.mean()),
        "alpha_fringe_ratio": float(fringe / max(alpha.size, 1)),
        "alpha_max": float(alpha.max()),
    }


def _resolve_image(case: dict, golden_dir: Path) -> Path | None:
    rel = str(case.get("file") or "")
    glob_pat = str(case.get("glob") or "")
    if rel:
        candidate = golden_dir / rel
        if candidate.is_file():
            return candidate
    if glob_pat:
        matches = sorted(golden_dir.glob(glob_pat))
        if matches:
            return matches[0]
    return None


def _run_variant(rgb: np.ndarray, variant: str):
    key = variant.strip().lower()
    if key in {"auto", "production", "smart"}:
        return run_matting(rgb, scene="auto", trim_output=True)
    if key == "general":
        return run_matting(
            rgb,
            scene="general",
            model="birefnet-general",
            use_precision_onnx=False,
            trim_output=True,
        )
    if key == "hr-matting":
        onnx = resolve_production_onnx()
        if onnx is None:
            raise RuntimeError(
                "HR-matting ONNX missing — run: python scripts/setup_commercial_models.py --hr-matting"
            )
        return run_matting(
            rgb,
            scene="general",
            model="ben_custom",
            custom_onnx=str(onnx),
            trim_output=True,
        )
    if key == "portrait":
        return run_matting(rgb, scene="portrait", use_precision_onnx=False, trim_output=True)
    raise ValueError(f"unknown variant: {variant}")


def main() -> int:
    parser = argparse.ArgumentParser(description="Matting golden-set benchmark")
    parser.add_argument(
        "--manifest",
        default=str(REPO / "private-eval" / "matting" / "golden_manifest.yaml"),
    )
    parser.add_argument("--out", default=str(REPO / "private-eval" / "matting" / "runs"))
    parser.add_argument("--golden-dir", default="", help="override image folder")
    parser.add_argument(
        "--variants",
        default="auto,general,hr-matting",
        help="auto | general | hr-matting | portrait",
    )
    args = parser.parse_args()

    manifest_path = Path(args.manifest)
    if not manifest_path.is_file():
        print(f"manifest not found: {manifest_path}", file=sys.stderr)
        return 1

    data = yaml.safe_load(manifest_path.read_text(encoding="utf-8")) or {}
    golden_dir = Path(args.golden_dir) if args.golden_dir else manifest_path.parent
    out_root = Path(args.out)
    out_root.mkdir(parents=True, exist_ok=True)
    variants = [s.strip() for s in args.variants.split(",") if s.strip()]
    report: list[dict] = []

    for case in data.get("cases") or []:
        cid = str(case.get("id") or "case")
        img_path = _resolve_image(case, golden_dir)
        if img_path is None:
            print(f"skip missing: {cid}")
            continue

        rgb = _load_rgb(img_path)
        case_tag = str(case.get("scene") or "general")

        for variant in variants:
            try:
                result = _run_variant(rgb, variant)
            except Exception as exc:  # noqa: BLE001
                report.append({"id": cid, "variant": variant, "error": str(exc)})
                print(f"FAIL {cid} variant={variant}: {exc}")
                continue

            subdir = out_root / cid / variant
            subdir.mkdir(parents=True, exist_ok=True)
            out_png = subdir / "cutout.png"
            Image.fromarray(result.foreground_rgba, mode="RGBA").save(out_png)
            stats = _alpha_stats(result.foreground_rgba)
            report.append(
                {
                    "id": cid,
                    "variant": variant,
                    "case_tag": case_tag,
                    "notes": case.get("notes"),
                    "engines": result.engines,
                    "model": result.route.model,
                    "decontaminate": result.route.decontaminate,
                    "custom_onnx": result.route.custom_onnx,
                    "output": str(out_png),
                    **stats,
                }
            )
            print(
                f"OK {cid} variant={variant} model={result.route.model} "
                f"fringe={stats['alpha_fringe_ratio']:.3f}"
            )

    summary = out_root / "report.json"
    summary.write_text(json.dumps(report, indent=2, ensure_ascii=False), encoding="utf-8")
    print(f"wrote {summary}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
