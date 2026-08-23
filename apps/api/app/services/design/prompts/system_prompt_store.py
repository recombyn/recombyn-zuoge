"""System prompts (agent / persona) — dedicated table, not dict+KV split."""
from __future__ import annotations

import threading
import time
from typing import Any

from sqlmodel import Session

from app import crud
from app.core.db import engine

_READY = False
_LOCK = threading.RLock()

GROUP_LABELS: dict[str, str] = {
    "agent_prompt": "Agent 提示词",
    "agent_persona": "Agent 人设",
    "precheck": "预检 / 路由",
}


def is_system_prompt_key(key: str) -> bool:
    k = (key or "").strip()
    if not k:
        return False
    return (
        k.startswith("agent.prompt.")
        or k.startswith("agent.persona.")
        or k == "precheck.router_system"
    )


def _load_seed_items() -> list[dict[str, Any]]:
    """Metadata + bodies from ``seeds/design_prompt_packs/`` (system-key kinds only)."""
    from app.services.design.prompts.prompt_pack_store import _load_prompt_packs_seed

    _labels, raw = _load_prompt_packs_seed()
    out: list[dict[str, Any]] = []
    for x in raw:
        if not isinstance(x, dict):
            continue
        key = str(x.get("kind") or "").strip()
        if not key or not is_system_prompt_key(key):
            continue
        out.append(
            {
                "key": key,
                "label": str(x.get("title") or key).strip() or key,
                "group": str(x.get("group") or "").strip() or _infer_group(key),
                "selectable": bool(x.get("selectable")),
                "sortOrder": int(x.get("sort_order") or 0),
                "description": str(x.get("when_to_use") or "").strip(),
                "body": str(x.get("body") or ""),
            }
        )
    return out


def _infer_group(key: str) -> str:
    if key.startswith("agent.persona."):
        return "agent_persona"
    if key.startswith("precheck."):
        return "precheck"
    return "agent_prompt"


def _row_to_item(row: Any) -> dict[str, Any]:
    if hasattr(row, "prompt_key"):
        key = str(row.prompt_key or "")
        group = str(row.group_key or "") or "agent_prompt"
        body = str(row.body or "")
        return {
            "key": key,
            "label": str(row.label or "") or key,
            "description": str(row.description or ""),
            "body": body,
            "group": group,
            "groupLabel": GROUP_LABELS.get(group, group),
            "selectable": bool(int(row.selectable or 0)),
            "sortOrder": int(row.sort_order or 0),
            "enabled": bool(int(row.enabled or 0)),
            "usingDefault": not bool(body.strip()),
            "updatedAt": float(row.updated_at or 0),
        }
    key = str(row["prompt_key"] or "")
    group = str(row["group_key"] or "") or "agent_prompt"
    return {
        "key": key,
        "label": str(row["label"] or "") or key,
        "description": str(row["description"] or ""),
        "body": str(row["body"] or ""),
        "group": group,
        "groupLabel": GROUP_LABELS.get(group, group),
        "selectable": bool(int(row["selectable"] or 0)),
        "sortOrder": int(row["sort_order"] or 0),
        "enabled": bool(int(row["enabled"] or 0)),
        "usingDefault": not bool(str(row["body"] or "").strip()),
        "updatedAt": float(row["updated_at"] or 0),
    }


def ensure_system_prompts() -> None:
    """Insert missing rows from prompt-pack seed. Never overwrite Admin body.

    Do not call ``ensure_design_catalog`` here — catalog invokes this while bootstrapping.
    """
    global _READY
    if _READY:
        return
    with _LOCK:
        if _READY:
            return
        seed_items = _load_seed_items()
        now = time.time()
        with Session(engine) as session:
            existing = crud.list_design_system_prompt_keys(session=session)
            for it in seed_items:
                key = str(it.get("key") or "").strip()
                if not key or key in existing:
                    continue
                label = str(it.get("label") or "").strip() or key
                group = str(it.get("group") or "").strip() or _infer_group(key)
                selectable = 1 if bool(it.get("selectable")) else 0
                sort_order = int(it.get("sortOrder") or 0)
                desc = str(it.get("description") or "").strip()
                body = str(it.get("body") or "")
                crud.insert_design_system_prompt_seed(
                    session=session,
                    prompt_key=key,
                    label=label,
                    description=desc,
                    body=body,
                    group_key=group,
                    selectable=selectable,
                    sort_order=sort_order,
                    created_at=now,
                )
                existing.add(key)

            for it in seed_items:
                key = str(it.get("key") or "").strip()
                if not key:
                    continue
                label = str(it.get("label") or "").strip()
                desc = str(it.get("description") or "").strip()
                group = str(it.get("group") or "").strip() or _infer_group(key)
                selectable = 1 if bool(it.get("selectable")) else 0
                sort_order = int(it.get("sortOrder") or 0)
                crud.patch_design_system_prompt_seed_meta(
                    session=session,
                    prompt_key=key,
                    label=label,
                    description=desc,
                    group_key=group,
                    selectable=selectable,
                    sort_order=sort_order,
                )
            session.commit()
        _READY = True


def list_system_prompts(
    *,
    group: str | None = None,
    selectable: bool | None = None,
    enabled: bool | None = True,
    ensure: bool = True,
) -> list[dict[str, Any]]:
    if ensure:
        from app.services.design.readpath.catalog import catalog_ready, ensure_design_catalog

        if not catalog_ready():
            ensure_design_catalog()
        ensure_system_prompts()
    with Session(engine) as session:
        rows = crud.list_design_system_prompts(
            session=session,
            group=group,
            selectable=selectable,
            enabled=enabled,
        )
    return [_row_to_item(r) for r in rows]


def get_system_prompt_bodies(*, ensure: bool = True) -> dict[str, str]:
    """Enabled prompt_key → body.

    Prefer ``design_prompt_pack`` (kind = prompt_key). Fall back to
    ``design_system_prompt`` for keys not yet migrated.
    """
    if ensure:
        from app.services.design.readpath.catalog import catalog_ready, ensure_design_catalog

        if not catalog_ready():
            ensure_design_catalog()
        ensure_system_prompts()
        try:
            from app.services.design.prompts.prompt_pack_store import ensure_design_prompt_packs

            ensure_design_prompt_packs()
        except Exception:
            pass

    out: dict[str, str] = {}
    try:
        from app.services.design.prompts.prompt_pack_store import list_prompt_pack_bodies_for_system

        out.update(list_prompt_pack_bodies_for_system(ensure=False))
    except Exception:
        pass

    with Session(engine) as session:
        rows = crud.list_enabled_design_system_prompt_bodies(session=session)
    for key, body in rows:
        if not key:
            continue
        if key not in out or not str(out.get(key) or "").strip():
            out[key] = body
    return out


def upsert_system_prompt(
    *,
    key: str,
    body: str | None = None,
    label: str | None = None,
    description: str | None = None,
    group: str | None = None,
    selectable: bool | None = None,
    sort_order: int | None = None,
    enabled: bool | None = None,
) -> dict[str, Any]:
    from app.services.design.readpath.catalog import catalog_ready, ensure_design_catalog

    if not catalog_ready():
        ensure_design_catalog()
    ensure_system_prompts()
    prompt_key = (key or "").strip()
    if not prompt_key:
        raise ValueError("key required")
    if not is_system_prompt_key(prompt_key):
        raise ValueError(f"unsupported system prompt key: {prompt_key}")
    with Session(engine) as session:
        row = crud.get_design_system_prompt(session=session, prompt_key=prompt_key)
        if row:
            next_body = str(row.body or "") if body is None else str(body)
            next_label = (
                str(row.label or "") if label is None else str(label).strip() or prompt_key
            )
            next_desc = (
                str(row.description or "")
                if description is None
                else str(description)
            )
            next_group = (
                str(row.group_key or "") if group is None else str(group).strip()
            ) or _infer_group(prompt_key)
            next_sel = (
                int(row.selectable or 0)
                if selectable is None
                else (1 if selectable else 0)
            )
            next_sort = (
                int(row.sort_order or 0) if sort_order is None else int(sort_order)
            )
            next_en = (
                int(row.enabled or 0) if enabled is None else (1 if enabled else 0)
            )
        else:
            from app.services.design.prompts.prompt_pack_store import seed_prompt_body

            next_body = "" if body is None else str(body)
            if not next_body:
                next_body = seed_prompt_body(prompt_key)
            seed_meta = next(
                (x for x in _load_seed_items() if x.get("key") == prompt_key),
                {},
            )
            next_label = (label or "").strip() or str(
                seed_meta.get("label") or prompt_key
            )
            next_desc = (
                description
                if description is not None
                else str(seed_meta.get("description") or "")
            )
            next_group = (group or "").strip() or _infer_group(prompt_key)
            next_sel = 1 if (True if selectable is None else selectable) else 0
            next_sort = int(sort_order or 0)
            next_en = 1 if (True if enabled is None else enabled) else 0
        out = crud.upsert_design_system_prompt(
            session=session,
            prompt_key=prompt_key,
            body=next_body,
            label=next_label,
            description=str(next_desc or ""),
            group_key=next_group,
            selectable=next_sel,
            sort_order=next_sort,
            enabled=next_en,
        )
        # Runtime prefers design_prompt_pack — keep pack body in sync when Admin edits here.
        for pack in crud.list_design_prompt_packs_by_kind(session=session, kind=prompt_key):
            pack.body = next_body
            if (next_label or "").strip():
                pack.title = next_label
            pack.when_to_use = str(next_desc or "")
            pack.enabled = next_en
            pack.updated_at = time.time()
            session.add(pack)
        session.commit()
    return _row_to_item(out)
