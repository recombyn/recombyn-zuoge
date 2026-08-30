"""Plaza DB — MySQL / PostgreSQL."""

from __future__ import annotations

from app.services.db import init_schema


def init_plaza_db() -> None:
    init_schema()


__all__ = ["init_plaza_db"]
