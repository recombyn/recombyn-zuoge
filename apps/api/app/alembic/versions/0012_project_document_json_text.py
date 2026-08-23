"""Widen project/share/plaza/canvas text columns (MySQL VARCHAR(255) → LONGTEXT).

Revision ID: 0012_project_document_json_text
Revises: 0011_project_thumbnail_key_text
Create Date: 2026-08-13
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "0012_project_document_json_text"
down_revision = "0011_project_thumbnail_key_text"
branch_labels = None
depends_on = None

_MYSQL_ALTERS = (
    "ALTER TABLE projects MODIFY document_json LONGTEXT NULL",
    "ALTER TABLE document_shares MODIFY document_json LONGTEXT NOT NULL",
    "ALTER TABLE plaza_submissions MODIFY document_json LONGTEXT NULL",
    "ALTER TABLE plaza_submissions MODIFY cover_json LONGTEXT NULL",
    "ALTER TABLE plaza_submissions MODIFY cover_image_url TEXT NULL",
    "ALTER TABLE plaza_submissions MODIFY custom_cover_image_url TEXT NULL",
    "ALTER TABLE plaza_submissions MODIFY panel_urls_json LONGTEXT NULL",
    "ALTER TABLE design_canvas_tool MODIFY model_hint LONGTEXT NULL",
    "ALTER TABLE design_canvas_tool MODIFY args_schema LONGTEXT NULL",
)


def upgrade() -> None:
    bind = op.get_bind()
    if bind.dialect.name != "mysql":
        return
    insp = sa.inspect(bind)
    tables = set(insp.get_table_names())
    for stmt in _MYSQL_ALTERS:
        table = stmt.split()[2]
        if table in tables:
            op.execute(sa.text(stmt))


def downgrade() -> None:
    # Do not shrink TEXT/LONGTEXT back to VARCHAR — would truncate production data.
    pass
