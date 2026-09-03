"""Volcengine AI MediaKit HTTP client (Bearer API Key).

Docs: https://www.volcengine.com/docs/6448/2407253
Upload: POST /api/v1/tools-sync/request-media-upload-url
Remove BG: POST /api/v1/tools-sync/remove-image-background
Expand: POST /api/v1/tools-sync/expand-image-canvas
OCR: POST /api/v1/tools-sync/image-ocr
Erase: POST /api/v1/tools-sync/erase-image
Enhance: POST /api/v1/tools-sync/enhance-image
Translate: POST /api/v1/tools-sync/translate-image-text
Product scene: POST /api/v1/tools-sync/generate-product-scene-image
"""

from __future__ import annotations

import base64
import logging
import re
from typing import Any
from urllib.parse import unquote, urlparse

import httpx

from app.core.config import settings

logger = logging.getLogger(__name__)

_DATA_URL_RE = re.compile(r"^data:([^;,]+)?(?:;base64)?,(.+)$", re.DOTALL)
_REMOVE_BG_TOOL = "remove-image-background"
_EXPAND_TOOL = "expand-image-canvas"
_OCR_TOOL = "image-ocr"
_ERASE_TOOL = "erase-image"
_ENHANCE_TOOL = "enhance-image"
_TRANSLATE_TOOL = "translate-image-text"
_PRODUCT_SCENE_TOOL = "generate-product-scene-image"
_SCENES = frozenset({"general", "human", "product"})
_OUTPUT_FORMATS = frozenset({"png", "jpeg", "webp"})
_ENHANCE_VERSIONS = frozenset({"standard", "professional", "max"})
_ENHANCE_MODES = frozenset({"fidelity_first", "generative_first"})
_TRANSLATE_VERSIONS = frozenset(
    {
        "seed-translation",
        "erase",
        "overlay-translation",
        "dense-text-translation",
        "logo-retain-erase-translation",
    }
)
# seed-translation language set (source + target).
_TRANSLATE_LANGS = frozenset(
    {
        "ar",
        "cs",
        "da",
        "de",
        "en",
        "es",
        "fi",
        "fr",
        "hr",
        "hu",
        "id",
        "it",
        "ja",
        "ko",
        "ms",
        "nb",
        "nl",
        "pl",
        "pt",
        "ro",
        "ru",
        "sv",
        "th",
        "tr",
        "uk",
        "vi",
        "zh",
        "zh_hant",
    }
)
_PRODUCT_SCENE_VERSIONS = frozenset({"standard", "professional", "industry"})
_PRODUCT_STANDARD_SCENES = frozenset(
    {
        "general",
        "natural_pasture",
        "exhibit_home",
        "exhibit_simple",
        "exhibit_kitchen",
        "exhibit_bathroom",
        "water_reflect",
        "water_plants",
        "exhibit_light",
        "water_ripples",
        "exhibit_luxury",
        "exhibit_modern",
        "exhibit_stone",
        "exhibit_forest",
        "exhibit_floor",
        "exhibit_toy",
        "exhibit_liquor",
        "exhibit_wine",
        "exhibit_beer",
        "glisten_dew",
        "spring_rock",
        "dawn_silk",
        "flower_rock",
        "origem_drop",
        "sunrise_bake",
        "sea_crunch",
        "onyx_flow",
        "joy_pack",
        "drug_moss",
        "toy_mat",
        "coast_nut",
    }
)
_EXPAND_RATIO_MAX = 0.4
_EXPAND_MAX_STEPS = 8


def mediakit_enabled() -> bool:
    return bool(str(getattr(settings, "mediakit_api_key", "") or "").strip())


def mediakit_supports() -> list[str]:
    if not mediakit_enabled():
        return []
    return [
        "removeBg",
        "expand",
        "editText",
        "eraser",
        "upscale",
        "translateImage",
        "productScene",
    ]


def _base_url() -> str:
    return str(getattr(settings, "mediakit_base_url", "") or "").strip().rstrip("/") or (
        "https://mediakit.cn-beijing.volces.com"
    )


def _headers() -> dict[str, str]:
    key = str(getattr(settings, "mediakit_api_key", "") or "").strip()
    if not key:
        raise RuntimeError("MEDIAKIT_API_KEY is not configured")
    return {
        "Authorization": f"Bearer {key}",
        "Content-Type": "application/json",
        "Accept": "application/json",
    }


def _timeout() -> httpx.Timeout:
    sec = float(getattr(settings, "mediakit_timeout_sec", 120.0) or 120.0)
    return httpx.Timeout(sec, connect=min(30.0, sec))


def _require_enabled() -> None:
    if not mediakit_enabled():
        raise RuntimeError(
            "此功能需要配置火山引擎 AI MediaKit（设置 MEDIAKIT_API_KEY，"
            "见 https://console.volcengine.com/imp/ai-mediakit/settings）"
        )


def _object_key_from_image_ref(ref: str) -> str | None:
    s = (ref or "").strip()
    if not s or s.startswith("data:") or s.startswith("blob:"):
        return None
    try:
        if s.startswith("/"):
            path = s.split("?", 1)[0]
        else:
            path = urlparse(s).path or ""
        path = unquote(path)
        api_prefix = "/api/v1/uploads/files/"
        if path.startswith(api_prefix):
            key = path[len(api_prefix) :].lstrip("/")
            return key or None
        for marker in ("/uploads/", "/assets/", "/font-tasks/", "/projects/"):
            idx = path.find(marker)
            if idx >= 0:
                key = path[idx + 1 :].lstrip("/")
                if key.startswith(("uploads/", "assets/", "font-tasks/", "projects/")):
                    return key
    except Exception:
        return None
    return None


async def _load_image_bytes(image_ref: str) -> tuple[bytes, str]:
    ref = (image_ref or "").strip()
    if not ref:
        raise ValueError("image is required")

    if ref.startswith("data:"):
        match = _DATA_URL_RE.match(ref)
        if not match:
            raise ValueError("invalid data URL")
        return base64.b64decode(match.group(2)), "upload.png"

    key = _object_key_from_image_ref(ref)
    if key:
        from app.services.storage import get_bytes

        data = get_bytes(key)
        if data:
            name = "upload.png"
            lower = key.lower()
            if lower.endswith((".jpg", ".jpeg")):
                name = "upload.jpg"
            elif lower.endswith(".webp"):
                name = "upload.webp"
            return data, name

    if ref.startswith("http://") or ref.startswith("https://"):
        async with httpx.AsyncClient(timeout=httpx.Timeout(60.0, connect=20.0)) as client:
            resp = await client.get(ref)
            if resp.status_code >= 400:
                raise ValueError(f"failed to download image ({resp.status_code})")
            name = "upload.png"
            ctype = (resp.headers.get("content-type") or "").lower()
            if "jpeg" in ctype or "jpg" in ctype:
                name = "upload.jpg"
            elif "webp" in ctype:
                name = "upload.webp"
            return resp.content, name

    raise ValueError("unsupported image reference")


def _is_public_http_url(ref: str) -> bool:
    from app.services.vision.rehost import is_public_http_url

    return is_public_http_url(ref)


def _parse_upload_headers(raw: Any) -> dict[str, str]:
    headers: dict[str, str] = {}
    if isinstance(raw, dict):
        for key, val in raw.items():
            k = str(key or "").strip()
            if k:
                headers[k] = str(val or "")
        return headers
    if not isinstance(raw, list):
        return headers
    for item in raw:
        if isinstance(item, dict):
            key = str(item.get("key") or item.get("name") or item.get("header") or "").strip()
            val = str(item.get("value") or item.get("val") or "")
            if key:
                headers[key] = val
            continue
        if isinstance(item, str) and ":" in item:
            left, right = item.split(":", 1)
            headers[left.strip()] = right.strip()
    return headers


async def _request_upload_target(client: httpx.AsyncClient, *, tool_name: str) -> dict[str, Any]:
    resp = await client.post(
        f"{_base_url()}/api/v1/tools-sync/request-media-upload-url",
        headers=_headers(),
        json={"tool_name": tool_name},
    )
    payload = _parse_json_response(resp)
    result = payload.get("result")
    if not isinstance(result, dict):
        raise RuntimeError(f"MediaKit upload address missing result: {payload!r}")
    file_id = str(result.get("file_id") or "").strip()
    upload_url = str(result.get("upload_url") or "").strip()
    if not file_id or not upload_url:
        raise RuntimeError(f"MediaKit upload address incomplete: {result!r}")
    method = str(result.get("method") or "PUT").strip().upper() or "PUT"
    return {
        "file_id": file_id,
        "upload_url": upload_url,
        "method": method,
        "headers": _parse_upload_headers(result.get("upload_headers")),
    }


async def _upload_bytes_as_mediakit_uri(
    client: httpx.AsyncClient,
    data: bytes,
    *,
    filename: str,
    tool_name: str,
) -> str:
    if not data:
        raise ValueError("empty image bytes")
    if len(data) > 10 * 1024 * 1024:
        raise ValueError("image exceeds MediaKit 10 MB limit")

    target = await _request_upload_target(client, tool_name=tool_name)
    put_headers = dict(target["headers"])
    if "Content-Type" not in put_headers and "content-type" not in {
        k.lower() for k in put_headers
    }:
        lower = (filename or "").lower()
        if lower.endswith((".jpg", ".jpeg")):
            put_headers["Content-Type"] = "image/jpeg"
        elif lower.endswith(".webp"):
            put_headers["Content-Type"] = "image/webp"
        else:
            put_headers["Content-Type"] = "image/png"

    put_resp = await client.request(
        target["method"],
        target["upload_url"],
        content=data,
        headers=put_headers,
    )
    if put_resp.status_code >= 400:
        body = (put_resp.text or "")[:400]
        raise RuntimeError(f"MediaKit media upload failed ({put_resp.status_code}): {body}")
    return str(target["file_id"])


async def _resolve_image_url_for_tool(
    client: httpx.AsyncClient,
    image_ref: str,
    *,
    tool_name: str,
) -> str:
    ref = (image_ref or "").strip()
    if ref.startswith(("mediakit://", "tos://", "vod://")):
        return ref
    if _is_public_http_url(ref) and not _object_key_from_image_ref(ref):
        # Public CDN URL MediaKit can fetch directly.
        return ref

    data, filename = await _load_image_bytes(ref)
    return await _upload_bytes_as_mediakit_uri(
        client, data, filename=filename, tool_name=tool_name
    )


def _parse_json_response(resp: httpx.Response) -> dict[str, Any]:
    try:
        payload = resp.json()
    except Exception as err:
        raise RuntimeError(
            f"MediaKit non-JSON response ({resp.status_code}): {(resp.text or '')[:400]}"
        ) from err
    if not isinstance(payload, dict):
        raise RuntimeError(f"MediaKit unexpected payload type: {type(payload).__name__}")
    if resp.status_code >= 400:
        err = payload.get("error") or payload.get("message") or payload
        raise RuntimeError(f"MediaKit HTTP {resp.status_code}: {err}")
    if payload.get("success") is False:
        err = payload.get("error") or payload.get("message") or payload
        raise RuntimeError(f"MediaKit business failure: {err}")
    return payload


def _scene_from_meta(meta: dict[str, Any] | None) -> str:
    m = meta or {}
    raw = str(m.get("scene") or m.get("cutoutScene") or "general").strip().lower()
    if raw == "portrait":
        raw = "human"
    if raw not in _SCENES:
        return "general"
    return raw


def _output_format_from_meta(meta: dict[str, Any] | None) -> str:
    raw = str((meta or {}).get("outputFormat") or (meta or {}).get("output_format") or "png")
    raw = raw.strip().lower()
    if raw not in _OUTPUT_FORMATS:
        return "png"
    return raw


def _optional_bool(meta: dict[str, Any], *keys: str) -> bool | None:
    for key in keys:
        if key not in meta:
            continue
        val = meta.get(key)
        if isinstance(val, bool):
            return val
        if isinstance(val, (int, float)):
            return bool(val)
        s = str(val or "").strip().lower()
        if s in {"1", "true", "yes", "on"}:
            return True
        if s in {"0", "false", "no", "off"}:
            return False
    return None


async def remove_image_background(
    image_ref: str,
    *,
    meta: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """
    Sync remove-background via MediaKit.

    Returns ``{ image_bytes, image_url, width, height, format, scene, task_id }``.
    """
    _require_enabled()
    m = meta or {}
    scene = _scene_from_meta(m)
    body: dict[str, Any] = {
        "scene": scene,
        "output_format": _output_format_from_meta(m),
    }
    need_contour = _optional_bool(m, "needContour", "need_contour")
    if need_contour is not None:
        body["need_contour"] = need_contour
    need_crop = _optional_bool(m, "needCropBackground", "need_crop_background")
    if need_crop is not None:
        body["need_crop_background"] = need_crop
    contour_color = str(m.get("contourColor") or m.get("contour_color") or "").strip()
    if contour_color:
        body["contour_color"] = contour_color
    contour_size = m.get("contourSize", m.get("contour_size"))
    if contour_size is not None:
        try:
            body["contour_size"] = max(1, min(100, int(contour_size)))
        except (TypeError, ValueError):
            pass

    async with httpx.AsyncClient(timeout=_timeout()) as client:
        body["image_url"] = await _resolve_image_url_for_tool(
            client, image_ref, tool_name=_REMOVE_BG_TOOL
        )
        resp = await client.post(
            f"{_base_url()}/api/v1/tools-sync/remove-image-background",
            headers=_headers(),
            json=body,
        )
        payload = _parse_json_response(resp)
        result = payload.get("result")
        if not isinstance(result, dict):
            raise RuntimeError(f"MediaKit remove-bg missing result: {payload!r}")
        out_url = str(result.get("image_url") or "").strip()
        if not out_url:
            raise RuntimeError(f"MediaKit remove-bg missing image_url: {result!r}")

        dl = await client.get(out_url)
        if dl.status_code >= 400:
            raise RuntimeError(f"failed to download MediaKit cutout ({dl.status_code})")
        png_bytes = dl.content

    width = int(result.get("image_width") or 0) or None
    height = int(result.get("image_height") or 0) or None
    fmt = str(result.get("image_format") or body["output_format"] or "png").strip().lower()
    return {
        "image_bytes": png_bytes,
        "image_url": out_url,
        "width": width,
        "height": height,
        "format": fmt,
        "scene": scene,
        "task_id": str(payload.get("task_id") or "").strip() or None,
        "request_id": str(payload.get("request_id") or "").strip() or None,
    }


def _meta_float(meta: dict[str, Any], *keys: str) -> float | None:
    for key in keys:
        if key not in meta or meta.get(key) is None:
            continue
        try:
            return float(meta[key])
        except (TypeError, ValueError):
            continue
    return None


def _meta_int(meta: dict[str, Any], *keys: str, default: int = 0) -> int:
    for key in keys:
        if key not in meta or meta.get(key) is None:
            continue
        try:
            return int(float(meta[key]))
        except (TypeError, ValueError):
            continue
    return default


def expand_ratios_from_meta(meta: dict[str, Any] | None) -> tuple[float, float, float, float]:
    """
    Map FE pad pixels / MediaKit ratios → ``(left, right, top, bottom)``.

    Ratios are relative to the source short side (MediaKit contract). Values may
    exceed 0.4; ``expand_image_canvas`` splits them into progressive calls.
    """
    m = meta or {}
    direct = (
        _meta_float(m, "expandLeft", "expand_left"),
        _meta_float(m, "expandRight", "expand_right"),
        _meta_float(m, "expandTop", "expand_top"),
        _meta_float(m, "expandBottom", "expand_bottom"),
    )
    if any(v is not None for v in direct):
        return (
            max(0.0, float(direct[0] or 0.0)),
            max(0.0, float(direct[1] or 0.0)),
            max(0.0, float(direct[2] or 0.0)),
            max(0.0, float(direct[3] or 0.0)),
        )

    pad_l = max(0, _meta_int(m, "padLeft", "pad_left"))
    pad_r = max(0, _meta_int(m, "padRight", "pad_right"))
    pad_t = max(0, _meta_int(m, "padTop", "pad_top"))
    pad_b = max(0, _meta_int(m, "padBottom", "pad_bottom"))
    tw = _meta_int(m, "targetWidth", "target_width", default=0)
    th = _meta_int(m, "targetHeight", "target_height", default=0)
    ow = tw - pad_l - pad_r if tw > 0 else 0
    oh = th - pad_t - pad_b if th > 0 else 0
    if ow > 0 and oh > 0 and (pad_l or pad_r or pad_t or pad_b):
        short = float(min(ow, oh))
        return pad_l / short, pad_r / short, pad_t / short, pad_b / short

    # direction + scale fallback (e.g. agent tools)
    direction = str(m.get("direction") or "all").strip().lower()
    scale_raw = str(m.get("scale") or "1.5").strip().lower().rstrip("x")
    try:
        scale = float(scale_raw)
    except (TypeError, ValueError):
        scale = 1.5
    extra = max(0.0, scale - 1.0)
    half = extra / 2.0
    left = right = top = bottom = 0.0
    if direction in {"", "all"}:
        left = right = top = bottom = half
    elif "left" in direction:
        left = extra if direction == "left" else half
    if "right" in direction:
        right = extra if direction == "right" else max(right, half)
    if "top" in direction:
        top = extra if direction == "top" else max(top, half)
    if "bottom" in direction:
        bottom = extra if direction == "bottom" else max(bottom, half)
    if direction == "horizontal":
        left = right = half
        top = bottom = 0.0
    elif direction == "vertical":
        top = bottom = half
        left = right = 0.0
    return left, right, top, bottom


def _progressive_expand_steps(
    left: float, right: float, top: float, bottom: float
) -> list[tuple[float, float, float, float]]:
    remaining = [max(0.0, left), max(0.0, right), max(0.0, top), max(0.0, bottom)]
    steps: list[tuple[float, float, float, float]] = []
    for _ in range(_EXPAND_MAX_STEPS):
        if all(r <= 1e-9 for r in remaining):
            break
        step = tuple(min(_EXPAND_RATIO_MAX, r) for r in remaining)
        if all(s <= 1e-9 for s in step):
            break
        steps.append((step[0], step[1], step[2], step[3]))
        remaining = [r - s for r, s in zip(remaining, step, strict=True)]
    if any(r > 1e-6 for r in remaining):
        raise ValueError(
            f"expand ratio too large for {_EXPAND_MAX_STEPS} MediaKit steps "
            f"(remaining LRTB={remaining!r}; max {_EXPAND_RATIO_MAX} per side per call)"
        )
    return steps


async def expand_image_canvas(
    image_ref: str,
    *,
    meta: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """
    Sync canvas expand via MediaKit ``expand-image-canvas``.

    Returns ``{ image_bytes, image_url, width, height, format, ratios, steps, task_id }``.
    """
    _require_enabled()
    left, right, top, bottom = expand_ratios_from_meta(meta)
    if left <= 0 and right <= 0 and top <= 0 and bottom <= 0:
        raise ValueError("expand requires at least one positive direction")
    steps = _progressive_expand_steps(left, right, top, bottom)
    if not steps:
        raise ValueError("expand requires at least one positive direction")

    last_bytes = b""
    last_url = ""
    last_width: int | None = None
    last_height: int | None = None
    last_fmt = "jpeg"
    last_task_id: str | None = None
    last_request_id: str | None = None

    async with httpx.AsyncClient(timeout=_timeout()) as client:
        current_url = await _resolve_image_url_for_tool(
            client, image_ref, tool_name=_EXPAND_TOOL
        )
        for step_left, step_right, step_top, step_bottom in steps:
            body = {
                "image_url": current_url,
                "expand_left": round(step_left, 4),
                "expand_right": round(step_right, 4),
                "expand_top": round(step_top, 4),
                "expand_bottom": round(step_bottom, 4),
            }
            resp = await client.post(
                f"{_base_url()}/api/v1/tools-sync/expand-image-canvas",
                headers=_headers(),
                json=body,
            )
            payload = _parse_json_response(resp)
            result = payload.get("result")
            if not isinstance(result, dict):
                raise RuntimeError(f"MediaKit expand missing result: {payload!r}")
            out_url = str(result.get("image_url") or "").strip()
            if not out_url:
                raise RuntimeError(f"MediaKit expand missing image_url: {result!r}")

            dl = await client.get(out_url)
            if dl.status_code >= 400:
                raise RuntimeError(f"failed to download MediaKit expand ({dl.status_code})")
            last_bytes = dl.content
            last_url = out_url
            last_width = int(result.get("image_width") or 0) or None
            last_height = int(result.get("image_height") or 0) or None
            last_fmt = str(result.get("image_format") or "jpeg").strip().lower() or "jpeg"
            last_task_id = str(payload.get("task_id") or "").strip() or last_task_id
            last_request_id = str(payload.get("request_id") or "").strip() or last_request_id
            # Result URL is a public HTTPS link (24h) — feed into the next step.
            current_url = out_url

    return {
        "image_bytes": last_bytes,
        "image_url": last_url,
        "width": last_width,
        "height": last_height,
        "format": last_fmt,
        "ratios": {
            "left": left,
            "right": right,
            "top": top,
            "bottom": bottom,
        },
        "steps": len(steps),
        "task_id": last_task_id,
        "request_id": last_request_id,
    }


def _ocr_block_from_raw(raw: dict[str, Any]) -> dict[str, Any] | None:
    content = str(raw.get("content") or "").strip()
    if not content:
        return None
    try:
        x0 = float(raw.get("top_left_x") or 0)
        y0 = float(raw.get("top_left_y") or 0)
        x1 = float(raw.get("bottom_right_x") or x0)
        y1 = float(raw.get("bottom_right_y") or y0)
    except (TypeError, ValueError):
        return None
    width = max(1.0, x1 - x0)
    height = max(1.0, y1 - y0)
    conf_raw = raw.get("confidence")
    confidence: float | None
    try:
        confidence = float(conf_raw) if conf_raw is not None else None
    except (TypeError, ValueError):
        confidence = None
    block: dict[str, Any] = {
        "text": content,
        "x": x0,
        "y": y0,
        "width": width,
        "height": height,
        "font_size": max(8.0, height * 0.85),
    }
    if confidence is not None:
        block["confidence"] = confidence
    return block


async def image_ocr(
    image_ref: str,
    *,
    meta: dict[str, Any] | None = None,
    resolved_url: str | None = None,
) -> dict[str, Any]:
    """
    Sync OCR via MediaKit ``image-ocr``.

    Returns ``{ blocks, tool_version, task_id, request_id }`` where each block is
    ``{ text, x, y, width, height, font_size, confidence? }``.
    """
    _require_enabled()
    m = meta or {}
    tool_version = str(m.get("toolVersion") or m.get("tool_version") or "max").strip().lower()
    if tool_version not in {"standard", "max"}:
        tool_version = "max"
    body: dict[str, Any] = {"tool_version": tool_version}
    task_type = str(m.get("taskType") or m.get("task_type") or "").strip().lower()
    if task_type:
        body["task_type"] = task_type
    keywords = m.get("maxKeywords") if "maxKeywords" in m else m.get("max_keywords")
    if isinstance(keywords, list) and keywords:
        body["max_keywords"] = [str(k).strip() for k in keywords if str(k).strip()]

    async with httpx.AsyncClient(timeout=_timeout()) as client:
        body["image_url"] = resolved_url or await _resolve_image_url_for_tool(
            client, image_ref, tool_name=_OCR_TOOL
        )
        resp = await client.post(
            f"{_base_url()}/api/v1/tools-sync/image-ocr",
            headers=_headers(),
            json=body,
        )
        payload = _parse_json_response(resp)

    result = payload.get("result")
    if not isinstance(result, dict):
        raise RuntimeError(f"MediaKit OCR missing result: {payload!r}")

    blocks: list[dict[str, Any]] = []
    raw_list = result.get("ocr_result")
    if isinstance(raw_list, list):
        for item in raw_list:
            if not isinstance(item, dict):
                continue
            block = _ocr_block_from_raw(item)
            if block:
                blocks.append(block)

    keyword_result = result.get("keyword_result")
    return {
        "blocks": blocks,
        "keyword_result": keyword_result if isinstance(keyword_result, dict) else None,
        "tool_version": tool_version,
        "image_url": body["image_url"],
        "task_id": str(payload.get("task_id") or "").strip() or None,
        "request_id": str(payload.get("request_id") or "").strip() or None,
    }


_ERASE_SCENES = frozenset(
    {
        "full_screen_text_erase",
        "full_screen_icon_erase",
        "selected_area_erase",
    }
)


async def erase_image(
    image_ref: str,
    *,
    meta: dict[str, Any] | None = None,
    resolved_url: str | None = None,
    mask_bytes: bytes | None = None,
) -> dict[str, Any]:
    """
    Sync erase/repair via MediaKit ``erase-image``.

    Scenes:
    - ``full_screen_text_erase`` / ``full_screen_icon_erase`` (auto detect)
    - ``selected_area_erase`` with ``mask_url`` / ``selected_area`` (brush eraser)

    Returns ``{ image_bytes, image_url, width, height, format, task_id }``.
    """
    _require_enabled()
    m = meta or {}
    tool_version = str(m.get("toolVersion") or m.get("tool_version") or "standard").strip().lower()
    if tool_version not in {"standard"}:
        tool_version = "standard"
    scene = str(
        m.get("standardScene") or m.get("standard_scene") or "full_screen_text_erase"
    ).strip()
    if scene not in _ERASE_SCENES:
        scene = "full_screen_text_erase"
    output_format = str(m.get("outputFormat") or m.get("output_format") or "png").strip().lower()
    if output_format not in _OUTPUT_FORMATS:
        output_format = "png"

    body: dict[str, Any] = {
        "tool_version": tool_version,
        "standard_scene": scene,
        "output_format": output_format,
    }
    erase_text = str(m.get("standardEraseText") or m.get("standard_erase_text") or "").strip()
    if erase_text and scene == "full_screen_text_erase":
        body["standard_erase_text"] = erase_text

    selected_area = m.get("selectedArea") if "selectedArea" in m else m.get("selected_area")
    if isinstance(selected_area, dict) and scene == "selected_area_erase":
        area: dict[str, float] = {}
        for src_key, dst_key in (
            ("top_left_x", "top_left_x"),
            ("topLeftX", "top_left_x"),
            ("top_left_y", "top_left_y"),
            ("topLeftY", "top_left_y"),
            ("bottom_right_x", "bottom_right_x"),
            ("bottomRightX", "bottom_right_x"),
            ("bottom_right_y", "bottom_right_y"),
            ("bottomRightY", "bottom_right_y"),
        ):
            if src_key not in selected_area:
                continue
            try:
                area[dst_key] = float(selected_area[src_key])
            except (TypeError, ValueError):
                continue
        if len(area) == 4:
            body["selected_area"] = area

    async with httpx.AsyncClient(timeout=_timeout()) as client:
        body["image_url"] = resolved_url or await _resolve_image_url_for_tool(
            client, image_ref, tool_name=_ERASE_TOOL
        )

        mask_url = str(m.get("maskUrl") or m.get("mask_url") or "").strip()
        if mask_bytes and scene == "selected_area_erase":
            mask_url = await _upload_bytes_as_mediakit_uri(
                client,
                mask_bytes,
                filename="erase-mask.png",
                tool_name=_ERASE_TOOL,
            )
        if mask_url and scene == "selected_area_erase":
            body["mask_url"] = mask_url

        if scene == "selected_area_erase" and "mask_url" not in body and "selected_area" not in body:
            raise ValueError("selected_area_erase requires mask_url or selected_area")

        resp = await client.post(
            f"{_base_url()}/api/v1/tools-sync/erase-image",
            headers=_headers(),
            json=body,
        )
        payload = _parse_json_response(resp)
        result = payload.get("result")
        if not isinstance(result, dict):
            raise RuntimeError(f"MediaKit erase missing result: {payload!r}")
        out_url = str(result.get("image_url") or "").strip()
        if not out_url:
            raise RuntimeError(f"MediaKit erase missing image_url: {result!r}")
        dl = await client.get(out_url)
        if dl.status_code >= 400:
            raise RuntimeError(f"failed to download MediaKit erase ({dl.status_code})")
        raw = dl.content

    return {
        "image_bytes": raw,
        "image_url": out_url,
        "width": int(result.get("image_width") or 0) or None,
        "height": int(result.get("image_height") or 0) or None,
        "format": str(result.get("image_format") or output_format).strip().lower(),
        "task_id": str(payload.get("task_id") or "").strip() or None,
        "request_id": str(payload.get("request_id") or "").strip() or None,
        "scene": scene,
    }


def enhance_params_from_meta(
    meta: dict[str, Any] | None,
    *,
    resolution: str | None = None,
) -> dict[str, Any]:
    """Build MediaKit enhance-image size / version fields from FE meta."""
    m = meta or {}
    body: dict[str, Any] = {}

    version = str(m.get("toolVersion") or m.get("tool_version") or "professional").strip().lower()
    if version not in _ENHANCE_VERSIONS:
        version = "professional"
    body["tool_version"] = version

    mode = str(
        m.get("generativeEnhanceMode") or m.get("generative_enhance_mode") or ""
    ).strip().lower()
    if not mode and version in {"professional", "max"}:
        mode = "fidelity_first"
    if mode in _ENHANCE_MODES:
        body["generative_enhance_mode"] = mode

    multiple = _meta_float(m, "multiple", "scale")
    if multiple is not None and multiple >= 1:
        body["multiple"] = round(float(multiple), 2)
        return body

    tw = _meta_int(m, "targetWidth", "target_width", default=0)
    th = _meta_int(m, "targetHeight", "target_height", default=0)
    if tw > 0:
        body["target_width"] = tw
    if th > 0:
        body["target_height"] = th
    if tw > 0 or th > 0:
        return body

    res = str(m.get("resolution") or resolution or "4K").strip().upper()
    if res == "2K":
        body["target_width"] = 2048
        body["target_height"] = 2048
    elif res in {"4K", ""}:
        body["target_width"] = 4096
        body["target_height"] = 4096
    else:
        # Unknown token — treat as multiple if numeric, else 2x.
        try:
            body["multiple"] = max(1.0, float(res))
        except (TypeError, ValueError):
            body["multiple"] = 2.0
    return body


async def enhance_image(
    image_ref: str,
    *,
    meta: dict[str, Any] | None = None,
    resolution: str | None = None,
) -> dict[str, Any]:
    """
    Sync image enhance / upscale via MediaKit ``enhance-image``.

    Returns ``{ image_bytes, image_url, width, height, format, tool_version, task_id }``.
    """
    _require_enabled()
    body = enhance_params_from_meta(meta, resolution=resolution)
    if (
        "multiple" not in body
        and "target_width" not in body
        and "target_height" not in body
    ):
        body["multiple"] = 2.0

    async with httpx.AsyncClient(timeout=_timeout()) as client:
        body["image_url"] = await _resolve_image_url_for_tool(
            client, image_ref, tool_name=_ENHANCE_TOOL
        )
        resp = await client.post(
            f"{_base_url()}/api/v1/tools-sync/enhance-image",
            headers=_headers(),
            json=body,
        )
        payload = _parse_json_response(resp)
        result = payload.get("result")
        if not isinstance(result, dict):
            raise RuntimeError(f"MediaKit enhance missing result: {payload!r}")
        out_url = str(result.get("image_url") or "").strip()
        if not out_url:
            raise RuntimeError(f"MediaKit enhance missing image_url: {result!r}")
        dl = await client.get(out_url)
        if dl.status_code >= 400:
            raise RuntimeError(f"failed to download MediaKit enhance ({dl.status_code})")
        raw = dl.content

    return {
        "image_bytes": raw,
        "image_url": out_url,
        "width": int(result.get("image_width") or 0) or None,
        "height": int(result.get("image_height") or 0) or None,
        "format": str(result.get("image_format") or "png").strip().lower(),
        "tool_version": str(body.get("tool_version") or "professional"),
        "task_id": str(payload.get("task_id") or "").strip() or None,
        "request_id": str(payload.get("request_id") or "").strip() or None,
    }


def _normalize_translate_lang(raw: Any) -> str | None:
    s = str(raw or "").strip().lower().replace("-", "_")
    if not s or s in {"auto", "detect", "none"}:
        return None
    aliases = {
        "zh_cn": "zh",
        "zh_hans": "zh",
        "zh_tw": "zh_hant",
        "zh_hk": "zh_hant",
        "nb_no": "nb",
        "nn": "nb",
        "no": "nb",
    }
    s = aliases.get(s, s)
    if s in _TRANSLATE_LANGS:
        return s
    return None


def translate_params_from_meta(meta: dict[str, Any] | None) -> dict[str, Any]:
    """Build MediaKit translate-image-text fields from FE meta."""
    m = meta or {}
    body: dict[str, Any] = {}

    version = str(
        m.get("toolVersion") or m.get("tool_version") or "seed-translation"
    ).strip().lower()
    if version not in _TRANSLATE_VERSIONS:
        version = "seed-translation"
    body["tool_version"] = version

    target = _normalize_translate_lang(
        m.get("targetLang") if "targetLang" in m else m.get("target_lang")
    )
    if not target:
        target = "zh"
    body["target_lang"] = target

    source = _normalize_translate_lang(
        m.get("sourceLang") if "sourceLang" in m else m.get("source_lang")
    )
    if source:
        body["source_lang"] = source
    return body


async def translate_image_text(
    image_ref: str,
    *,
    meta: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """
    Sync image text translation via MediaKit ``translate-image-text``.

    Returns ``{ image_bytes, image_url, width, height, format, tool_version,
    target_lang, source_lang?, task_id }``.
    """
    _require_enabled()
    body = translate_params_from_meta(meta)

    async with httpx.AsyncClient(timeout=_timeout()) as client:
        body["image_url"] = await _resolve_image_url_for_tool(
            client, image_ref, tool_name=_TRANSLATE_TOOL
        )
        resp = await client.post(
            f"{_base_url()}/api/v1/tools-sync/translate-image-text",
            headers=_headers(),
            json=body,
        )
        payload = _parse_json_response(resp)
        result = payload.get("result")
        if not isinstance(result, dict):
            raise RuntimeError(f"MediaKit translate missing result: {payload!r}")
        out_url = str(result.get("image_url") or "").strip()
        if not out_url:
            raise RuntimeError(f"MediaKit translate missing image_url: {result!r}")
        dl = await client.get(out_url)
        if dl.status_code >= 400:
            raise RuntimeError(f"failed to download MediaKit translate ({dl.status_code})")
        raw = dl.content

    return {
        "image_bytes": raw,
        "image_url": out_url,
        "width": int(result.get("image_width") or 0) or None,
        "height": int(result.get("image_height") or 0) or None,
        "format": str(result.get("image_format") or "png").strip().lower(),
        "tool_version": str(body.get("tool_version") or "seed-translation"),
        "target_lang": str(body.get("target_lang") or "zh"),
        "source_lang": str(body["source_lang"]) if body.get("source_lang") else None,
        "task_id": str(payload.get("task_id") or "").strip() or None,
        "request_id": str(payload.get("request_id") or "").strip() or None,
    }


def _clamp_product_dim(raw: Any, default: int = 600) -> int:
    try:
        n = int(float(raw))
    except (TypeError, ValueError):
        n = default
    return max(512, min(1024, n))


def product_scene_params_from_meta(meta: dict[str, Any] | None) -> dict[str, Any]:
    """Build MediaKit generate-product-scene-image fields from FE meta."""
    m = meta or {}
    version = str(
        m.get("toolVersion") or m.get("tool_version") or "standard"
    ).strip().lower()
    if version not in _PRODUCT_SCENE_VERSIONS:
        version = "standard"
    body: dict[str, Any] = {"tool_version": version}

    batch = _meta_int(m, "batchCount", "batch_count", default=1)
    body["batch_count"] = max(1, min(4, batch if batch > 0 else 1))

    ow = _meta_int(m, "outputWidth", "output_width", default=0)
    oh = _meta_int(m, "outputHeight", "output_height", default=0)
    if ow > 0:
        body["output_width"] = _clamp_product_dim(ow)
    if oh > 0:
        body["output_height"] = _clamp_product_dim(oh)
    if "output_width" not in body and "output_height" not in body:
        body["output_width"] = 600
        body["output_height"] = 600

    prompt = str(m.get("prompt") or m.get("positivePrompt") or "").strip()
    if prompt:
        body["prompt"] = prompt

    product_ratio = _meta_float(m, "productRatio", "product_ratio")
    if product_ratio is not None:
        body["product_ratio"] = max(0.0, min(1.0, float(product_ratio)))

    if version == "standard":
        scene = str(
            m.get("standardScene") or m.get("standard_scene") or "exhibit_home"
        ).strip().lower()
        if scene not in _PRODUCT_STANDARD_SCENES:
            scene = "exhibit_home"
        body["standard_scene"] = scene
        if scene == "general" and not prompt:
            raise ValueError("standard_scene=general requires meta.prompt")
        return body

    if version == "professional":
        if not prompt:
            raise ValueError("professional product scene requires meta.prompt")
        ref = str(
            m.get("professionalReferenceImageUrl")
            or m.get("professional_reference_image_url")
            or m.get("referenceImageUrl")
            or m.get("reference_image_url")
            or ""
        ).strip()
        if not ref:
            raise ValueError(
                "professional product scene requires meta.professionalReferenceImageUrl"
            )
        body["professional_reference_image_url"] = ref
        adapt = _meta_float(
            m,
            "professionalReferenceImageAdaptScale",
            "professional_reference_image_adapt_scale",
            "referenceAdaptScale",
        )
        if adapt is None:
            adapt = 0.9
        body["professional_reference_image_adapt_scale"] = max(0.0, min(1.0, float(adapt)))
        return body

    # industry
    scene_ref = str(
        m.get("industrySceneImageUrl")
        or m.get("industry_scene_image_url")
        or ""
    ).strip()
    if scene_ref:
        body["industry_scene_image_url"] = scene_ref
    detail_ref = str(
        m.get("industryDetailImageUrl")
        or m.get("industry_detail_image_url")
        or ""
    ).strip()
    if detail_ref:
        body["industry_detail_image_url"] = detail_ref
    return body


async def generate_product_scene_image(
    image_ref: str,
    *,
    meta: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """
    Sync product scene generation via MediaKit ``generate-product-scene-image``.

    Returns ``{ images: [{image_bytes, image_url, width, height, format}],
    tool_version, task_id }``.
    """
    _require_enabled()
    body = product_scene_params_from_meta(meta)

    async with httpx.AsyncClient(timeout=_timeout()) as client:
        body["image_url"] = await _resolve_image_url_for_tool(
            client, image_ref, tool_name=_PRODUCT_SCENE_TOOL
        )
        for key in (
            "professional_reference_image_url",
            "industry_scene_image_url",
            "industry_detail_image_url",
        ):
            ref = str(body.get(key) or "").strip()
            if not ref:
                continue
            body[key] = await _resolve_image_url_for_tool(
                client, ref, tool_name=_PRODUCT_SCENE_TOOL
            )

        resp = await client.post(
            f"{_base_url()}/api/v1/tools-sync/generate-product-scene-image",
            headers=_headers(),
            json=body,
        )
        payload = _parse_json_response(resp)
        result = payload.get("result")
        if not isinstance(result, dict):
            raise RuntimeError(f"MediaKit product scene missing result: {payload!r}")
        rows = result.get("images")
        if not isinstance(rows, list) or not rows:
            raise RuntimeError(f"MediaKit product scene missing images: {result!r}")

        out_images: list[dict[str, Any]] = []
        for row in rows:
            if not isinstance(row, dict):
                continue
            out_url = str(row.get("image_url") or "").strip()
            if not out_url:
                continue
            dl = await client.get(out_url)
            if dl.status_code >= 400:
                raise RuntimeError(
                    f"failed to download MediaKit product scene ({dl.status_code})"
                )
            out_images.append(
                {
                    "image_bytes": dl.content,
                    "image_url": out_url,
                    "width": int(row.get("image_width") or 0) or None,
                    "height": int(row.get("image_height") or 0) or None,
                    "format": str(row.get("image_format") or "png").strip().lower(),
                }
            )
        if not out_images:
            raise RuntimeError(f"MediaKit product scene empty images: {result!r}")

    return {
        "images": out_images,
        "tool_version": str(body.get("tool_version") or "standard"),
        "standard_scene": body.get("standard_scene"),
        "task_id": str(payload.get("task_id") or "").strip() or None,
        "request_id": str(payload.get("request_id") or "").strip() or None,
    }
