"""Admin stage-review persistence (historical training ratings)."""

from __future__ import annotations

import time
from typing import Any

from sqlmodel import Session

from app import crud
from app.core.db import engine
from app.services.design.readpath.catalog import ensure_design_catalog


def insert_stage_review(row: dict[str, Any]) -> None:
    with Session(engine) as session:
        crud.create_stage_review(
            session=session,
            task_id=str(row["task_id"]),
            user_id=str(row["user_id"]),
            scene=row.get("scene"),
            skill_index=int(row.get("skill_index") or 0),
            skill_id=(
                int(row["skill_id"]) if row.get("skill_id") is not None else None
            ),
            skill_name=row.get("skill_name"),
            skill_category=row.get("skill_category"),
            rating=int(row.get("rating") or 0),
            verdict=str(row.get("verdict") or "pass"),
            comment=row.get("comment"),
            preview_svg=row.get("preview_svg"),
            tokens=int(row.get("tokens") or 0),
            model_actual=row.get("model_actual"),
            created_at=float(row.get("created_at") or time.time()),
        )


def list_stage_reviews(
    *,
    page: int = 1,
    page_size: int = 50,
    skill_id: int | None = None,
    min_rating: int | None = None,
    max_rating: int | None = None,
) -> dict[str, Any]:
    ensure_design_catalog()
    page_n = max(1, int(page or 1))
    size = max(1, min(100, int(page_size or 50)))
    offset = (page_n - 1) * size
    with Session(engine) as session:
        rows, total = crud.list_stage_reviews(
            session=session,
            skill_id=skill_id,
            min_rating=min_rating,
            max_rating=max_rating,
            offset=offset,
            limit=size,
        )
    items = [
        {
            "id": int(r.id or 0),
            "taskId": r.task_id,
            "userId": r.user_id,
            "scene": r.scene,
            "skillIndex": int(r.skill_index or 0),
            "skillId": int(r.skill_id) if r.skill_id is not None else None,
            "skillName": r.skill_name,
            "skillCategory": r.skill_category,
            "rating": int(r.rating or 0),
            "verdict": r.verdict or "pass",
            "comment": r.comment or "",
            "tokens": int(r.tokens or 0),
            "modelActual": r.model_actual,
            "createdAt": int(float(r.created_at) * 1000) if r.created_at else None,
        }
        for r in rows
    ]
    return {"items": items, "total": int(total), "page": page_n, "pageSize": size}
