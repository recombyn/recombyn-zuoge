"""Smoke test: intelligence health, segment, and optional full pipeline job."""

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


def make_test_png() -> bytes:
    img = Image.new("RGB", (320, 240), (220, 230, 245))
    draw = ImageDraw.Draw(img)
    draw.ellipse((80, 40, 240, 200), fill=(40, 120, 200))
    draw.rectangle((20, 160, 300, 220), fill=(90, 160, 90))
    buf = io.BytesIO()
    img.save(buf, format="PNG")
    return buf.getvalue()


def check_health(client: httpx.Client, base: str) -> bool:
    health = client.get(f"{base}/health")
    health.raise_for_status()
    body = health.json()
    print("health:", body)
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
    print(f"segment OK ({len(resp.content)} bytes)")
    return True


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
        choices=("health", "segment", "text", "detect", "analyze", "full", "all"),
        default="all",
        help="health | segment | text-decompose | detect-regions | analyze-pages | full pipeline | all",
    )
    args = parser.parse_args()

    base = args.base.rstrip("/")
    headers = {"Authorization": f"Bearer {args.api_key}"}
    png = make_test_png()

    with httpx.Client(timeout=httpx.Timeout(TIMEOUT_SEC, connect=30.0)) as client:
        if not check_health(client, base):
            return 1
        if args.mode == "health":
            return 0
        if args.mode in {"segment", "all"}:
            if not check_segment(client, png, headers, base=base):
                return 1
        if args.mode in {"text", "all"}:
            if not check_text_decompose(client, png, headers, base=base):
                return 1
        if args.mode in {"detect", "all"}:
            if not check_detect_regions(client, png, headers, base=base):
                return 1
        if args.mode in {"analyze", "all"}:
            if not check_analyze_pages(client, png, headers, base=base):
                return 1
        if args.mode in {"full", "all"}:
            if not check_full_pipeline(client, png, headers, base=base):
                return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
