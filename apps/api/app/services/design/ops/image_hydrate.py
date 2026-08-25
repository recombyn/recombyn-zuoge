"""Hydrate create_image / gen_prompt placeholders into real image URLs."""
from __future__ import annotations

import asyncio
import logging
import re
import time
import uuid
from typing import Any, Callable

_log = logging.getLogger(__name__)

_HYDRATE_KIND = "hydrate"
_OnProgress = Callable[[int, str], None]


def _image_model_from_rules(rules: dict[str, str] | None) -> str:
    from app.services.llm.image import resolve_image_model

    mid = str((rules or {}).get("assets.image_default_model") or "").strip()
    return resolve_image_model(mid or None)


def _resolution_for_model(catalog_id: str) -> str:
    """Catalog default resolution (e.g. 2K) — never hardcode a tier the model rejects."""
    from app.services.llm.image import _catalog_image_limits, _pick_resolution

    limits = _catalog_image_limits(catalog_id)
    return _pick_resolution(None, limits)


def _aspect_or_size_from_args(args: dict[str, Any]) -> str:
    """
    Prefer concrete WxH when the agent set slot size (Seedream clamps via imageLimits).
    Otherwise ``auto`` / smart so the provider picks frame within its aspect list.
    """
    try:
        ww = float(args.get("width") or 0)
        hh = float(args.get("height") or 0)
    except (TypeError, ValueError):
        return "auto"
    if ww >= 40 and hh >= 40:
        return f"{int(round(ww))}x{int(round(hh))}"
    return "auto"


_PRODUCT_PLATE_CUES = (
    "white background",
    "solid background",
    "clean plate",
    "isolated product",
    "product shot",
    "product on",
    "studio product",
    "on white",
    "transparent background",
    "cutout",
    "纯色底",
    "白底",
    "抠图",
    "产品静物",
    "产品图",
    "电商主图",
)


def _truthy_flag(raw: Any) -> bool:
    if raw is True or raw == 1:
        return True
    s = str(raw or "").strip().lower()
    return s in ("1", "true", "yes", "y", "on", "product", "hair")


def _cutout_mode_for_hydrate(args: dict[str, Any]) -> str | None:
    """When to run industrial matting after gen — lettering overlays + product plates."""
    if str(args.get("letteringText") or "").strip():
        return "product"
    mode = str(args.get("cutoutMode") or "").strip().lower()
    if mode in ("product", "hair"):
        return mode
    if _truthy_flag(args.get("removeBg")):
        return "product"
    prompt = str(args.get("genPrompt") or "").lower()
    if any(c in prompt for c in _PRODUCT_PLATE_CUES):
        return "product"
    return None


async def _maybe_cutout_hydrated_src(
    src: str, mode: str, *, user_id: str | None
) -> str:
    """Run industrial matting on a hydrated image URL. Raises on failure."""
    from app.services.vision.remove_bg import remove_background

    cut = await remove_background(src, meta={"cutoutMode": mode}, user_id=user_id)
    cut_src = str((cut or {}).get("image") or "").strip()
    if not cut_src:
        raise RuntimeError("remove background returned no image")
    return cut_src


async def _hydrate_gen_prompt_images(
    svg: str,
    *,
    limit: int = 2,
    rules: dict[str, str] | None = None,
) -> tuple[str, int]:
    """Fill empty data-gen-prompt <image> slots via the routed image model."""
    if not svg or "data-gen-prompt" not in svg.lower():
        return svg, 0
    from app.services.llm.image import generate_image

    catalog_id = _image_model_from_rules(rules)
    resolution = _resolution_for_model(catalog_id)

    pattern = re.compile(
        r"<image\b[^>]*\bdata-gen-prompt\s*=\s*\"([^\"]+)\"[^>]*/?>",
        re.I,
    )
    out = svg
    filled = 0
    for m in list(pattern.finditer(svg)):
        if filled >= limit:
            break
        tag = m.group(0)
        prompt = (m.group(1) or "").strip()
        if not prompt:
            continue
        if re.search(r"xlink:href\s*=\s*['\"]https?://", tag, re.I):
            continue
        try:
            result = await generate_image(
                prompt=prompt,
                model=catalog_id,
                aspect_ratio="auto",
                quality="standard",
                resolution=resolution,
            )
            url = (result.get("images") or [None])[0]
            if not url:
                raise RuntimeError(
                    f"SVG gen-prompt hydrate returned no image for {prompt[:80]!r}"
                )
        except Exception as err:
            raise RuntimeError(
                f"SVG gen-prompt hydrate failed for {prompt[:80]!r}"
            ) from err
        if re.search(r"xlink:href\s*=", tag, re.I):
            new_tag = re.sub(
                r"xlink:href\s*=\s*['\"][^'\"]*['\"]",
                f'xlink:href="{url}"',
                tag,
                count=1,
                flags=re.I,
            )
        else:
            new_tag = tag.replace("<image", f'<image xlink:href="{url}"', 1)
        out = out.replace(tag, new_tag, 1)
        filled += 1
    return out, filled


def _needs_image_hydrate(op: dict[str, Any]) -> bool:
    if not isinstance(op, dict) or str(op.get("name") or "") != "create_image":
        return False
    args = op.get("args") if isinstance(op.get("args"), dict) else {}
    if args.get("attachmentIndex") is not None:
        return False
    if str(args.get("src") or "").strip():
        return False
    return bool(str(args.get("genPrompt") or "").strip())


def _pending_hydrate_count(ops: list[dict[str, Any]], *, limit: int) -> int:
    n = 0
    for op in ops:
        if n >= limit:
            break
        if _needs_image_hydrate(op):
            n += 1
    return n


async def _hydrate_via_celery(
    ops: list[dict[str, Any]],
    *,
    limit: int,
    policy: str,
    rules: dict[str, str] | None,
    on_progress: _OnProgress | None,
    trace_id: str | None = None,
    user_id: str | None = None,
) -> tuple[list[dict[str, Any]], int] | None:
    """Enqueue + poll. Returns None to signal caller should use in-process path."""
    from app.core.config import settings
    from app.services.job_store import get_job, normalize_trace_id, save_job
    from worker.tasks import run_image_hydrate_job

    budget = max(5.0, float(getattr(settings, "design_image_hydrate_timeout_sec", 90.0) or 90.0))
    stall = max(1.0, float(getattr(settings, "design_image_hydrate_queue_stall_sec", 5.0) or 5.0))
    job_id = uuid.uuid4().hex
    tid = normalize_trace_id(trace_id)
    payload = {
        "job_id": job_id,
        "kind": _HYDRATE_KIND,
        "status": "queued",
        "progress": 0,
        "ops": list(ops),
        "limit": limit,
        "policy": policy,
        "rules": {str(k): str(v) for k, v in (rules or {}).items()},
        "user_id": str(user_id or "").strip() or None,
        "result": None,
        "error": None,
        "trace_id": tid,
    }
    save_job(job_id, payload, kind=_HYDRATE_KIND)
    run_image_hydrate_job.delay(job_id)
    try:
        from app.core.metrics import observe_job

        observe_job(_HYDRATE_KIND, "enqueued")
    except Exception:
        pass
    if on_progress:
        on_progress(0, "queued")
    _log.info(
        "hydrate_job event=enqueued job_id=%s trace_id=%s",
        job_id,
        tid,
        extra={"job_id": job_id, "trace_id": tid, "event": "enqueued"},
    )

    deadline = time.monotonic() + budget
    queued_deadline = time.monotonic() + stall
    last_progress = -1
    while time.monotonic() < deadline:
        job = await asyncio.to_thread(get_job, job_id, kind=_HYDRATE_KIND)
        if not job:
            raise RuntimeError(f"hydrate job not found: {job_id}")
        status = str(job.get("status") or "queued")
        progress = int(job.get("progress") or 0)
        if on_progress and progress != last_progress:
            on_progress(progress, status)
            last_progress = progress
        if status == "done":
            result = job.get("result") if isinstance(job.get("result"), dict) else {}
            out = result.get("ops")
            filled = int(result.get("filled") or 0)
            if isinstance(out, list):
                return out, filled
            raise RuntimeError("hydrate job returned invalid result")
        if status == "failed":
            err = str(job.get("error") or "hydrate job failed").strip()
            raise RuntimeError(err)
        if status == "queued" and time.monotonic() >= queued_deadline:
            raise RuntimeError(
                f"hydrate job still queued after {stall:.1f}s (job_id={job_id})"
            )
        await asyncio.sleep(0.35)
    raise RuntimeError(f"hydrate job poll budget exceeded (job_id={job_id})")


async def hydrate_tool_ops_images(
    ops: list[dict[str, Any]],
    *,
    limit: int = 6,
    policy: str = "auto",
    rules: dict[str, str] | None = None,
    on_progress: _OnProgress | None = None,
    trace_id: str | None = None,
    user_id: str | None = None,
) -> tuple[list[dict[str, Any]], int]:
    """Apply/action entry: Celery when enabled, else in-process (ADR 0005)."""
    if policy != "auto" or not ops or limit <= 0:
        return ops, 0
    if _pending_hydrate_count(ops, limit=limit) <= 0:
        return ops, 0

    try:
        from app.core.config import settings

        use_async = bool(getattr(settings, "design_image_hydrate_async", True))
    except Exception:
        use_async = True

    if use_async:
        queued = await _hydrate_via_celery(
            ops,
            limit=limit,
            policy=policy,
            rules=rules,
            on_progress=on_progress,
            trace_id=trace_id,
            user_id=user_id,
        )
        if queued is not None:
            return queued
        raise RuntimeError("hydrate Celery path returned no result")

    return await _hydrate_tool_ops_images(
        ops, limit=limit, policy=policy, rules=rules, user_id=user_id
    )


async def _hydrate_tool_ops_images(
    ops: list[dict[str, Any]],
    *,
    limit: int = 6,
    policy: str = "auto",
    rules: dict[str, str] | None = None,
    user_id: str | None = None,
) -> tuple[list[dict[str, Any]], int]:
    """
    Fill create_image ops that only have genPrompt/prompt via the routed image model.
    Uses catalog ``imageLimits`` (default resolution / aspect / pixel clamp).
    Returns (ops, successful_image_count) for wallet 积分结算.
    """
    if policy != "auto" or not ops or limit <= 0:
        return ops, 0

    from app.services.llm.image import generate_image

    catalog_id = _image_model_from_rules(rules)
    resolution = _resolution_for_model(catalog_id)

    pending_idx: list[int] = []
    for i, op in enumerate(ops):
        if len(pending_idx) >= limit:
            break
        if _needs_image_hydrate(op):
            pending_idx.append(i)
    if not pending_idx:
        return ops, 0

    async def _one(op: dict[str, Any]) -> dict[str, Any]:
        args = dict(op.get("args") or {}) if isinstance(op.get("args"), dict) else {}
        prompt = str(args.get("genPrompt") or "").strip()
        lettering = str(args.get("letteringText") or "").strip()
        # letteringText must reach the image model — otherwise calligraphy gens ignore glyphs.
        if lettering and lettering not in prompt:
            prompt = (
                f"{prompt}\nExact glyphs to render (letteringText): {lettering}. "
                "Isolated lettering only on a plain solid background (for cutout)."
                if prompt
                else (
                    f"Render exact text only: {lettering}. "
                    "Isolated lettering on a plain solid background (for cutout)."
                )
            )
        aspect = _aspect_or_size_from_args(args)
        try:
            result = await generate_image(
                prompt=prompt[:800],
                model=catalog_id,
                aspect_ratio=aspect,
                quality="standard",
                resolution=resolution,
            )
            url = (result.get("images") or [None])[0]
        except Exception as err:
            raise RuntimeError(
                f"image hydrate generation failed for prompt {prompt[:80]!r}"
            ) from err
        if not url:
            raise RuntimeError(
                f"image hydrate returned no image for prompt {prompt[:80]!r}"
            )
        src = str(url)
        # Lettering + product plates → transparent overlay (models love opaque white boxes).
        cut_mode = _cutout_mode_for_hydrate(args)
        if cut_mode:
            src = await _maybe_cutout_hydrated_src(src, cut_mode, user_id=user_id)
            args["cutoutApplied"] = True
            args["cutoutMode"] = cut_mode
        args["src"] = src
        next_op: dict[str, Any] = {"name": "create_image", "args": args}
        if op.get("op_id"):
            next_op["op_id"] = op["op_id"]
        return next_op

    try:
        from app.core.config import settings

        budget = float(
            getattr(settings, "design_image_hydrate_timeout_sec", 90.0) or 90.0
        )
    except Exception:
        budget = 90.0
    budget = max(5.0, budget)

    task_by_idx: dict[asyncio.Task[Any], int] = {
        asyncio.create_task(_one(ops[i])): i for i in pending_idx
    }
    done, pending = await asyncio.wait(
        set(task_by_idx.keys()), timeout=budget
    )
    for t in pending:
        t.cancel()
    if pending:
        raise RuntimeError(
            f"image hydrate timed out after {budget:.1f}s with {len(pending)} pending ops"
        )

    out = list(ops)
    filled = 0
    for t in done:
        i = task_by_idx[t]
        try:
            new_op = t.result()
        except Exception as err:
            raise RuntimeError(f"image hydrate op at index {i} failed") from err
        out[i] = new_op
        args = new_op.get("args") if isinstance(new_op.get("args"), dict) else {}
        if str((args or {}).get("src") or (args or {}).get("url") or "").strip():
            filled += 1
    if filled < len(pending_idx):
        raise RuntimeError(
            f"image hydrate incomplete: {filled}/{len(pending_idx)} ops succeeded"
        )
    return out, filled
