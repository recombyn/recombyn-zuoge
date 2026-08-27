#!/usr/bin/env python3
"""
Prepare BiRefNet fine-tune folder layout from golden images + optional alpha masks.

Layout (official BiRefNet convention)::
  OUT_ROOT/TASK/DATASET/im/*.jpg
  OUT_ROOT/TASK/DATASET/gt/*.png   # grayscale alpha 0-255

Without ground-truth masks, this script can bootstrap pseudo-labels using the
current Intelligence matting stack (for iterative refinement only — replace
with hand labels before production training).

Usage::
  python scripts/prepare_birefnet_dataset.py \\
    --images private-eval/matting/golden \\
    --out datasets/dis/Portrait \\
    --scene portrait \\
    --pseudo
"""

from __future__ import annotations

import argparse
import shutil
import sys
from pathlib import Path

import numpy as np
import yaml
from PIL import Image

REPO = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(REPO / "src"))


def _stem(path: Path) -> str:
    return path.stem.replace(" ", "_")


def main() -> int:
    parser = argparse.ArgumentParser(description="Prepare BiRefNet dataset folders")
    parser.add_argument("--images", required=True, help="Folder of source JPG/PNG")
    parser.add_argument("--out", required=True, help="e.g. datasets/dis/Portrait")
    parser.add_argument("--scene", default="portrait", help="matting scene for pseudo labels")
    parser.add_argument("--manifest", default="", help="optional golden_manifest.yaml")
    parser.add_argument(
        "--pseudo",
        action="store_true",
        help="Generate gt/ alpha from current run_matting (bootstrap only)",
    )
    parser.add_argument("--copy-only", action="store_true", help="Only copy im/, skip gt/")
    args = parser.parse_args()

    src_dir = Path(args.images)
    out_root = Path(args.out)
    im_dir = out_root / "im"
    gt_dir = out_root / "gt"
    im_dir.mkdir(parents=True, exist_ok=True)
    if not args.copy_only:
        gt_dir.mkdir(parents=True, exist_ok=True)

    scene_by_file: dict[str, str] = {}
    if args.manifest:
        manifest = yaml.safe_load(Path(args.manifest).read_text(encoding="utf-8")) or {}
        for row in manifest.get("cases") or []:
            scene_by_file[str(row.get("file") or "")] = str(row.get("scene") or args.scene)

    from image_layer_pipeline.matting import run_matting  # noqa: E402

    images = sorted(
        [p for p in src_dir.iterdir() if p.suffix.lower() in {".jpg", ".jpeg", ".png", ".webp"}]
    )
    if not images:
        print(f"no images in {src_dir}", file=sys.stderr)
        return 1

    for path in images:
        stem = _stem(path)
        dst_im = im_dir / f"{stem}.jpg"
        if path.suffix.lower() in {".jpg", ".jpeg"}:
            shutil.copy2(path, dst_im)
        else:
            Image.open(path).convert("RGB").save(dst_im, quality=95)

        gt_path = gt_dir / f"{stem}.png"
        hand_gt = src_dir / "gt" / f"{stem}.png"
        if hand_gt.is_file():
            shutil.copy2(hand_gt, gt_path)
            print(f"hand gt: {gt_path.name}")
            continue

        if args.copy_only:
            continue

        if not args.pseudo:
            print(f"skip gt (no hand label): {path.name} — add {hand_gt} or use --pseudo")
            continue

        scene = scene_by_file.get(path.name, args.scene)
        rgb = np.asarray(Image.open(dst_im).convert("RGB"), dtype=np.uint8)
        result = run_matting(rgb, scene=scene, trim_output=False)
        alpha = result.foreground_rgba[:, :, 3]
        Image.fromarray(alpha, mode="L").save(gt_path)
        print(f"pseudo gt ({scene}): {gt_path.name}")

    readme = out_root / "README.txt"
    readme.write_text(
        "BiRefNet fine-tune folder. Next:\n"
        "1. Replace pseudo gt/ with hand-painted alpha where quality matters.\n"
        "2. Clone https://github.com/ZhengPeng7/BiRefNet\n"
        "3. Point config to this dataset — see docs/fine-tuning-matting.md\n"
        "4. Export ONNX → ILP_MATTING_PORTRAIT_ONNX or ILP_MATTING_TRANSPARENT_ONNX\n",
        encoding="utf-8",
    )
    print(f"ready: {out_root} ({len(images)} images)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
