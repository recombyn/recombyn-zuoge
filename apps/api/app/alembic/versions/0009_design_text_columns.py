"""Widen design prompt/skill text columns (MySQL VARCHAR(255) → TEXT).

Revision ID: 0009_design_text_columns
Revises: 0008_org_invites
Create Date: 2026-08-13
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "0009_design_text_columns"
down_revision = "0008_org_invites"
branch_labels = None
depends_on = None

_MYSQL_ALTERS = (
    "ALTER TABLE design_prompt_pack MODIFY body LONGTEXT NOT NULL",
    "ALTER TABLE design_prompt_pack MODIFY when_to_use TEXT NULL",
    "ALTER TABLE design_skill MODIFY prompt_positive LONGTEXT NOT NULL",
    "ALTER TABLE design_skill MODIFY prompt_negative LONGTEXT NULL",
    "ALTER TABLE design_skill MODIFY when_to_use TEXT NULL",
    "ALTER TABLE design_skill MODIFY preferred_tools TEXT NULL",
    "ALTER TABLE design_skill MODIFY allowed_resources TEXT NULL",
    "ALTER TABLE design_skill MODIFY triggers TEXT NULL",
    "ALTER TABLE design_skill MODIFY description TEXT NULL",
    "ALTER TABLE design_skill MODIFY logo LONGTEXT NULL",
    "ALTER TABLE design_skill MODIFY locales TEXT NULL",
    "ALTER TABLE design_skill MODIFY input_schema TEXT NULL",
    "ALTER TABLE design_skill MODIFY output_schema TEXT NULL",
    "ALTER TABLE design_skill_revision MODIFY snapshot LONGTEXT NOT NULL",
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
    # Do not shrink TEXT back to VARCHAR — would truncate production data.
    pass
