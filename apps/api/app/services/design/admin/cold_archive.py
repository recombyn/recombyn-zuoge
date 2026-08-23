"""Cold-archive heavy design blobs (result_svg / chat thinking) into design_cold_blob."""

from __future__ import annotations

import json
import logging
import time
from typing import Any

from sqlmodel import Session

from app import crud
from app.core.db import engine
from app.models import DesignColdBlob
from app.services.design.admin.blob_codec import pack_text_blob

logger = logging.getLogger(__name__)

KIND_TASK_SVG = "task_svg"
KIND_CHAT_THINKING = "chat_thinking"

DEFAULT_RETENTION_DAYS = 30
DEFAULT_BATCH = 80


def run_cold_archive(
    *,
    retention_days: int = DEFAULT_RETENTION_DAYS,
    batch: int = DEFAULT_BATCH,
) -> dict[str, Any]:
    """Move old result_svg / long thinking into compress archive; clear hot columns."""
    days = max(1, int(retention_days or DEFAULT_RETENTION_DAYS))
    take = max(1, min(int(batch or DEFAULT_BATCH), 500))
    cutoff = time.time() - days * 86400
    out = {
        "ok": True,
        "cutoff": cutoff,
        "taskSvgArchived": 0,
        "thinkingArchived": 0,
        "errors": [],
    }
    try:
        out["taskSvgArchived"] = _archive_task_svgs(cutoff, take)
    except Exception as exc:
        logger.exception("archive task svg failed")
        out["errors"].append(f"task_svg:{exc}")
    try:
        out["thinkingArchived"] = _archive_chat_thinking(cutoff, take)
    except Exception as exc:
        logger.exception("archive chat thinking failed")
        out["errors"].append(f"chat_thinking:{exc}")
    if out["errors"]:
        out["ok"] = False
    return out


def _archive_task_svgs(cutoff: float, take: int) -> int:
    now = time.time()
    with Session(engine) as session:
        rows = crud.list_tasks_for_svg_cold_archive(
            session=session, cutoff=cutoff, take=take
        )
        n = 0
        for r in rows:
            tid = str(r.id)
            svg = r.result_svg or ""
            if not str(svg).strip():
                continue
            blob = pack_text_blob(str(svg))
            meta = json.dumps(
                {
                    "status": r.status,
                    "chars": len(str(svg)),
                },
                ensure_ascii=False,
            )
            crud.insert_design_cold_blob(
                session=session,
                row=DesignColdBlob(
                    kind=KIND_TASK_SVG,
                    ref_id=tid,
                    compress_blob=blob,
                    meta_json=meta,
                    source_created_at=float(r.created_at or 0) or None,
                    created_at=now,
                ),
            )
            crud.clear_design_task_result_svg(
                session=session, task_id=tid, updated_at=now
            )
            n += 1
        session.commit()
    return n


def _archive_chat_thinking(cutoff: float, take: int) -> int:
    now = time.time()
    with Session(engine) as session:
        rows = crud.list_messages_for_thinking_cold_archive(
            session=session, cutoff=cutoff, take=take
        )
        n = 0
        for r in rows:
            mid = str(r.id)
            thinking = r.thinking or ""
            if not str(thinking).strip():
                continue
            blob = pack_text_blob(str(thinking))
            meta = json.dumps({"chars": len(str(thinking))}, ensure_ascii=False)
            crud.insert_design_cold_blob(
                session=session,
                row=DesignColdBlob(
                    kind=KIND_CHAT_THINKING,
                    ref_id=mid,
                    compress_blob=blob,
                    meta_json=meta,
                    source_created_at=float(r.created_at or 0) or None,
                    created_at=now,
                ),
            )
            crud.clear_chat_message_thinking(session=session, message_id=mid)
            n += 1
        session.commit()
    return n
