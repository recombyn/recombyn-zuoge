"""Widen design_system_prompt.body + alembic_version.version_num.

Revision ID: 0013_dsp_body_longtext
Revises: 0012_project_document_json_text
Create Date: 2026-08-13

Note: revision id must stay ≤32 chars while version_num is still VARCHAR(32);
this upgrade widens version_num for later revisions.
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "0013_dsp_body_longtext"
down_revision = "0012_project_document_json_text"
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    if bind.dialect.name != "mysql":
        return
    # Stamp step needs room for longer revision ids (was VARCHAR(32)).
    op.execute(
        sa.text(
            "ALTER TABLE alembic_version MODIFY version_num VARCHAR(128) NOT NULL"
        )
    )
    insp = sa.inspect(bind)
    if "design_system_prompt" not in set(insp.get_table_names()):
        return
    op.execute(
        sa.text(
            "ALTER TABLE design_system_prompt MODIFY body LONGTEXT NOT NULL"
        )
    )


def downgrade() -> None:
    # Do not shrink LONGTEXT / version_num — would truncate production data.
    pass
