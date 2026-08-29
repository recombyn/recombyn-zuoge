"""Periodic database backups — dump hints for MySQL/Postgres."""

from __future__ import annotations

import logging
import threading
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from app.core.config import _API_ROOT, settings

_log = logging.getLogger(__name__)
_BACKUP_LOCK = threading.Lock()
_SCHEDULER_STARTED = False


def _backup_dir() -> Path:
    raw = (settings.db_backup_dir or "storage/backups").strip() or "storage/backups"
    path = Path(raw)
    if not path.is_absolute():
        path = _API_ROOT / path
    path.mkdir(parents=True, exist_ok=True)
    return path


def _stamp() -> str:
    return datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")


def _prune_backups(directory: Path, *, keep: int, prefix: str) -> None:
    keep_n = max(1, int(keep or 1))
    files = sorted(
        [p for p in directory.glob(f"{prefix}*") if p.is_file()],
        key=lambda p: p.stat().st_mtime,
        reverse=True,
    )
    for old in files[keep_n:]:
        try:
            old.unlink()
        except Exception:
            _log.debug("prune backup failed path=%s", old, exc_info=True)


def run_db_backup(*, reason: str = "scheduled") -> dict[str, Any]:
    """
    Backup primary app DB.

    MySQL/Postgres: writes a sidecar ``.hint`` with dump command (operator runs
    mysqldump / pg_dump or uses cloud automated backups).
    """
    from app.services.db import dialect

    if not bool(getattr(settings, "db_backup_enabled", True)):
        return {"ok": False, "skipped": True, "reason": "disabled"}

    with _BACKUP_LOCK:
        out_dir = _backup_dir()
        keep = int(getattr(settings, "db_backup_keep", 14) or 14)
        stamp = _stamp()
        d = dialect()
        created: list[str] = []

        hint = out_dir / f"{d}-dump-{stamp}.hint.txt"
        url = (settings.database_url or "").strip()
        if d == "mysql":
            body = (
                f"# Generated {stamp} reason={reason}\n"
                f"# Run on a secure host (never commit credentials):\n"
                f"mysqldump --single-transaction --routines --triggers \\\n"
                f"  --databases <db> > recombyn-{stamp}.sql\n"
                f"# Or enable CynosDB / RDS automated backups.\n"
                f"# DATABASE_URL scheme present: mysql\n"
            )
        else:
            body = (
                f"# Generated {stamp} reason={reason}\n"
                f"# Run on a secure host:\n"
                f"pg_dump --format=custom --no-owner --dbname=\"$DATABASE_URL\" \\\n"
                f"  -f recombyn-{stamp}.dump\n"
                f"# Restore: pg_restore --clean --if-exists -d \"$DATABASE_URL\" file.dump\n"
            )
        hint.write_text(body, encoding="utf-8")
        created.append(str(hint))
        _prune_backups(out_dir, keep=keep, prefix=f"{d}-dump-")
        # Optional: copy hint only; do not embed URL secrets.
        del url

        result = {
            "ok": True,
            "dialect": d,
            "reason": reason,
            "files": created,
            "dir": str(out_dir),
            "at": stamp,
        }
        _log.info("db backup complete: %s", result)
        return result


def start_db_backup_scheduler() -> None:
    """Background thread — interval from ``DB_BACKUP_INTERVAL_HOURS``."""
    global _SCHEDULER_STARTED
    if _SCHEDULER_STARTED:
        return
    if not bool(getattr(settings, "db_backup_enabled", True)):
        return
    interval_h = float(getattr(settings, "db_backup_interval_hours", 24) or 24)
    if interval_h <= 0:
        return
    interval_s = max(3600.0, interval_h * 3600.0)

    def _loop() -> None:
        # Stagger first run so startup DDL settles.
        time.sleep(min(120.0, interval_s / 12))
        while True:
            try:
                run_db_backup(reason="scheduler")
            except Exception:
                _log.exception("scheduled db backup failed")
            time.sleep(interval_s)

    threading.Thread(target=_loop, name="db-backup", daemon=True).start()
    _SCHEDULER_STARTED = True
    _log.info("db backup scheduler started interval_h=%.2f", interval_h)
