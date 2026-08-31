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

CONTENT_VERSION = "2026-08-31-v104"
CONTENT_VERSION_KEY = "content_pack_version"

# Flow designer removed — delete leftover KV rows on resync.
_OBSOLETE_GLOBAL_RULE_KEYS: tuple[str, ...] = (
    "agent.flow.default_graph_json",
    "agent.flow.phase_map_json",
    "agent.flow.node_templates_json",
    "agent.flow.action_contracts_json",
    "agent.flows.catalog_json",
)


def _now() -> float:
    return time.time()


def resync_design_content(*, force: bool = True) -> dict[str, Any]:
    """Stamp content_pack_version; purge obsolete flow-designer KV keys."""
    from app.services.design.admin.schema import ensure_design_tables_boot
    from sqlmodel import select

    from app.models import DesignGlobalRule

    ensure_design_tables_boot()

    with Session(engine) as session:
        current = crud.get_design_global_rule_value(
            session=session, rule_key=CONTENT_VERSION_KEY
        ) or ""
        purged = 0
        for key in _OBSOLETE_GLOBAL_RULE_KEYS:
            row = session.exec(
                select(DesignGlobalRule).where(DesignGlobalRule.rule_key == key)
            ).first()
            if row is None:
                continue
            session.delete(row)
            purged += 1
        if not force and current == CONTENT_VERSION and purged == 0:
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
        "purgedRules": purged,
        "note": "DB-owned skills/flows/rules; pack does not seed or overwrite them",
    }
