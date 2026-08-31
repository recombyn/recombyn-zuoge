"""Read design catalog from DB."""

from __future__ import annotations

import json
import threading
from typing import Any

from sqlmodel import Session

from app import crud
from app.core import db as core_db
from app.services.db import init_schema
from app.services.design.prompts.content_pack import resync_design_content

_ENSURE_LOCK = threading.RLock()
_CATALOG_READY = False
_BOOTSTRAPPING = False


def catalog_ready() -> bool:
    return bool(_CATALOG_READY)


def ensure_design_catalog(*, force: bool = False) -> None:
    """Process bootstrap only (startup / admin /catalog). Design-run must only SELECT."""
    global _CATALOG_READY, _BOOTSTRAPPING
    if _CATALOG_READY and not force:
        return
    with _ENSURE_LOCK:
        if _CATALOG_READY and not force:
            return
        # Re-entrant call while still bootstrapping (e.g. ensure_stage_rules → catalog):
        # skip to avoid nested seed / lock storms that hang the API worker.
        if _BOOTSTRAPPING:
            return
        _BOOTSTRAPPING = True
        try:
            init_schema()
            from app.services.design.admin.schema import ensure_design_tables_boot

            ensure_design_tables_boot()
            resync_design_content(force=False)
            from app.services.design.ops.action_registry import ensure_action_registry
            from app.services.design.prompts.prompt_pack_store import ensure_design_prompt_packs
            from app.services.design.prompts.skill_store import ensure_design_skills
            from app.services.design.prompts.system_prompt_store import ensure_system_prompts

            ensure_design_prompt_packs()
            ensure_action_registry()
            ensure_system_prompts()
            ensure_design_skills()
            _CATALOG_READY = True
        finally:
            _BOOTSTRAPPING = False


def _parse_json_list(raw: Any) -> list[Any]:
    if isinstance(raw, list):
        return raw
    if not raw:
        return []
    try:
        val = json.loads(raw)
        return val if isinstance(val, list) else []
    except Exception:
        return []


def _orm_dict(row: Any) -> dict[str, Any]:
    if hasattr(row, "model_dump"):
        return row.model_dump()
    try:
        return dict(row)
    except Exception:
        return {}


def list_skills() -> list[dict[str, Any]]:
    with Session(core_db.engine) as session:
        rows = crud.list_enabled_design_skills_catalog(session=session)
    return [_orm_dict(r) for r in rows]


def list_skill_groups(scene: str | None = None) -> list[dict[str, Any]]:
    with Session(core_db.engine) as session:
        rows = crud.list_enabled_design_skill_groups(session=session)
    out = []
    for r in rows:
        item = _orm_dict(r)
        item["skill_ids"] = _parse_json_list(item.get("skill_ids"))
        scenes = str(item.get("scenes") or "all")
        if scene and scene not in scenes.split(",") and scenes != "all":
            continue
        out.append(item)
    return out


def get_flow(scene: str) -> dict[str, Any] | None:
    with Session(core_db.engine) as session:
        row = crud.get_enabled_design_execute_flow(session=session, scene=scene)
    if not row:
        return None
    item = _orm_dict(row)
    item["skill_ids"] = _parse_json_list(item.get("skill_ids"))
    item["force_validate_flags"] = _parse_json_list(item.get("force_validate_flags"))
    item["step_token_caps"] = _parse_json_list(item.get("step_token_caps"))
    return item


def get_skill(skill_id: int) -> dict[str, Any] | None:
    with Session(core_db.engine) as session:
        row = crud.get_design_skill(session=session, item_id=int(skill_id))
    return _orm_dict(row) if row else None


def get_global_rules() -> dict[str, str]:
    """Runtime rules map — disabled rows are omitted (callers fall back to code defaults).

    System prompts live in ``design_prompt_pack`` (merged via ``get_system_prompt_bodies``)
    so existing ``_prompt_text(rules, key)`` call sites keep working. Flow-node ``promptText``
    (matched by ``promptKey``) overrides the table — node is source of truth.
    """
    with Session(core_db.engine) as session:
        rows = crud.list_enabled_design_global_rules(session=session)
    out = {k: v for k, v in rows if k}
    try:
        from app.services.design.prompts.system_prompt_store import get_system_prompt_bodies

        # ensure=False: catalog / stage bootstrap may already be mid-flight.
        for key, body in get_system_prompt_bodies(ensure=False).items():
            # Empty body → leave unset so resolve_prompt_body can fall back to pack seed.
            if str(body or "").strip():
                out[key] = str(body)
            else:
                out.pop(key, None)
    except Exception:
        pass
    return out


def get_refine_skill(
    *,
    scene: str | None = None,
    prefer_layer_partial: bool = False,
) -> dict[str, Any] | None:
    """Pick an enabled refine skill.

    Default: full-canvas refine for a scene (never layer_partial).
    prefer_layer_partial=True: target-layer skill for partial mode.
    """
    scene_l = (scene or "").strip().lower()
    with Session(core_db.engine) as session:
        rows = crud.list_enabled_refine_skills(session=session)
    if prefer_layer_partial:
        best: dict[str, Any] | None = None
        for r in rows:
            d = _orm_dict(r)
            key = str(d.get("skill_key") or "").strip()
            name = str(d.get("name") or "")
            scenes = str(d.get("scenes") or "all")
            if key == "layer_partial":
                return d
            if scenes == "all" or "图层" in name:
                if best is None:
                    best = d
        return best

    # Prefer design_execute, then scene match, then weak fallback.
    rows_sorted = sorted(
        rows,
        key=lambda r: (
            0 if str(getattr(r, "skill_key", "") or "").strip() == "design_execute" else 1,
            -(int(getattr(r, "sort_weight", 0) or 0)),
            -(int(getattr(r, "id", 0) or 0)),
        ),
    )
    best = None
    for r in rows_sorted:
        d = _orm_dict(r)
        key = str(d.get("skill_key") or "").strip()
        if key == "layer_partial":
            continue
        scenes = str(d.get("scenes") or "").lower()
        if scene_l and scene_l not in scenes.replace(" ", "").split(",") and scenes != "all":
            if best is None:
                best = d  # weak fallback if no scene match later
            continue
        return d
    return best


def list_scene_codes() -> list[str]:
    try:
        from app.services.design.admin.dict_store import list_dicts

        items = list_dicts(dict_type="scene", enabled=True)
        codes = [i["code"] for i in items if i.get("code") and i["code"] != "all"]
        if codes:
            return codes
    except Exception:
        pass
    return ["website", "mobile", "image", "poster", "drawing"]


def get_catalog_payload() -> dict[str, Any]:
    from app.services.design.ops.tool_ops_contract import list_canvas_tools

    # Bootstrap belongs at process startup / admin — not on every skill SELECT.
    ensure_design_catalog()

    skills = list_skills()
    groups = list_skill_groups()
    scene_codes = list_scene_codes()
    flows = {}
    for scene in scene_codes:
        f = get_flow(scene)
        if f:
            flows[scene] = f

    return {
        "scenes": scene_codes,
        "sceneLabels": {
            i["code"]: i["label"]
            for i in __import__(
                "app.services.design.admin.dict_store", fromlist=["list_dicts"]
            ).list_dicts(dict_type="scene", enabled=True)
        },
        "categoryLabels": {
            i["code"]: i["label"]
            for i in __import__(
                "app.services.design.admin.dict_store", fromlist=["list_dicts"]
            ).list_dicts(dict_type="skill_category", enabled=True)
        },
        "models": [
            {"id": "auto", "label": "Auto"},
            {"id": "doubao", "label": "Doubao"},
            {"id": "deepseek", "label": "DeepSeek"},
        ],
        "skills": [
            {
                "id": s["id"],
                "name": s["name"],
                "category": s["category"],
                "scenes": s["scenes"],
                "default_model": s["default_model"],
                "allow_user_model_override": bool(s.get("allow_user_model_override")),
            }
            for s in skills
        ],
        "style_groups": [
            {
                "id": g["id"],
                "name": g["name"],
                "scenes": g["scenes"],
                "skill_ids": g["skill_ids"],
                "priority": g["priority"],
            }
            for g in groups
        ],
        "flows": {
            k: {
                "id": v["id"],
                "scene": v["scene"],
                "skill_ids": v["skill_ids"],
                "fail_strategy": v["fail_strategy"],
            }
            for k, v in flows.items()
        },
        "global_rules": get_global_rules(),
        "canvas_tools": list_canvas_tools(enabled_only=True),
        "prompt_stack": [
            "global_rules",
            "scene_rules",
            "design_system",
            "template",
            "skill",
        ],
    }
