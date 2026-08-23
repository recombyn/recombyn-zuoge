"""img_layers board job — generate → decompose → tool_ops SSE (same apply path as ops)."""

from __future__ import annotations

import asyncio
import json
import logging
import time
import uuid
from collections.abc import AsyncIterator
from typing import Any

from app.services.design.admin.task_store import _insert_task, _update_task
from app.services.design.img_layers.decompose import decompose_board_layers
from app.services.design.img_layers.generate_board import generate_board_image
from app.services.design.img_layers.to_tool_ops import layers_to_tool_ops
from app.services.design.ops.tool_ops_contract import (
    TOOL_OPS_SCHEMA_VERSION,
    tool_ops_activity_events,
    tool_ops_for_sse,
)
from app.services.design.prompts.rules_text import exec_trace
from app.services.design.readpath.canvas_scene import parse_size, scene_key
from app.services.wallet.db import get_user_credits

_log = logging.getLogger(__name__)


def _resolve_board_wh(
    canvas_size: str | None,
    *,
    rules: dict[str, str] | None,
    scene: str | None = None,
) -> tuple[int, int]:
    sk = scene_key(scene) or "poster"
    w, h = parse_size(canvas_size, sk, rules or {})
    if w > 0 and h > 0:
        return int(w), int(h)
    return 1080, 1920


async def run_img_layers_job(
    *,
    user_id: str,
    prompt: str,
    rules: dict[str, str],
    canvas_size: str | None,
    images: list[str] | None,
    session_id: str,
    project_id: str,
    hold: int,
    free_daily: bool,
    t0: float,
    settle_hold_fn: Any,
    refund_hold_fn: Any,
    scene: str | None = None,
) -> AsyncIterator[dict[str, Any]]:
    """SSE stream used by FE tool_ops apply + result settle."""
    task_id = str(uuid.uuid4())
    trace_id = str(uuid.uuid4())
    sid = str(session_id or "").strip()
    pid = str(project_id or "").strip() or "__none__"
    w, h = _resolve_board_wh(canvas_size, rules=rules, scene=scene)
    ref_images = [u for u in (images or []) if isinstance(u, str) and u.strip()][:4]

    try:
        from app.services.llm.usage_log import bind_usage_context

        bind_usage_context(user_id=user_id, task_id=task_id, source="design")
    except Exception:
        pass

    _insert_task(
        {
            "id": task_id,
            "user_id": user_id,
            "canvas_id": None,
            "scene": "img_layers",
            "skill_group_id": None,
            "task_type": "img_layers",
            "user_selected_model": "auto",
            "actual_models": "[]",
            "target_layer_id": None,
            "current_skill_index": 0,
            "status": "running",
            "hold_credits": hold,
            "charged_credits": 0,
            "total_tokens": 0,
            "prompt": prompt,
            "canvas_size": f"{w}x{h}",
            "result_svg": None,
            "error_message": None,
            "meta_json": json.dumps(
                {"paint_mode": "img_layers", "trace_id": trace_id},
                ensure_ascii=False,
            ),
            "created_at": time.time(),
            "updated_at": time.time(),
        }
    )
    yield {"type": "task", "taskId": task_id, "task_id": task_id, "trace_id": trace_id}
    yield {
        "type": "skill_start",
        "index": 0,
        "skill_id": None,
        "skill_key": "img_layers",
        "skill_name": "生图拆层",
        "category": "create",
        "model": "image",
        "model_reason": "paint_mode=img_layers",
    }
    yield {
        "type": "activity",
        "id": "img-layers-gen",
        "kind": "tool",
        "status": "running",
        "summary": "正在生成整板图片…",
        "index": 0,
    }
    yield {
        "type": "token",
        "text": "生图拆层模式：先生成整板，再拆成可编辑图层。\n",
    }

    board_src = ""
    image_model = ""
    warnings: list[str] = []
    try:
        gen = await generate_board_image(
            prompt=prompt,
            width=w,
            height=h,
            rules=rules,
            ref_images=ref_images or None,
        )
        board_src = str(gen.get("src") or "")
        image_model = str(gen.get("model") or "")
    except Exception as err:  # noqa: BLE001
        _log.exception("img_layers generate failed task=%s", task_id)
        try:
            refund_hold_fn(user_id, hold, task_id=task_id)
        except Exception:
            _log.exception("img_layers refund failed task=%s", task_id)
        _update_task(task_id, status="error", charged_credits=0, total_tokens=0, result_svg="")
        yield {
            "type": "error",
            "code": "img_layers_generate_failed",
            "message": str(err)[:300] or "img_layers_generate_failed",
            "task_id": task_id,
        }
        return

    if not board_src:
        try:
            refund_hold_fn(user_id, hold, task_id=task_id)
        except Exception:
            pass
        _update_task(task_id, status="error", charged_credits=0, total_tokens=0, result_svg="")
        yield {
            "type": "error",
            "code": "img_layers_generate_empty",
            "message": "img_layers_generate_empty",
            "task_id": task_id,
        }
        return

    yield {
        "type": "activity",
        "id": "img-layers-gen",
        "kind": "tool",
        "status": "done",
        "summary": "整板图片已生成",
        "index": 0,
    }
    yield {
        "type": "activity",
        "id": "img-layers-split",
        "kind": "tool",
        "status": "running",
        "summary": "正在拆分层（文字 / 主体 / 背景）…",
        "index": 0,
    }

    decomposed = await decompose_board_layers(image=board_src)
    layers = [L for L in (decomposed.get("layers") or []) if isinstance(L, dict)]
    src_w = int(decomposed.get("width") or 0) or w
    src_h = int(decomposed.get("height") or 0) or h
    for wmsg in decomposed.get("warnings") or []:
        s = str(wmsg or "").strip()
        if s:
            warnings.append(s)

    yield {
        "type": "activity",
        "id": "img-layers-split",
        "kind": "tool",
        "status": "done",
        "summary": f"已拆出 {len(layers)} 层",
        "index": 0,
        "count": len(layers),
    }

    step_ops = layers_to_tool_ops(
        layers,
        canvas_w=w,
        canvas_h=h,
        src_w=src_w,
        src_h=src_h,
        frame_name="AI Board",
        board_src=board_src,
    )
    yield {
        "type": "tool_ops",
        "index": 0,
        "task_id": task_id,
        "trace_id": trace_id,
        "skill_key": "img_layers",
        "skill_name": "生图拆层",
        "schema_version": TOOL_OPS_SCHEMA_VERSION,
        "ops": tool_ops_for_sse(step_ops),
    }
    for act in tool_ops_activity_events(
        batch=step_ops,
        totals={"created": 0, "updated": 0, "deleted": 0},
        skill_index=0,
    ):
        yield act

    used = max(1, len(prompt) // 4 + len(layers) * 8)
    yield {
        "type": "skill_done",
        "index": 0,
        "skill_key": "img_layers",
        "skill_name": "生图拆层",
        "tokens": used,
    }

    reply = f"已用生图拆层完成画板（{len(layers)} 层"
    if warnings:
        reply += f"；注意：{warnings[0][:80]}"
    reply += "）。可继续在画布上编辑。"
    yield {"type": "token", "text": reply}

    spend = 0
    try:
        spend = int(
            settle_hold_fn(
                user_id,
                hold=hold,
                actual_tokens=used,
                detail=f"design_settle:img_layers:{task_id}",
                rules=rules,
                free_daily=free_daily,
                images_hydrated=1,
                mode="agent",
            )
            or 0
        )
    except Exception:
        _log.exception("img_layers settle failed task=%s", task_id)
        try:
            refund_hold_fn(user_id, hold, task_id=task_id)
        except Exception:
            pass

    _update_task(
        task_id,
        status="success",
        charged_credits=spend,
        total_tokens=used,
        result_svg="",
    )
    balance = get_user_credits(user_id)
    yield {
        "type": "result",
        "task_id": task_id,
        "trace_id": trace_id,
        "status": "success",
        "svg": "",
        "summary": reply[:500],
        "charged_credits": spend,
        "total_tokens": used,
        "tool_ops_applied": True,
        "intent": "create",
        "edit_in_place": False,
        "balance": balance,
        "paint_mode": "img_layers",
        "image_model": image_model or None,
        "warnings": warnings[:5] or None,
    }
    try:
        from app.services.agent_memory.episodes import maybe_write_episode

        maybe_write_episode(
            user_id=user_id,
            session_id=sid,
            project_id=pid,
            task_id=task_id,
            scene="img_layers",
            goal=prompt,
            summary=reply[:400],
            applied_ops=list(step_ops or []),
            observe={"ops_applied": True, "route": "img_layers", "layers": len(layers)},
            outcome="success",
            chat_only=False,
            tool_ops_applied=True,
            rules=rules,
        )
    except Exception:
        _log.exception("episode write failed img_layers task=%s", task_id)

    exec_trace(
        t0,
        "DONE",
        mode="img_layers",
        tokens=used,
        ops=len(step_ops),
        layers=len(layers),
        trace_id=trace_id,
    )
    await asyncio.sleep(0)
