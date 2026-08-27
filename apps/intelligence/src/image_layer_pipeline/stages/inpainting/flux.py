"""Flux inpaint adapter — HTTP fill API (fal.ai or custom endpoint)."""

from __future__ import annotations

import base64
import io
import json
import os
import urllib.error
import urllib.request

import numpy as np
from PIL import Image

DEFAULT_FAL_FILL_URL = "https://fal.run/fal-ai/flux-pro/v1/fill"


def flux_available() -> bool:
    """True when API key + endpoint are configured."""
    return bool(_api_key() and _api_url())


def inpaint_flux(image_rgb: np.ndarray, mask_u8: np.ndarray) -> np.ndarray:
    """
    Call remote Flux fill/inpaint API.

    Env:
      ILP_FLUX_API_URL — override endpoint (default: fal flux-pro fill)
      ILP_FLUX_API_KEY / FAL_KEY — bearer key
    """
    if not flux_available():
        raise RuntimeError("Flux inpaint is not configured (set FAL_KEY or ILP_FLUX_API_KEY)")

    image_b64 = _png_b64(image_rgb)
    mask_b64 = _mask_png_b64(mask_u8)

    payload = json.dumps(
        {
            "image_url": f"data:image/png;base64,{image_b64}",
            "mask_url": f"data:image/png;base64,{mask_b64}",
        }
    ).encode("utf-8")

    req = urllib.request.Request(
        _api_url(),
        data=payload,
        headers={
            "Content-Type": "application/json",
            "Authorization": f"Key {_api_key()}",
        },
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=120) as resp:
            body = json.loads(resp.read().decode("utf-8"))
    except urllib.error.HTTPError as exc:
        detail = exc.read().decode("utf-8", errors="replace")[:400]
        raise RuntimeError(f"Flux inpaint HTTP {exc.code}: {detail}") from exc

    image_url = _extract_image_url(body)
    if image_url.startswith("data:"):
        return _decode_data_url(image_url)

    img_req = urllib.request.Request(image_url)
    with urllib.request.urlopen(img_req, timeout=60) as resp:
        data = resp.read()
    pil = Image.open(io.BytesIO(data)).convert("RGB")
    out = np.asarray(pil, dtype=np.uint8)
    if out.shape[:2] != image_rgb.shape[:2]:
        pil = pil.resize((image_rgb.shape[1], image_rgb.shape[0]), Image.Resampling.LANCZOS)
        out = np.asarray(pil, dtype=np.uint8)
    return out


def _api_key() -> str:
    return (
        os.environ.get("ILP_FLUX_API_KEY", "").strip()
        or os.environ.get("FAL_KEY", "").strip()
    )


def _api_url() -> str:
    return os.environ.get("ILP_FLUX_API_URL", DEFAULT_FAL_FILL_URL).strip()


def _png_b64(image_rgb: np.ndarray) -> str:
    buf = io.BytesIO()
    Image.fromarray(image_rgb, mode="RGB").save(buf, format="PNG", optimize=True)
    return base64.b64encode(buf.getvalue()).decode("ascii")


def _mask_png_b64(mask_u8: np.ndarray) -> str:
    m = mask_u8
    if m.ndim == 3:
        m = m[:, :, 0]
    rgba = np.zeros((*m.shape, 4), dtype=np.uint8)
    rgba[:, :, 3] = (m > 127).astype(np.uint8) * 255
    buf = io.BytesIO()
    Image.fromarray(rgba, mode="RGBA").save(buf, format="PNG", optimize=True)
    return base64.b64encode(buf.getvalue()).decode("ascii")


def _extract_image_url(body: dict) -> str:
    if not isinstance(body, dict):
        raise RuntimeError("Flux response is not a JSON object")
    for key in ("image", "images"):
        val = body.get(key)
        if isinstance(val, dict) and val.get("url"):
            return str(val["url"])
        if isinstance(val, list) and val:
            first = val[0]
            if isinstance(first, dict) and first.get("url"):
                return str(first["url"])
            if isinstance(first, str):
                return first
    if body.get("image_url"):
        return str(body["image_url"])
    raise RuntimeError(f"Flux response missing image URL: {list(body.keys())}")


def _decode_data_url(url: str) -> np.ndarray:
    _header, b64 = url.split(",", 1)
    raw = base64.b64decode(b64)
    pil = Image.open(io.BytesIO(raw)).convert("RGB")
    return np.asarray(pil, dtype=np.uint8)
