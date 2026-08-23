"""Mark region detect + i2i edit — saves artifacts for manual review.

Output: apps/api/private-eval/mark-edit-test/
  input.png          — synthetic upload
  mark-crop.png      — cropped marked region
  prompt.txt         — prompt sent to image model
  output.png         — generated result (when API keys + provider work)
  report.json        — detect + request metadata
"""

from __future__ import annotations

import asyncio
import base64
import json
import sys
from io import BytesIO
from pathlib import Path

_API_ROOT = Path(__file__).resolve().parents[1]
if str(_API_ROOT) not in sys.path:
    sys.path.insert(0, str(_API_ROOT))

OUT = _API_ROOT / "private-eval" / "mark-edit-test"


def _make_test_image() -> Path:
    from PIL import Image, ImageDraw

    OUT.mkdir(parents=True, exist_ok=True)
    img = Image.new("RGB", (512, 512), (235, 235, 235))
    draw = ImageDraw.Draw(img)
    draw.ellipse([140, 160, 372, 392], fill=(180, 130, 70), outline=(120, 80, 40), width=3)
    draw.rectangle([48, 48, 168, 96], fill=(60, 120, 220))
    path = OUT / "input.png"
    img.save(path)
    return path


def _to_data_url(path: Path) -> str:
    raw = path.read_bytes()
    b64 = base64.b64encode(raw).decode("ascii")
    return f"data:image/png;base64,{b64}"


def _crop_region(path: Path, rect: dict[str, float], node_w: float, node_h: float) -> bytes:
    from PIL import Image

    img = Image.open(path).convert("RGBA")
    nw, nh = img.size
    sx = nw / max(1, node_w)
    sy = nh / max(1, node_h)
    x = int(rect["x"] * sx)
    y = int(rect["y"] * sy)
    w = max(1, int(rect["w"] * sx))
    h = max(1, int(rect["h"] * sy))
    crop = img.crop((x, y, x + w, y + h))
    buf = BytesIO()
    crop.save(buf, format="PNG")
    return buf.getvalue()


def _build_mark_payload(node_id: str, region: dict, node_w: float, node_h: float) -> str:
    nx = f"{region['x'] / node_w:.3f}"
    ny = f"{region['y'] / node_h:.3f}"
    nw = f"{region['w'] / node_w:.3f}"
    nh = f"{region['h'] / node_h:.3f}"
    tag = "text" if region.get("kind") == "text" else "subject"
    label = region.get("label") or f"区域 {region.get('index', 1)}"
    return "\n".join(
        [
            "[Marked image region — edit this area on the referenced image]",
            f"node_id: {node_id}",
            f"region: #{region.get('index', 1)}({tag}@{nx},{ny},{nw}x{nh})",
            f"label: {label}",
        ]
    )


async def main() -> int:
    import argparse

    parser = argparse.ArgumentParser()
    parser.add_argument("--model", default="", help="image model id override")
    args = parser.parse_args()

    input_path = _make_test_image()
    data_url = _to_data_url(input_path)
    node_w = node_h = 512.0
    node_id = "test-node-1"

    report: dict = {"input": str(input_path), "detect": None, "generate": None}

    from app.services.vision.ilp_client import ilp_enabled

    if not ilp_enabled():
        print("ILP disabled — set RECOMBYN_INTELLIGENCE_URL in apps/api/.env")
        report["detect"] = {"error": "ilp_disabled"}
    else:
        from app.services.vision.ilp_detect_regions import detect_regions_via_ilp_adapter

        detect = await detect_regions_via_ilp_adapter(image=data_url)
        report["detect"] = {
            "width": detect.get("width"),
            "height": detect.get("height"),
            "layer_count": len(detect.get("layers") or []),
            "layers": detect.get("layers") or [],
        }
        print(f"detectRegions: {report['detect']['layer_count']} layers")

    layers = (report.get("detect") or {}).get("layers") or []
    # Prefer a mid-sized subject box — skip full-canvas OCR text layers.
    pick = None
    for layer in layers:
        if layer.get("type") == "text":
            w = float(layer.get("width") or 0)
            h = float(layer.get("height") or 0)
            if w >= node_w * 0.9 and h >= node_h * 0.9:
                continue
        w = float(layer.get("width") or 0)
        h = float(layer.get("height") or 0)
        if w < node_w * 0.15 or h < node_h * 0.15:
            continue
        if w > node_w * 0.85 and h > node_h * 0.85:
            continue
        pick = layer
        break
    if pick:
        region = {
            "index": 1,
            "x": float(pick.get("x") or 0),
            "y": float(pick.get("y") or 0),
            "w": float(pick.get("width") or 1),
            "h": float(pick.get("height") or 1),
            "kind": pick.get("type") or "image",
            "label": f"1 {pick.get('name') or '区域'}",
        }
    else:
        region = {"index": 1, "x": 140, "y": 160, "w": 232, "h": 232, "kind": "image", "label": "1 区域"}

    crop_bytes = _crop_region(input_path, region, node_w, node_h)
    crop_path = OUT / "mark-crop.png"
    crop_path.write_bytes(crop_bytes)
    crop_data_url = f"data:image/png;base64,{base64.b64encode(crop_bytes).decode('ascii')}"

    mark_payload = _build_mark_payload(node_id, region, node_w, node_h)
    user_prompt = "把标记区域改成一只白色小狗，保持其余部分不变"
    prompt = f"{mark_payload}\n\nUser request:\n{user_prompt}"
    (OUT / "prompt.txt").write_text(prompt, encoding="utf-8")
    print(f"prompt saved: {OUT / 'prompt.txt'}")

    try:
        from app.core.config import settings
        from app.services.llm.image import generate_image, resolve_image_model

        model_id = (
            args.model.strip()
            or str(getattr(settings, "image_default_model", "") or "").strip()
            or resolve_image_model(None)
        )
        print(f"image model: {model_id}")

        result = await generate_image(
            prompt=prompt,
            model=model_id,
            images=[data_url, crop_data_url],
            resolution="1K",
            aspect_ratio="1:1",
        )
        urls = []
        if isinstance(result, dict):
            urls = list(result.get("images") or [])
            if not urls and result.get("assets"):
                urls = [
                    str(a.get("url") or "").strip()
                    for a in (result.get("assets") or [])
                    if str(a.get("url") or "").strip()
                ]
        url = urls[0] if urls else ""
        report["generate"] = {"url": url, "raw_keys": list(result.keys()) if isinstance(result, dict) else []}
        if url.startswith("data:image"):
            header, b64 = url.split(",", 1)
            ext = "png" if "png" in header else "jpg"
            out_path = OUT / f"output.{ext}"
            out_path.write_bytes(base64.b64decode(b64))
            print(f"output saved: {out_path}")
        elif url.startswith("http"):
            import httpx

            async with httpx.AsyncClient(timeout=120.0) as client:
                res = await client.get(url)
                res.raise_for_status()
                out_path = OUT / "output.png"
                out_path.write_bytes(res.content)
                print(f"output saved: {out_path}")
        else:
            print("generate returned no downloadable image — check API keys / model config")
    except Exception as exc:
        report["generate"] = {"error": str(exc)}
        print(f"generate failed: {exc}")

    (OUT / "report.json").write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"report: {OUT / 'report.json'}")
    return 0


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))
