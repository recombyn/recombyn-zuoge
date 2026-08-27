"""Widen remaining growing text/JSON columns (MySQL VARCHAR(255) → LONGTEXT).

Bare SQLModel ``str`` fields become AutoString → VARCHAR(255). Lottie ``meta_json``,
long prompts, model-usage blobs, and cold-archive metadata must not hit DataError 1406.

Revision ID: 0025_widen_growing_text_columns
Revises: 0024_assets_meta_json_longtext
Create Date: 2026-08-27
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "0025_widen_growing_text_columns"
down_revision = "0024_assets_meta_json_longtext"
branch_labels = None
depends_on = None

_ALTER: tuple[tuple[str, str], ...] = (
    ("assets", "prompt"),
    ("model_usage", "usage_json"),
    ("model_usage", "meta_json"),
    ("model_usage", "error"),
    ("design_cold_blob", "meta_json"),
)


def upgrade() -> None:
    bind = op.get_bind()
    if bind.dialect.name != "mysql":
        return
    insp = sa.inspect(bind)
    tables = set(insp.get_table_names())
    for table, column in _ALTER:
        if table not in tables:
            continue
        op.execute(
            sa.text(f"ALTER TABLE {table} MODIFY {column} LONGTEXT NULL")
        )


def downgrade() -> None:
    # Do not shrink LONGTEXT — would truncate production payloads.
    pass
