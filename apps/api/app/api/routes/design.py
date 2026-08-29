"""Design run API — LangGraph canvas_ops (agent / single_model; partial → single_model)."""

from __future__ import annotations

import asyncio
import json
import logging
import time
import uuid
from collections.abc import AsyncIterator, Callable
from typing import Any

from fastapi import APIRouter, File, Form, Query, Request, UploadFile
from app.api.deps import CurrentUser
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field

from app.services.agent_memory.long_term import insert_long_memory
from app.services.design.readpath.catalog import ensure_design_catalog, get_catalog_payload
from app.services.design.runtime.orchestrator import run_design_job_from_snapshot
from app.services.design.runtime.pipeline_support import _run_error_code
from app.services.design.runtime.pipeline_progress import PipelineSseState
from app.services.design.runtime.sse_transport import local_run_sse as _transport_local_run_sse, worker_run_sse as _worker_run_sse
from app.services.i18n.errors import http_error, value_error_http
from app.services.i18n.locale import LocaleDep

_SKILL_VALUE_ERRORS = {"skill not found": (404, "skill_not_found")}

router = APIRouter(prefix="/design", tags=["design"])
_log = logging.getLogger("design.run_api")

_SSE_HEADERS = {
    "Cache-Control": "no-cache, no-transform",
    "Connection": "keep-alive",
    "X-Accel-Buffering": "no",
}


async def _local_run_sse(
    task_id: str,
    source: Callable[[], AsyncIterator[dict[str, Any]]],
) -> AsyncIterator[str]:
    """Shared local /run and /resume SSE transport."""
    state = _PipelineSseState(task_id=task_id)

    def emit(event: dict[str, Any]) -> list[dict[str, Any]]:
        state.remember_task_id(event)
        return list(_pipeline_side_effects(state, event))

    async for frame in _transport_local_run_sse(
        source,
        emit=emit,
        persist=state.persist_event,
        heartbeat=state.heartbeat_stage_event,
        terminal=state.terminal_stage_event,
        decorate=state.decorate,
        error_code=_run_error_code,
    ):
        yield frame
    return

class _PipelineSseState(PipelineSseState):
    """Route-owned persistence adapter for the shared SSE progress state."""

    def persist_event(self, payload: Any) -> None:
        self.remember_task_id(payload)
        if not self.task_id or not isinstance(payload, dict):
            return
        try:
            from app.services.design.runtime.event_publisher import publish_design_output

            publish_design_output(self.task_id, payload)
        except Exception:
            _log.exception("design event persistence failed task=%s", self.task_id)

def _pipeline_side_effects(
    state: _PipelineSseState, payload: dict[str, Any]
) -> list[dict[str, Any]]:
    return state.observe(payload)


def _should_log_sse(et: str | None, out_n: int) -> bool:
    return out_n <= 12 or et in (
        "thinking",
        "analysis_delta",
        "skill_start",
        "error",
    )


def _sse_log_line(
    *, t0: float, out_n: int, et: str | None, payload: Any
) -> str:
    preview = ""
    if isinstance(payload, dict) and et in ("thinking", "analysis_delta"):
        preview = repr(str(payload.get("text") or "")[:60])
    return f"[sse_out] +{time.time() - t0:6.2f}s  n={out_n} type={et} {preview}"


class DesignRunIn(BaseModel):
    run_mode: str = Field(
        ...,
        description="agent | single_model | partial (legacy alias → single_model)",
    )
    prompt: str = Field(..., min_length=1)
    scene: str | None = None
    style_group_id: int | None = None
    user_selected_model: str | None = "auto"
    # End-user Auto routing prefs (tier models / vision / image). Server ignores cost levers.
    route_overrides: dict[str, str] | None = None
    canvas_id: str | None = None
    canvas_size: str | None = None
    # Client-measured reference image WxH hints (e.g. ["750x1624"]) for auto canvas.
    ref_image_sizes: list[str] | None = None
    target_layer_id: str | None = None
    layer_ids: list[str] | None = None
    current_svg: str | None = None
    # Editable scene inventory for edit-in-place tool ops (id / fill / text / bounds).
    scene_nodes: list[dict[str, Any]] | None = None
    # Artboard list (id / name / size) — delete_frame validation + SCENE_FRAMES prompt.
    scene_frames: list[dict[str, Any]] | None = None
    # Client dual-context map (focused / peripheral / empty_rects / suggested_place).
    spatial_summary: dict[str, Any] | None = None
    focus_frame_id: str | None = None
    # User-attached reference images (data URLs or https) — multimodal vision + create_image.
    images: list[str] | None = None
    session_id: str | None = Field(default=None, max_length=64)
    project_id: str | None = Field(default=None, max_length=128)
    memory: dict[str, Any] | None = Field(
        default=None,
        description="Agent memory bundle: medium task_state, optional short turns, retrieve_long flag",
    )
    apply_ops: list[dict[str, Any]] | None = Field(
        default=None,
        description="Ask confirm: apply previously proposed tool_ops without a new LLM plan",
    )
    proposal_id: str | None = Field(
        default=None,
        max_length=64,
        description="Ask pending proposal id (typed confirm → intent proposal_action)",
    )
    proposal_task_id: str | None = Field(
        default=None,
        max_length=64,
        description="design_task id that holds meta.ask_proposal for proposal_id",
    )
    interaction_mode: str | None = Field(
        default=None,
        description="agent | ask — Ask proposes / clarifies before painting",
    )
    paint_mode: str | None = Field(
        default=None,
        description="ops (default tool_ops) | img_layers (generate board then split layers)",
    )
    skill_refs: list[str] | None = Field(
        default=None,
        description="User-pinned skill keys/ids from / picker chips (hard-load)",
    )
    locale: str | None = Field(
        default=None,
        max_length=16,
        description="UI locale (zh-CN | zh-TW | en | ja) — drives agent output language",
    )
    design_intensity: str | None = Field(
        default=None,
        max_length=16,
        description="Design depth: light | medium | high | extreme (pipeline, not model thinking)",
    )


class UserSkillIn(BaseModel):
    id: int | None = None
    name: str = Field(..., min_length=1, max_length=128)
    description: str | None = Field(default=None, max_length=2000)
    whenToUse: str | None = Field(default=None, max_length=2000)
    promptPositive: str = Field(..., min_length=1, max_length=120_000)
    promptNegative: str | None = Field(default=None, max_length=40_000)
    skillKey: str | None = Field(default=None, max_length=64)
    logo: str | None = Field(default=None, max_length=80_000)
    category: str | None = Field(default=None, max_length=64)
    enabled: bool = True


class UserSkillEnabledIn(BaseModel):
    enabled: bool


class SceneFeedbackIn(BaseModel):
    scene_nodes: list[dict[str, Any]] = Field(default_factory=list)
    scene_frames: list[dict[str, Any]] = Field(default_factory=list)
    spatial_summary: dict[str, Any] | None = None
    # Per-op execution outcome from FE ({op_id, name, ok, error}) — truth for "did it apply".
    op_results: list[dict[str, Any]] | None = None
    round: int | None = None
    # Design Engine V3 — ACK / rollback for DesignTransaction.
    transaction_id: str | None = None
    transaction_status: str | None = None  # ack | rollback
    base_revision: int | None = None


@router.get("/catalog")
def design_catalog() -> dict[str, Any]:
    ensure_design_catalog()
    return get_catalog_payload()


@router.get("/canvas-tools")
def design_canvas_tools() -> dict[str, Any]:
    """Public capability table — FE executes ops by the same op_key."""
    ensure_design_catalog()
    from app.services.design.ops.tool_ops_contract import list_canvas_tools

    return {"items": list_canvas_tools(enabled_only=True)}


@router.get("/skills")
def design_skills_picker(
    current_user: CurrentUser,
    scene: str | None = None,
    mine: bool = Query(default=False),
    manage: bool = Query(default=False),
) -> dict[str, Any]:
    """Skills for `/` picker, mine list, or toolbox (`manage=true`, includes disabled)."""
    from app.services.design.prompts.skill_store import (
        list_my_skills,
        list_skills_for_manage,
        list_skills_for_picker,
    )

    scene_l = (scene or "").strip() or ""
    if manage:
        return {"items": list_skills_for_manage(user_id=current_user.id, scene=scene_l)}
    if mine:
        return {"items": list_my_skills(user_id=current_user.id)}
    return {"items": list_skills_for_picker(user_id=current_user.id, scene=scene_l)}


@router.post("/skills")
def design_skills_upsert(
    locale: LocaleDep,
    current_user: CurrentUser,
    body: UserSkillIn,
) -> dict[str, Any]:
    from app.services.design.prompts.skill_store import upsert_end_user_skill

    try:
        item = upsert_end_user_skill(user_id=current_user.id, payload=body.model_dump())
    except ValueError as err:
        raise value_error_http(err, locale, known=_SKILL_VALUE_ERRORS) from err
    return {"item": item}


@router.post("/skills/import")
async def design_skills_import_zip(
    locale: LocaleDep,
    current_user: CurrentUser,
    file: UploadFile = File(
        ...,
        description="Skill pack .zip or .recombyn-plugin (_meta.json + SKILL.md)",
    ),
    overwrite: bool = Form(default=False),
) -> dict[str, Any]:
    """Upload a skill / plugin pack — scan, optional overwrite, then save."""
    from app.services.design.prompts.skill_store import import_end_user_skill_zip

    raw = await file.read()
    try:
        result = import_end_user_skill_zip(
            user_id=current_user.id,
            filename=file.filename or "skill.zip",
            raw=raw,
            overwrite=bool(overwrite),
        )
    except ValueError as err:
        raise value_error_http(err, locale, known=_SKILL_VALUE_ERRORS) from err
    return result


@router.post("/plugins/install")
async def design_plugins_install(
    locale: LocaleDep,
    current_user: CurrentUser,
    file: UploadFile = File(
        ...,
        description=".recombyn-plugin pack (plugin.json + skill or canvas files)",
    ),
    overwrite: bool = Form(default=False),
) -> dict[str, Any]:
    """Install a branded ``.recombyn-plugin`` pack (skill → user DB; canvas → disk when enabled)."""
    from app.services.design.plugins import install_recombyn_plugin

    raw = await file.read()
    try:
        return install_recombyn_plugin(
            user_id=current_user.id,
            filename=file.filename or "pack.recombyn-plugin",
            raw=raw,
            overwrite=bool(overwrite),
        )
    except ValueError as err:
        raise value_error_http(err, locale, known=_SKILL_VALUE_ERRORS) from err


@router.patch("/skills/{skill_id}/enabled")
def design_skills_set_enabled(
    locale: LocaleDep,
    current_user: CurrentUser,
    skill_id: int,
    body: UserSkillEnabledIn,
) -> dict[str, Any]:
    """Per-user on/off for toolbox switches (official via prefs; mine via row+pref)."""
    from app.services.design.prompts.skill_store import set_user_skill_enabled

    try:
        item = set_user_skill_enabled(
            user_id=current_user.id, skill_id=skill_id, enabled=bool(body.enabled)
        )
    except ValueError as err:
        raise value_error_http(err, locale, known=_SKILL_VALUE_ERRORS) from err
    return {"item": item}


@router.delete("/skills/{skill_id}")
def design_skills_delete(
    locale: LocaleDep,
    current_user: CurrentUser,
    skill_id: int,
) -> dict[str, Any]:
    from app.services.design.prompts.skill_store import delete_end_user_skill

    try:
        ok = delete_end_user_skill(user_id=current_user.id, skill_id=skill_id)
    except ValueError as err:
        raise value_error_http(err, locale, known=_SKILL_VALUE_ERRORS) from err
    if not ok:
        raise http_error(404, "skill_not_found", locale)
    return {"ok": True}


@router.post("/run")
async def design_run(
    current_user: CurrentUser,
    body: DesignRunIn,
    request: Request,
    locale: LocaleDep,
) -> StreamingResponse:
    from app.core.metrics import observe_design_run_start
    from app.services.geoip import resolve_client_country

    observe_design_run_start(str(body.run_mode or "agent"))
    client_country = resolve_client_country(request)
    run_task_id = str(uuid.uuid4())
    from app.services.design.admin.task_store import (
        build_worker_snapshot,
        initialize_design_task,
    )
    worker_snapshot = build_worker_snapshot(
        mode=body.run_mode,
        prompt=body.prompt,
        canvas_id=body.canvas_id,
        canvas_size=body.canvas_size,
        scene=body.scene,
        focus_frame_id=body.focus_frame_id,
        scene_nodes=body.scene_nodes,
        scene_frames=body.scene_frames,
        images=body.images,
        user_selected_model=body.user_selected_model,
        style_group_id=body.style_group_id,
        ref_image_sizes=body.ref_image_sizes,
        target_layer_id=body.target_layer_id,
        layer_ids=body.layer_ids,
        current_svg=body.current_svg,
        spatial_summary=body.spatial_summary,
        session_id=body.session_id,
        project_id=body.project_id or body.canvas_id,
        memory=body.memory,
        route_overrides=body.route_overrides,
        apply_ops=body.apply_ops,
        proposal_id=body.proposal_id,
        proposal_task_id=body.proposal_task_id,
        interaction_mode=body.interaction_mode,
        client_country=client_country,
        skill_refs=body.skill_refs,
        paint_mode=body.paint_mode,
        locale=body.locale,
        design_intensity=body.design_intensity,
    )

    await asyncio.to_thread(
        initialize_design_task,
        {
            "id": run_task_id,
            "user_id": current_user.id,
            "canvas_id": body.canvas_id,
            "scene": body.scene,
            "skill_group_id": body.style_group_id,
            "task_type": body.run_mode,
            "user_selected_model": body.user_selected_model or "auto",
            "actual_models": "[]",
            "target_layer_id": body.target_layer_id,
            "current_skill_index": 0,
            "status": "queued",
            "hold_credits": 0,
            "charged_credits": 0,
            "total_tokens": 0,
            "prompt": body.prompt,
            "canvas_size": body.canvas_size,
            "result_svg": None,
            "error_message": None,
            "meta_json": json.dumps(
                {
                    "worker_snapshot": worker_snapshot
                },
                ensure_ascii=False,
            ),
            "created_at": time.time(),
            "updated_at": time.time(),
        },
    )

    from app.core.config import settings
    if bool(getattr(settings, "design_agent_worker_enabled", False)):
        try:
            from worker.tasks import run_design_agent_job

            run_design_agent_job.delay(run_task_id)
        except Exception as err:
            raise http_error(503, "design_worker_unavailable", locale) from err
        return StreamingResponse(
            _worker_run_sse(run_task_id),
            media_type="text/event-stream",
            headers={
                "Cache-Control": "no-cache, no-transform",
                "Connection": "keep-alive",
                "X-Accel-Buffering": "no",
            },
        )

    async def source() -> AsyncIterator[dict[str, Any]]:
        async for event in run_design_job_from_snapshot(
            user_id=current_user.id,
            snapshot=worker_snapshot,
            task_id=run_task_id,
        ):
            yield event

    return StreamingResponse(_local_run_sse(run_task_id, source), media_type="text/event-stream", headers=_SSE_HEADERS)

@router.post("/run/{task_id}/scene")
async def design_run_scene_feedback(
    current_user: CurrentUser,
    task_id: str,
    body: SceneFeedbackIn,
) -> dict[str, Any]:
    """FE posts real canvas inventory after applying tool_ops (between agent rounds)."""
    from app.services.design.runtime.scene_feedback import publish_scene

    n = len(body.scene_nodes or [])
    f = len(body.scene_frames or [])
    failed = [
        r
        for r in (body.op_results or [])
        if isinstance(r, dict) and not r.get("ok", True)
    ]
    _log.info(
        "[design.scene_feedback] task=%s round=%s nodes=%s frames=%s op_failed=%s",
        task_id,
        body.round,
        n,
        f,
        len(failed),
    )
    ok = await publish_scene(
        task_id,
        body.scene_nodes,
        frames=body.scene_frames,
        spatial=body.spatial_summary,
        op_results=body.op_results,
        round_n=body.round,
        transaction_id=body.transaction_id,
        transaction_status=body.transaction_status,
        base_revision=body.base_revision,
    )
    return {
        "ok": ok,
        "count": n,
        "frames": f,
        "transaction_id": body.transaction_id,
        "transaction_status": body.transaction_status,
    }


class DesignResumeIn(BaseModel):
    resume_token: str | None = None


class CanvasCommandAckIn(BaseModel):
    seq: int = Field(ge=0)


@router.get("/run/{task_id}")
def design_run_status(
    locale: LocaleDep,
    current_user: CurrentUser,
    task_id: str,
) -> dict[str, Any]:
    from app.services.design.runtime.graph.build import get_design_run_status

    st = get_design_run_status(task_id)
    if not st:
        raise http_error(404, "task_not_found", locale)
    if str(st.get("user_id") or "") != str(current_user.id):
        raise http_error(403, "forbidden", locale)
    st.pop("user_id", None)
    return st


@router.get("/run/{task_id}/events")
def design_run_events(
    locale: LocaleDep,
    current_user: CurrentUser,
    task_id: str,
    after_seq: int = Query(default=0, ge=0),
    limit: int = Query(default=96, ge=1, le=96),
) -> dict[str, Any]:
    """Replay the safe product timeline after an SSE reconnect."""
    from app.services.design.admin.task_store import get_design_task, get_task_events

    row = get_design_task(task_id)
    if not row:
        raise http_error(404, "task_not_found", locale)
    if str(row.get("user_id") or "") != str(current_user.id):
        raise http_error(403, "forbidden", locale)
    return get_task_events(task_id, after_seq=after_seq, limit=limit)


@router.get("/run/{task_id}/trace")
def design_run_trace(
    locale: LocaleDep,
    current_user: CurrentUser,
    task_id: str,
    after_seq: int = Query(default=0, ge=0),
    limit: int = Query(default=256, ge=1, le=256),
) -> dict[str, Any]:
    """Model-lane session trace for eval/debug (no canvas payloads)."""
    from app.services.design.admin.task_store import get_design_task
    from app.services.design.runtime.session_log import get_trace

    row = get_design_task(task_id)
    if not row:
        raise http_error(404, "task_not_found", locale)
    if str(row.get("user_id") or "") != str(current_user.id):
        raise http_error(403, "forbidden", locale)
    return get_trace(task_id, after_seq=after_seq, limit=limit)


@router.get("/run/{task_id}/commands")
def design_run_commands(
    locale: LocaleDep,
    current_user: CurrentUser,
    task_id: str,
    after_seq: int = Query(default=0, ge=0),
) -> dict[str, Any]:
    from app.services.design.admin.task_store import get_canvas_commands, get_design_task

    row = get_design_task(task_id)
    if not row or str(row.get("user_id") or "") != str(current_user.id):
        raise http_error(404, "task_not_found", locale)
    return get_canvas_commands(task_id, after_seq=after_seq)


@router.post("/run/{task_id}/commands/ack")
def design_run_commands_ack(
    locale: LocaleDep,
    current_user: CurrentUser,
    task_id: str,
    body: CanvasCommandAckIn,
) -> dict[str, Any]:
    from app.services.design.admin.task_store import acknowledge_canvas_commands, get_design_task

    row = get_design_task(task_id)
    if not row or str(row.get("user_id") or "") != str(current_user.id):
        raise http_error(404, "task_not_found", locale)
    acknowledge_canvas_commands(task_id, body.seq)
    return {"ok": True, "seq": body.seq}


@router.post("/run/{task_id}/pause")
def design_run_pause(
    locale: LocaleDep,
    current_user: CurrentUser,
    task_id: str,
) -> dict[str, Any]:
    from app.services.design.admin.task_store import get_design_task
    from app.services.design.runtime.graph.build import request_design_pause

    row = get_design_task(task_id)
    if not row:
        raise http_error(404, "task_not_found", locale)
    if str(row.get("user_id") or "") != str(current_user.id):
        raise http_error(403, "forbidden", locale)
    return request_design_pause(task_id)


@router.post("/run/{task_id}/cancel")
async def design_run_cancel(
    locale: LocaleDep,
    current_user: CurrentUser,
    task_id: str,
) -> dict[str, Any]:
    from app.services.design.admin.task_store import get_design_task
    from app.services.design.runtime.graph.build import (
        cleanup_design_checkpoint,
        request_design_cancel,
    )
    from app.services.design.runtime.orchestrator import _refund_hold

    row = get_design_task(task_id)
    if not row:
        raise http_error(404, "task_not_found", locale)
    if str(row.get("user_id") or "") != str(current_user.id):
        raise http_error(403, "forbidden", locale)
    out = request_design_cancel(task_id, refund_hold_fn=_refund_hold)
    if out.get("cleanup_checkpoint"):
        await cleanup_design_checkpoint(task_id)
    return out


@router.post("/run/{task_id}/resume")
async def design_run_resume(
    current_user: CurrentUser,
    task_id: str,
    locale: LocaleDep,
    body: DesignResumeIn | None = None,
) -> StreamingResponse:
    """Resume a paused / waiting_client / resumable-error design run (SSE)."""
    token = (body.resume_token if body else None) or None
    from app.services.design.runtime.orchestrator import resume_design_job
    from app.services.design.admin.task_store import (
        get_design_task,
        get_run_lifecycle,
        parse_task_meta,
        task_is_resumable,
    )

    row = get_design_task(task_id)
    if not row:
        raise http_error(404, "task_not_found", locale)
    if str(row.get("user_id") or "") != str(current_user.id):
        raise http_error(403, "forbidden", locale)
    if not task_is_resumable(row):
        raise http_error(409, "not_resumable", locale)
    expected_token = str(get_run_lifecycle(parse_task_meta(row.get("meta_json"))).get("resume_token") or "")
    if not token or not expected_token or token != expected_token:
        raise http_error(403, "resume_token_mismatch", locale)

    from app.core.config import settings
    if bool(getattr(settings, "design_agent_worker_enabled", False)):
        try:
            from worker.tasks import run_design_agent_job

            run_design_agent_job.delay(task_id, True, token)
        except Exception as err:
            raise http_error(503, "design_worker_unavailable", locale) from err
        return StreamingResponse(
            _worker_run_sse(task_id),
            media_type="text/event-stream",
            headers={
                "Cache-Control": "no-cache, no-transform",
                "Connection": "keep-alive",
                "X-Accel-Buffering": "no",
            },
        )

    async def source() -> AsyncIterator[dict[str, Any]]:
        async for event in resume_design_job(
            user_id=current_user.id,
            task_id=task_id,
            resume_token=token,
        ):
            yield event

    return StreamingResponse(_local_run_sse(task_id, source), media_type="text/event-stream", headers=_SSE_HEADERS)


class LottieGenerateIn(BaseModel):
    prompt: str = Field(..., min_length=1, max_length=2000)
    width: int = Field(default=200, ge=32, le=2048)
    height: int = Field(default=200, ge=32, le=2048)
    duration_sec: float = Field(default=3.0, ge=0.5, le=30.0)
    model: str | None = Field(default=None, max_length=128)
    images: list[str] | None = Field(default=None, max_length=8)


@router.post("/lottie/generate")
async def design_lottie_generate(
    locale: LocaleDep,
    current_user: CurrentUser,
    body: LottieGenerateIn,
) -> dict[str, Any]:
    """Generate Bodymovin JSON for the on-canvas Lottie generator plate."""
    prompt = body.prompt.strip()
    if not prompt:
        raise http_error(400, "empty_prompt", locale)
    from app.services.design.ops.animation_hydrate import generate_lottie_animation

    animation = await generate_lottie_animation(
        prompt=prompt,
        width=int(body.width),
        height=int(body.height),
        duration_sec=float(body.duration_sec),
        model=body.model,
        images=body.images,
    )
    import json as _json

    from app.services.assets import create_asset_from_bytes

    raw = _json.dumps(animation, ensure_ascii=False, separators=(",", ":")).encode(
        "utf-8"
    )
    asset = create_asset_from_bytes(
        current_user.id,
        raw,
        kind="lottie",
        mime="application/json",
        source="ai_lottie",
        prompt=prompt[:500] or None,
        filename_ext="json",
        width=int(animation.get("w") or body.width or 0) or None,
        height=int(animation.get("h") or body.height or 0) or None,
    )
    stored_url = str(asset.get("url") or "").strip()
    if not stored_url:
        raise http_error(500, "lottie_asset_storage_incomplete", locale)
    return {
        "animationData": animation,
        "w": animation.get("w"),
        "h": animation.get("h"),
        "asset": asset,
        "assets": [asset],
    }


class LongMemoryIn(BaseModel):
    kind: str = Field(default="preference", max_length=32)
    text: str = Field(..., min_length=1, max_length=2000)
    pinned: bool = False


@router.post("/memory/long")
def design_long_memory(
    current_user: CurrentUser,
    body: LongMemoryIn,
) -> dict[str, Any]:
    """Persist user-confirmed long-term preference (M4 entry point)."""
    mid = insert_long_memory(
        current_user.id,
        kind=body.kind,
        text=body.text.strip(),
        pinned=body.pinned,
    )
    return {"id": mid, "ok": True}

