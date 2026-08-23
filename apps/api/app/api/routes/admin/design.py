"""Admin routes — design."""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, File, Form, HTTPException, Query, UploadFile

from app.api.deps import AdminUser
from app.api.routes.admin.common import *  # noqa: F403
from app.api.routes.admin.common import _RUNTIME_SETTING_KEYS
from app.core.config import settings

router = APIRouter()

@router.get("/design/runtime-settings")
def admin_design_runtime_settings(
    _admin: AdminUser,
) -> dict[str, Any]:
    from app.services.design.admin.admin_store import (
        STAGE_RULE_DESCRIPTIONS,
        ensure_stage_rules,
    )
    from app.services.design.prompts.system_prompt_store import ensure_system_prompts

    ensure_stage_rules()
    ensure_system_prompts()
    rules = get_global_rules()
    keys = sorted(_RUNTIME_SETTING_KEYS)
    items: list[dict[str, Any]] = []
    for k in keys:
        db_val = str(rules.get(k) or "")
        label = str(STAGE_RULE_DESCRIPTIONS.get(k) or "")
        items.append(
            {
                "key": k,
                "value": db_val,
                "label": label,
                "description": label,
                "using_default": not bool(db_val.strip()),
            }
        )
    return {"items": items}

@router.put("/design/runtime-settings")
def admin_upsert_design_runtime_setting(
    _admin: AdminUser,
    body: RuntimeSettingIn,
) -> dict[str, Any]:
    from app.services.design.prompts.system_prompt_store import is_system_prompt_key

    key = (body.key or "").strip()
    if is_system_prompt_key(key):
        raise HTTPException(
            status_code=400,
            detail="prompt keys moved to /admin/design/system-prompts",
        )
    if key not in _RUNTIME_SETTING_KEYS:
        raise HTTPException(status_code=400, detail=f"unsupported setting: {key}")
    try:
        item = upsert_global_rule(rule_key=key, rule_value=body.value or "")
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e
    return {"item": {"key": item.get("ruleKey") or key, "value": item.get("ruleValue") or ""}}

@router.get("/design/system-prompts")
def admin_design_system_prompts(
    _admin: AdminUser,
    group: str | None = None,
    selectable: bool | None = Query(default=None),
    enabled: bool | None = Query(default=True),
) -> dict[str, Any]:
    from app.services.design.prompts.system_prompt_store import list_system_prompts

    return {
        "items": list_system_prompts(
            group=group, selectable=selectable, enabled=enabled
        )
    }

@router.put("/design/system-prompts")
def admin_upsert_design_system_prompt(
    _admin: AdminUser,
    body: SystemPromptIn,
) -> dict[str, Any]:
    from app.services.design.prompts.system_prompt_store import upsert_system_prompt

    try:
        item = upsert_system_prompt(
            key=body.key,
            body=body.body,
            label=body.label,
            description=body.description,
            group=body.group,
            selectable=body.selectable,
            sort_order=body.sortOrder,
            enabled=body.enabled,
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e
    return {"item": item}

@router.post("/design/content/resync")
def admin_design_content_resync(
    _admin: AdminUser,
    force: bool = True,
) -> dict[str, Any]:
    """Cleanup obsolete keys. Does not restore Skill/Flow/Rules UI."""
    return resync_design_content(force=force)

@router.get("/design/canvas-tools")
def admin_design_canvas_tools(_admin: AdminUser) -> dict[str, Any]:
    items = list_canvas_tools_admin()
    return {
        "items": [
            {
                "opKey": t["op_key"],
                "kind": t.get("kind") or "node",
                "label": t.get("label") or "",
                "modelHint": t.get("model_hint") or "",
                "argsSchema": t.get("args_schema") or "",
                "enabled": bool(t.get("enabled")),
                "sortOrder": int(t.get("sort_order") or 0),
            }
            for t in items
        ]
    }

@router.put("/design/canvas-tools")
def admin_upsert_design_canvas_tool(
    _admin: AdminUser,
    body: CanvasToolIn,
) -> dict[str, Any]:
    try:
        item = upsert_canvas_tool(
            op_key=body.opKey,
            kind=body.kind,
            label=body.label,
            model_hint=body.modelHint,
            args_schema=body.argsSchema,
            enabled=body.enabled,
            sort_order=body.sortOrder,
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e
    return {"item": item}

@router.get("/design/metrics")
def admin_design_metrics(_admin: AdminUser) -> dict[str, Any]:
    return skill_metrics_summary()

@router.get("/design/observability")
def admin_design_observability(
    _admin: AdminUser,
) -> dict[str, Any]:
    """Langfuse status for Admin 运行复盘."""
    from app.services.llm.agent import configure_langfuse

    return configure_langfuse()

@router.get("/design/decision-logs")
def admin_design_decision_logs(
    _admin: AdminUser,
    page: int = Query(default=1, ge=1),
    pageSize: int = Query(default=50, ge=1, le=100),
    route: str | None = Query(default=None),
    intent: str | None = Query(default=None),
    status: str | None = Query(default=None),
    q: str | None = Query(default=None),
) -> dict[str, Any]:
    return list_decision_logs(
        page=page,
        page_size=pageSize,
        route=route,
        intent=intent,
        status=status,
        q=q,
    )

@router.get("/design/decision-logs/{task_id}")
def admin_design_decision_log_detail(
    _admin: AdminUser,
    task_id: str,
) -> dict[str, Any]:
    row = get_decision_log(task_id)
    if row is None:
        raise HTTPException(status_code=404, detail="decision log not found")
    return {"item": row}

@router.post("/design/decision-logs/clear")
def admin_design_decision_logs_clear(
    _admin: AdminUser,
) -> dict[str, Any]:
    """Wipe persisted decision_log / execution_log (fresh LangGraph 运行复盘)."""
    return clear_decision_logs()

@router.get("/design/stage-reviews")
def admin_design_stage_reviews(
    _admin: AdminUser,
    page: int = Query(default=1, ge=1),
    pageSize: int = Query(default=50, ge=1, le=100),
    skillId: int | None = Query(default=None),
    minRating: int | None = Query(default=None, ge=1, le=5),
    maxRating: int | None = Query(default=None, ge=1, le=5),
) -> dict[str, Any]:
    """Historical stage ratings."""
    return list_stage_reviews(
        page=page,
        page_size=pageSize,
        skill_id=skillId,
        min_rating=minRating,
        max_rating=maxRating,
    )

@router.get("/design/optimize/patches")
def admin_list_optimize_patches(
    _admin: AdminUser,
    status: str | None = Query(default="pending"),
) -> dict[str, Any]:
    return {"items": list_optimize_patches(status=status)}

@router.post("/design/optimize/generate")
def admin_generate_optimize_patches(
    _admin: AdminUser,
) -> dict[str, Any]:
    """Mine usage metrics into pending patches (no auto-apply)."""
    return generate_usage_optimize_patches()

@router.post("/design/optimize/patches/{patch_id}/apply")
def admin_apply_optimize_patch(
    _admin: AdminUser,
    patch_id: int,
) -> dict[str, Any]:
    try:
        return apply_optimize_patch(int(patch_id))
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e

@router.post("/design/optimize/patches/{patch_id}/dismiss")
def admin_dismiss_optimize_patch(
    _admin: AdminUser,
    patch_id: int,
) -> dict[str, Any]:
    try:
        return dismiss_optimize_patch(int(patch_id))
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e

@router.get("/design/dict-types")
def admin_design_dict_types(
    _admin: AdminUser,
    enabled: bool | None = Query(default=None),
) -> dict[str, Any]:
    return {"items": list_dict_types(enabled=enabled)}

@router.put("/design/dict-types")
def admin_upsert_design_dict_type(
    _admin: AdminUser,
    body: DesignDictTypeIn,
) -> dict[str, Any]:
    try:
        item = upsert_dict_type(body.model_dump())
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e
    return {"item": item}

@router.delete("/design/dict-types/{type_id}")
def admin_delete_design_dict_type(
    _admin: AdminUser,
    type_id: int,
) -> dict[str, Any]:
    ok = delete_dict_type(type_id)
    if not ok:
        raise HTTPException(status_code=404, detail="Not found")
    return {"ok": True}

@router.get("/design/dicts")
def admin_design_dicts(
    _admin: AdminUser,
    dictType: str | None = None,
    enabled: bool | None = Query(default=None),
) -> dict[str, Any]:
    return {"items": list_dicts(dict_type=dictType, enabled=enabled)}

@router.put("/design/dicts")
def admin_upsert_design_dict(
    _admin: AdminUser,
    body: DesignDictIn,
) -> dict[str, Any]:
    try:
        item = upsert_dict(body.model_dump())
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e
    return {"item": item}

@router.delete("/design/dicts/{item_id}")
def admin_delete_design_dict(
    _admin: AdminUser,
    item_id: int,
    hard: bool = Query(default=False),
) -> dict[str, Any]:
    ok = hard_delete_dict(item_id) if hard else soft_delete_dict(item_id)
    if not ok:
        raise HTTPException(status_code=404, detail="Not found")
    return {"ok": True}

@router.get("/design/skills")
def admin_design_skills(
    _admin: AdminUser,
    q: str | None = Query(default=None),
    enabled: bool | None = Query(default=None),
    source: str | None = Query(
        default=None,
        description="Optional source filter: seed | file | admin. Default: all.",
    ),
) -> dict[str, Any]:
    from app.services.design.admin.admin_store import list_admin_skills
    from app.services.design.prompts.skill_store import ensure_design_skills

    ensure_design_skills()
    src = str(source).strip().lower() if source and str(source).strip() else None
    return {"items": list_admin_skills(q=q, enabled=enabled, source=src)}

@router.put("/design/skills")
def admin_upsert_design_skill(
    _admin: AdminUser,
    body: DesignSkillIn,
) -> dict[str, Any]:
    from app.services.design.admin.admin_store import upsert_skill

    try:
        item = upsert_skill(body.model_dump())
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e
    return {"item": item}

@router.delete("/design/skills/{skill_id}")
def admin_delete_design_skill(
    _admin: AdminUser,
    skill_id: int,
) -> dict[str, Any]:
    from app.services.design.admin.admin_store import soft_delete_skill
    from app.services.design.prompts.skill_store import invalidate_skill_key_cache

    try:
        ok = soft_delete_skill(skill_id)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e
    if not ok:
        raise HTTPException(status_code=404, detail="Not found")
    invalidate_skill_key_cache()
    return {"ok": True}

@router.post("/design/skills/resync")
def admin_resync_design_skills(
    _admin: AdminUser,
) -> dict[str, Any]:
    """Re-run seed (insert-only) + file skill sync; never overwrites source=admin."""
    from app.services.design.prompts.skill_store import ensure_design_skills, list_runtime_skills

    ensure_design_skills(force=True)
    return {"ok": True, "runtimeCount": len(list_runtime_skills())}

@router.get("/design/kg-triples")
def admin_list_kg_triples(
    _admin: AdminUser,
    userId: str | None = None,
    limit: int = Query(default=100, ge=1, le=500),
    offset: int = Query(default=0, ge=0),
) -> dict[str, Any]:
    """Inspect agent_kg_triple SPO rows (P3 knowledge graph)."""
    from app.services.agent_memory.kg import list_triples_admin

    return list_triples_admin(user_id=userId, limit=limit, offset=offset)

@router.delete("/design/kg-triples/{triple_id}")
def admin_delete_kg_triple(
    _admin: AdminUser,
    triple_id: str,
) -> dict[str, Any]:
    from app.services.agent_memory.kg import soft_delete_triple

    ok = soft_delete_triple(triple_id)
    if not ok:
        raise HTTPException(status_code=404, detail="Not found")
    return {"ok": True}



@router.post("/design/cold-archive/run")
def admin_run_cold_archive(
    _admin: AdminUser,
    retentionDays: int = Query(default=30, ge=1, le=3650),
    batch: int = Query(default=80, ge=1, le=500),
) -> dict[str, Any]:
    """Archive old design_task.result_svg + chat_messages.thinking into design_cold_blob."""
    from app.services.design.admin.cold_archive import run_cold_archive

    return run_cold_archive(retention_days=retentionDays, batch=batch)

