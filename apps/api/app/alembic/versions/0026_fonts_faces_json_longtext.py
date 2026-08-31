"""Widen fonts.faces_json (MySQL VARCHAR(255) → LONGTEXT).

Font families with multiple @font-face URLs exceed 255 chars and fail seed with
DataError 1406, leaving the catalog empty in the editor font picker.

Revision ID: 0026_fonts_faces_json_longtext
Revises: 0025_widen_growing_text_columns
Create Date: 2026-08-31
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "0026_fonts_faces_json_longtext"
down_revision = "0025_widen_growing_text_columns"
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    if bind.dialect.name != "mysql":
        return
    insp = sa.inspect(bind)
    if "fonts" not in insp.get_table_names():
        return
    op.execute(sa.text("ALTER TABLE fonts MODIFY faces_json LONGTEXT NOT NULL"))


def downgrade() -> None:
    # Do not shrink LONGTEXT — would truncate catalog face metadata.
    pass
