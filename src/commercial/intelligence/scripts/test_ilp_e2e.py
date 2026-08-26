"""Closed-source Intelligence smoke: segment / upscale / eraser / text / layers."""

from __future__ import annotations

import argparse
import io
import sys
import time

import httpx
from PIL import Image, ImageDraw

DEFAULT_BASE = "http://127.0.0.1:8091"
API_KEY = "dev-key"
TIMEOUT_SEC = 300


def make_test_png(*, size: tuple[int, int] = (320, 240), with_text: bool = False) -> bytes:
    img = Image.new("RGB", size, (220, 230, 245))
    draw = ImageDraw.Draw(img)
    draw.ellipse((size[0] // 4, size[1] // 6, size[0] * 3 // 4, size[1] * 5 // 6), fill=(40, 120, 200))
    draw.rectangle((20, size[1] - 80, size[0] - 20, size[1] - 20), fill=(90, 160, 90))
    if with_text:
        draw.text((size[0] // 3, size[1] // 2 - 10), "HELLO", fill=(255, 255, 255))
    buf = io.BytesIO()
    img.save(buf, format="PNG")
    return buf.getvalue()


def make_brush_mask(size: tuple[int, int] = (320, 240)) -> bytes:
    """White stroke on transparent/black — eraser hint."""
    mask = Image.new("L", size, 0)
    draw = ImageDraw.Draw(mask)
    cx, cy = size[0] // 2, size[1] // 2
    draw.ellipse((cx - 24, cy - 24, cx + 24, cy + 24), fill=255)
    buf = io.BytesIO()
    mask.save(buf, format="PNG")
    return buf.getvalue()


def check_health(client: httpx.Client, base: str) -> bool:
    health = client.get(f"{base}/health")
    health.raise_for_status()
    body = health.json()
    print("health:", body.get("status"), "ort=", (body.get("vision") or {}).get("ort_providers"))
    return body.get("status") in {"ok", "degraded"}


def check_segment(
    client: httpx.Client, png: bytes, headers: dict[str, str], *, base: str
) -> bool:
    resp = client.post(
        f"{base}/api/v1/pipeline/segment",
        headers=headers,
        files={"file": ("test.png", png, "image/png")},
        data={"model": "birefnet-general", "decontaminate": "0.65"},
    )
    if resp.status_code >= 400:
        print("segment failed:", resp.status_code, resp.text[:500])
        return False
    if len(resp.content) < 100:
        print("segment returned empty PNG")
        return False
    cut = Image.open(io.BytesIO(resp.content))
    print(f"segment OK ({len(resp.content)} bytes, mode={cut.mode}, size={cut.size})")
    return True


def check_upscale(
    client: httpx.Client, png: bytes, headers: dict[str, str], *, base: str
) -> bool:
    resp = client.post(
        f"{base}/api/v1/pipeline/upscale",
        headers=headers,
        files={"file": ("test.png", png, "image/png")},
        data={"resolution": "2K", "target_long_edge": "512"},
    )
    if resp.status_code >= 400:
        print("upscale failed:", resp.status_code, resp.text[:500])
        return False
    out = Image.open(io.BytesIO(resp.content))
    print(
        f"upscale OK ({len(resp.content)} bytes, size={out.size},",
        f"engine={resp.headers.get('X-ILP-Engine') or resp.headers.get('x-ilp-engine')})",
    )
    return out.size[0] >= 160 and out.size[1] >= 160


def check_eraser(
    client: httpx.Client, png: bytes, headers: dict[str, str], *, base: str
) -> bool:
    mask = make_brush_mask()
    # Product eraser uses erase-alpha (alpha punch); also verify LaMa /erase.
    alpha = client.post(
        f"{base}/api/v1/pipeline/erase-alpha",
        headers=headers,
        files={
            "file": ("test.png", png, "image/png"),
            "mask": ("mask.png", mask, "image/png"),
        },
    )
    if alpha.status_code >= 400:
        print("erase-alpha failed:", alpha.status_code, alpha.text[:500])
        return False
    erase = client.post(
        f"{base}/api/v1/pipeline/erase",
        headers=headers,
        files={
            "file": ("test.png", png, "image/png"),
            "mask": ("mask.png", mask, "image/png"),
        },
        data={"dilate_px": "4", "backend": "lama", "seam_radius": "4"},
    )
    if erase.status_code >= 400:
        print("erase failed:", erase.status_code, erase.text[:500])
        return False
    print(
        f"eraser OK (alpha={len(alpha.content)}B, lama={len(erase.content)}B,",
        f"engine={erase.headers.get('X-ILP-Engine') or erase.headers.get('x-ilp-engine')})",
    )
    return len(alpha.content) > 100 and len(erase.content) > 100


def check_detect_regions(
    client: httpx.Client, png: bytes, headers: dict[str, str], *, base: str
) -> bool:
    resp = client.post(
        f"{base}/api/v1/pipeline/detect-regions",
        headers=headers,
        files={"file": ("test.png", png, "image/png")},
        data={"lang": "ch", "model": "birefnet-general"},
    )
    if resp.status_code >= 400:
        print("detect-regions failed:", resp.status_code, resp.text[:500])
        return False
    body = resp.json()
    if not isinstance(body, dict):
        print("detect-regions invalid JSON")
        return False
    print("detect-regions OK:", f"layers={len(body.get('layers') or [])}")
    return True


def check_text_decompose(
    client: httpx.Client, png: bytes, headers: dict[str, str], *, base: str
) -> bool:
    resp = client.post(
        f"{base}/api/v1/pipeline/text-decompose",
        headers=headers,
        files={"file": ("test.png", png, "image/png")},
        data={"lang": "ch", "min_confidence": "0.72"},
    )
    if resp.status_code >= 400:
        print("text-decompose failed:", resp.status_code, resp.text[:500])
        return False
    body = resp.json()
    if not isinstance(body, dict) or not body.get("background_b64"):
        print("text-decompose returned invalid payload:", body)
        return False
    print(
        "text-decompose OK:",
        f"{body.get('width')}x{body.get('height')}",
        f"editable={len(body.get('editable_blocks') or [])}",
        f"raster={len(body.get('raster_layers') or [])}",
    )
    return True


def check_analyze_pages(
    client: httpx.Client, png: bytes, headers: dict[str, str], *, base: str
) -> bool:
    resp = client.post(
        f"{base}/api/v1/pipeline/analyze-pages",
        headers=headers,
        files=[("files", ("test.png", png, "image/png"))],
        data={"lang": "ch", "target_width": "400"},
    )
    if resp.status_code >= 400:
        print("analyze-pages failed:", resp.status_code, resp.text[:500])
        return False
    body = resp.json()
    if not isinstance(body, dict):
        print("analyze-pages invalid JSON")
        return False
    print(
        "analyze-pages OK:",
        f"blocks={len(body.get('blocks') or [])}",
        f"engines={body.get('engines')}",
    )
    return True


def check_full_pipeline(
    client: httpx.Client, png: bytes, headers: dict[str, str], *, base: str
) -> bool:
    resp = client.post(
        f"{base}/api/v1/pipeline/jobs",
        headers=headers,
        files={"file": ("test.png", png, "image/png")},
    )
    if resp.status_code >= 400:
        print("create failed:", resp.status_code, resp.text[:500])
        return False
    job_id = resp.json().get("job_id")
    print("job_id:", job_id)

    deadline = time.monotonic() + TIMEOUT_SEC
    while time.monotonic() < deadline:
        poll = client.get(f"{base}/api/v1/pipeline/jobs/{job_id}", headers=headers)
        poll.raise_for_status()
        job = poll.json()
        status = job.get("status")
        progress = job.get("progress")
        print(f"status={status} progress={progress}")
        if status in {"needs_review", "done", "failed", "cancelled"}:
            if status == "failed":
                print("error:", job.get("error"))
                return False
            urls = job.get("urls") or {}
            for key in ("far_background", "midground", "foreground"):
                rel = urls.get(key)
                if not rel:
                    print(f"missing url: {key}")
                    return False
                file_resp = client.get(f"{base}{rel}", headers=headers)
                file_resp.raise_for_status()
                if len(file_resp.content) < 100:
                    print(f"empty file: {key}")
                    return False
            print("OK: pipeline produced all layer exports")
            return True
        time.sleep(2)

    print("pipeline timeout")
    return False


def main() -> int:
    parser = argparse.ArgumentParser(description="Intelligence vision smoke tests")
    parser.add_argument("--base", default=DEFAULT_BASE)
    parser.add_argument("--api-key", default=API_KEY)
    parser.add_argument(
        "--mode",
        choices=(
            "health",
            "segment",
            "upscale",
            "eraser",
            "text",
            "detect",
            "analyze",
            "full",
            "all",
        ),
        default="all",
        help="Which closed-source vision checks to run",
    )
    args = parser.parse_args()

    base = args.base.rstrip("/")
    headers = {"Authorization": f"Bearer {args.api_key}"}
    png = make_test_png()
    text_png = make_test_png(with_text=True)

    checks: list[tuple[str, object]] = []
    if args.mode in {"segment", "all"}:
        checks.append(("segment", lambda c: check_segment(c, png, headers, base=base)))
    if args.mode in {"upscale", "all"}:
        checks.append(("upscale", lambda c: check_upscale(c, png, headers, base=base)))
    if args.mode in {"eraser", "all"}:
        checks.append(("eraser", lambda c: check_eraser(c, png, headers, base=base)))
    if args.mode in {"text", "all"}:
        checks.append(("text", lambda c: check_text_decompose(c, text_png, headers, base=base)))
    if args.mode in {"detect", "all"}:
        checks.append(("detect", lambda c: check_detect_regions(c, png, headers, base=base)))
    if args.mode in {"analyze", "all"}:
        checks.append(("analyze", lambda c: check_analyze_pages(c, png, headers, base=base)))
    if args.mode in {"full", "all"}:
        checks.append(("full", lambda c: check_full_pipeline(c, png, headers, base=base)))

    with httpx.Client(timeout=httpx.Timeout(TIMEOUT_SEC, connect=30.0)) as client:
        if not check_health(client, base):
            return 1
        if args.mode == "health":
            return 0
        for name, fn in checks:
            print(f"\n== {name} ==")
            if not fn(client):
                return 1
    print("\nPASS")
    return 0


if __name__ == "__main__":
    sys.exit(main())
