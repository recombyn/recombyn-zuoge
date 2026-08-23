"""Seed fonts from apps/api/seeds; heal existing plaza rows; agent-made plaza showcases."""

from __future__ import annotations

import json
import logging
import time
import uuid
from pathlib import Path
from typing import Any

from sqlmodel import Session

from app import crud
from app.core.db import engine
from app.services.db import init_schema
from app.services.plaza.cover import cover_json_dumps
from app.services.plaza.ensure_cover import ensure_cover_artboard

logger = logging.getLogger(__name__)

_OFFICIAL_USER_ID = "user_official"
_OFFICIAL_AVATAR = "/logo192.png"


def _resolve_seed_file(*parts: str) -> Path:
    from app.core.config import resolve_seed_file

    return resolve_seed_file(*parts)


def _resolve_seed_dir(*parts: str) -> Path:
    from app.core.config import resolve_seed_dir

    return resolve_seed_dir(*parts)


def seed_plaza_showcases() -> int:
    """
    Insert official plaza boards from real agent dumps
    (apps/api/seeds/plaza_agent_docs/*.json).

    Each file: { projectId, title, category, authorName?, document }.
    Idempotent by projectId. No rectangle mock boards.
    """
    init_schema()
    docs_dir = _resolve_seed_dir("plaza_agent_docs")
    if not docs_dir.is_dir():
        logger.info("plaza agent docs skipped: missing %s", docs_dir)
        return 0

    files = sorted(docs_dir.glob("*.json"))
    if not files:
        logger.info("plaza agent docs skipped: empty %s", docs_dir)
        return 0

    inserted = 0
    now = time.time()
    with Session(engine) as session:
        existing = {
            str(r.project_id or "")
            for r in crud.list_plaza_mine(session=session, user_id=_OFFICIAL_USER_ID)
        }
        # Also skip if any user already published that projectId
        for path in files:
            try:
                item = json.loads(path.read_text(encoding="utf-8"))
            except (OSError, json.JSONDecodeError) as err:
                logger.warning("plaza agent doc skip %s: %s", path.name, err)
                continue
            if not isinstance(item, dict):
                continue
            pid = str(item.get("projectId") or "").strip()
            document = item.get("document")
            if not pid or not isinstance(document, dict):
                continue
            if pid in existing:
                continue
            # Skip empty / rect-only dumps without media when marked
            raw_nodes = (document.get("deltaSetLike") or {}) if isinstance(document, dict) else {}
            has_media = any(
                isinstance(n, dict)
                and str(n.get("key") or "") in ("image", "video", "lottie")
                and (
                    str((n.get("attrs") or {}).get("src") or "").startswith("http")
                    or (n.get("attrs") or {}).get("animationData")
                )
                for k, n in raw_nodes.items()
                if k != "ROOT"
            )
            if not has_media:
                logger.warning(
                    "plaza agent doc skip %s: no hydrated image/video/lottie", path.name
                )
                continue

            document = ensure_cover_artboard(
                document, title=str(item.get("title") or path.stem)
            )
            doc_raw = json.dumps(document, ensure_ascii=False, separators=(",", ":"))
            cover_raw = cover_json_dumps(document)
            sid = f"plaza_{uuid.uuid4().hex[:16]}"
            crud.create_plaza_submission(
                session=session,
                submission_id=sid,
                project_id=pid,
                user_id=_OFFICIAL_USER_ID,
                author_name=str(item.get("authorName") or "Recombyn Official").strip()
                or "Recombyn Official",
                author_avatar=_OFFICIAL_AVATAR,
                title=str(item.get("title") or "Showcase").strip()[:120] or "Showcase",
                category=str(item.get("category") or "website").strip() or "website",
                document_json=doc_raw,
                cover_json=cover_raw,
                cover_image_url=None,
                created_at=now,
            )
            inserted += 1
            existing.add(pid)
            try:
                from app.services.plaza.store import approve_submission

                approve_submission(sid, "seed")
            except Exception:
                logger.exception("plaza showcase panel refresh failed id=%s", sid)
    return inserted


def seed_fonts() -> int:
    """Insert fonts from fonts_seed.json. Skip families that already exist in DB."""
    init_schema()
    path = _resolve_seed_file("fonts_seed.json")
    if not path.is_file():
        logger.warning("fonts seed skipped: missing %s", path)
        return 0

    try:
        raw = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as err:
        logger.warning("fonts seed failed to read %s: %s", path, err)
        return 0

    if not isinstance(raw, list):
        return 0

    from app.services import fonts_store

    inserted = 0
    for i, item in enumerate(raw):
        if not isinstance(item, dict):
            continue
        family = str(item.get("family") or "").strip()
        if not family:
            continue
        if fonts_store.get_font_by_family(family):
            continue
        display = str(item.get("displayName") or family).strip() or family
        children = item.get("children")
        if not isinstance(children, list):
            children = []
        fonts_store.upsert_font(
            family=family,
            display_name=display,
            children=children,
            sort_order=i,
        )
        inserted += 1
    return inserted


def heal_official_avatars() -> int:
    """Backfill avatar URL on official plaza rows that were seeded without one."""
    init_schema()
    with Session(engine) as session:
        return crud.heal_official_plaza_avatars(
            session=session,
            user_id=_OFFICIAL_USER_ID,
            avatar=_OFFICIAL_AVATAR,
        )


def heal_plaza_covers() -> int:
    """Backfill cover_json from artboards."""
    init_schema()
    updated = 0
    with Session(engine) as session:
        rows = crud.list_all_plaza_submissions_for_cover_heal(session=session)
        for row in rows:
            try:
                document = json.loads(row.document_json or "")
            except (TypeError, json.JSONDecodeError):
                continue
            if not isinstance(document, dict):
                continue
            title = str(row.title or "")
            is_official = str(row.user_id or "") == _OFFICIAL_USER_ID
            next_doc = (
                ensure_cover_artboard(document, title=title) if is_official else document
            )
            cover_raw = cover_json_dumps(next_doc)
            next_doc_raw = json.dumps(next_doc, ensure_ascii=False, separators=(",", ":"))
            if row.cover_json == cover_raw and row.document_json == next_doc_raw:
                continue
            crud.update_plaza_submission_document_cover(
                session=session,
                submission_id=row.id,
                document_json=next_doc_raw,
                cover_json=cover_raw,
            )
            updated += 1
        session.commit()
    return updated


def run_seeds() -> dict[str, Any]:
    fonts = seed_fonts()
    showcases = seed_plaza_showcases()
    avatars = heal_official_avatars()
    covers = heal_plaza_covers()
    from app.services.llm.catalog_store import ensure_llm_catalog_seed

    ensure_llm_catalog_seed()
    return {
        "fonts": fonts,
        "plazaShowcases": showcases,
        "avatarsHealed": avatars,
        "coversHealed": covers,
        "llmCatalog": True,
    }
