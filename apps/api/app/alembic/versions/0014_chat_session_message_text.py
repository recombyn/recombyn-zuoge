"""Widen chat session/message text columns (MySQL VARCHAR(255) → LONGTEXT).

Revision ID: 0014_chat_session_message_text
Revises: 0013_design_system_prompt_body_text
Create Date: 2026-08-13
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "0014_chat_session_message_text"
down_revision = "0013_dsp_body_longtext"
branch_labels = None
depends_on = None

_MYSQL_ALTERS = (
    "ALTER TABLE chat_messages MODIFY content LONGTEXT NOT NULL",
    "ALTER TABLE chat_messages MODIFY thinking LONGTEXT NULL",
    "ALTER TABLE chat_messages MODIFY meta_json LONGTEXT NULL",
    "ALTER TABLE chat_sessions MODIFY meta_json LONGTEXT NULL",
    "ALTER TABLE design_global_rule MODIFY rule_value LONGTEXT NOT NULL",
    "ALTER TABLE design_global_rule MODIFY description LONGTEXT NULL",
    "ALTER TABLE llm_models MODIFY description LONGTEXT NULL",
    "ALTER TABLE llm_models MODIFY icon_url LONGTEXT NULL",
    "ALTER TABLE llm_models MODIFY reference_types LONGTEXT NULL",
    "ALTER TABLE llm_models MODIFY image_limits LONGTEXT NULL",
    "ALTER TABLE llm_models MODIFY price_meta LONGTEXT NULL",
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
    # Do not shrink LONGTEXT back to VARCHAR — would truncate production data.
    pass
