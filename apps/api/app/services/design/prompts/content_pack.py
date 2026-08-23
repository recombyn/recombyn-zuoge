"""Design content pack — version stamp only (no skill / flow / prompt copy in repo).

Runtime skills, flows, and global rules live in the DB (Admin).
This module must never upsert skill prompts or overwrite Admin flow skill_ids.
"""
from __future__ import annotations

import time
from typing import Any

from sqlmodel import Session

from app import crud
from app.core.db import engine

CONTENT_VERSION = "2026-07-23-v103"
CONTENT_VERSION_KEY = "content_pack_version"


def _now() -> float:
    return time.time()


def resync_design_content(*, force: bool = True) -> dict[str, Any]:
    """Stamp content_pack_version only. Never rewrites skills, flows, or groups."""
    from app.services.design.admin.schema import ensure_design_tables_boot

    ensure_design_tables_boot()

    with Session(engine) as session:
        current = crud.get_design_global_rule_value(
            session=session, rule_key=CONTENT_VERSION_KEY
        ) or ""
        if not force and current == CONTENT_VERSION:
            return {"ok": True, "skipped": True, "version": CONTENT_VERSION}

        now = _now()
        crud.upsert_design_global_rule_value(
            session=session,
            rule_key=CONTENT_VERSION_KEY,
            rule_value=CONTENT_VERSION,
            updated_at=now,
        )
        n_skills = crud.count_design_skills(session=session)
        n_flows = crud.count_design_execute_flows(session=session)
        session.commit()

    return {
        "ok": True,
        "skipped": False,
        "version": CONTENT_VERSION,
        "skills": n_skills,
        "flows": n_flows,
        "note": "DB-owned skills/flows/rules; pack does not seed or overwrite them",
    }
