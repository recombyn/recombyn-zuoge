"""BFF smoke: enqueue closed-source image tools via Celery jobs.

  python apps/api/scripts/test_ilp_tool_jobs.py [api_base] [kind ...]

Default kinds: removeBg upscale eraser editElements editText
"""

from __future__ import annotations

import base64
import io
import json
import sys
import time
import urllib.request

from PIL import Image, ImageDraw

API = "http://127.0.0.1:8001"
EMAIL = "admin@recombyn.com"
OTP = "888888"
DEFAULT_KINDS = ("removeBg", "upscale", "eraser", "editElements", "editText")


def req(url: str, method="GET", data=None, headers=None, timeout=60):
    request = urllib.request.Request(url, data=data, headers=dict(headers or {}), method=method)
    with urllib.request.urlopen(request, timeout=timeout) as resp:
        return resp.status, resp.read()


def jreq(url: str, **kw):
    status, body = req(url, **kw)
    return status, json.loads(body.decode() or "{}")


def png_bytes(size=(240, 180), text=False) -> bytes:
    im = Image.new("RGB", size, (200, 210, 230))
    draw = ImageDraw.Draw(im)
    draw.ellipse((40, 20, 200, 160), fill=(30, 110, 200))
    if text:
        draw.text((70, 80), "ABC", fill=(255, 255, 255))
    buf = io.BytesIO()
    im.save(buf, format="PNG")
    return buf.getvalue()


def data_url(raw: bytes) -> str:
    return "data:image/png;base64," + base64.b64encode(raw).decode("ascii")


def mask_data_url(size=(240, 180)) -> str:
    mask = Image.new("L", size, 0)
    ImageDraw.Draw(mask).ellipse((90, 60, 150, 120), fill=255)
    buf = io.BytesIO()
    mask.save(buf, format="PNG")
    return data_url(buf.getvalue())


def mint_token() -> str:
    _, sess = jreq(
        f"{API}/api/v1/auth/email/verify-code",
        method="POST",
        data=json.dumps({"email": EMAIL, "code": OTP}).encode(),
        headers={"Content-Type": "application/json"},
    )
    token = str(sess.get("token") or "")
    if not token:
        raise RuntimeError(f"mint failed: {sess}")
    return token


def result_ok(kind: str, result: dict) -> bool:
    if kind in {"editText", "editElements"}:
        return bool(
            result.get("image")
            or result.get("layers")
            or result.get("background")
            or result.get("editable_blocks")
            or result.get("nodes")
        )
    return bool(result.get("image"))


def run_kind(token: str, kind: str, image: str, *, meta=None, resolution=None) -> bool:
    body: dict = {"kind": kind, "image": image, "quality": "high"}
    if meta is not None:
        body["meta"] = meta
    if resolution:
        body["resolution"] = resolution
    _, job = jreq(
        f"{API}/api/v1/image/process/jobs",
        method="POST",
        data=json.dumps(body).encode(),
        headers={"Authorization": f"Bearer {token}", "Content-Type": "application/json"},
        timeout=30,
    )
    job_id = str(job.get("job_id") or "")
    print(f"\n== {kind} job={job_id}")
    if not job_id:
        print("FAIL enqueue", job)
        return False

    last: dict = {}
    deadline = time.time() + 300
    while time.time() < deadline:
        _, last = jreq(
            f"{API}/api/v1/image/process/jobs/{job_id}",
            headers={"Authorization": f"Bearer {token}"},
            timeout=30,
        )
        status = last.get("status")
        print(f"  {status} progress={last.get('progress')} err={last.get('error')!r}")
        if status in {"done", "failed"}:
            break
        time.sleep(2)

    if last.get("status") != "done":
        print("FAIL", last)
        return False
    result = last.get("result") if isinstance(last.get("result"), dict) else {}
    ok = result_ok(kind, result)
    print("  keys:", list(result)[:12], "ok=", ok)
    return ok


def main(argv: list[str]) -> int:
    global API
    args = list(argv[1:])
    if args and args[0].startswith("http"):
        API = args.pop(0).rstrip("/")
    kinds = tuple(args) if args else DEFAULT_KINDS

    token = mint_token()
    print("mint ok", "kinds=", kinds)
    image = data_url(png_bytes())
    text_image = data_url(png_bytes(text=True))
    payloads = {
        "removeBg": (image, None, None),
        "upscale": (image, None, "2K"),
        "eraser": (image, {"eraseMask": mask_data_url()}, None),
        "editElements": (image, None, None),
        "editText": (text_image, None, None),
    }

    fails: list[str] = []
    for kind in kinds:
        if kind not in payloads:
            print(f"unknown kind: {kind}")
            fails.append(kind)
            continue
        img, meta, resolution = payloads[kind]
        try:
            if not run_kind(token, kind, img, meta=meta, resolution=resolution):
                fails.append(kind)
        except Exception as exc:  # noqa: BLE001
            print(f"FAIL {kind}: {exc}")
            fails.append(kind)

    print("\nRESULT:", "PASS" if not fails else f"FAIL {fails}")
    return 0 if not fails else 1


if __name__ == "__main__":
    raise SystemExit(main(sys.argv))
