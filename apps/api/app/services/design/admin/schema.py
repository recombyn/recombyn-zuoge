"""Design skill schema boot — tables come from Alembic via ``init_schema()``."""

from __future__ import annotations


def ensure_design_tables_boot() -> None:
    """Ensure design (+ app) tables via Alembic. Kept name for call-site stability."""
    from app.services.db import init_schema

    init_schema()
