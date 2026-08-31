"""Drop unused design_token_pack and agent_long_memory tables.

Token packs store was removed; long-term memory uses LangGraph Store only.

Revision ID: 0027_drop_token_pack_long_memory
Revises: 0026_fonts_faces_json_longtext
Create Date: 2026-08-31
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "0027_drop_token_pack_long_memory"
down_revision = "0026_fonts_faces_json_longtext"
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    insp = sa.inspect(bind)
    tables = set(insp.get_table_names())
    if "design_token_pack" in tables:
        op.drop_table("design_token_pack")
    if "agent_long_memory" in tables:
        op.drop_table("agent_long_memory")


def downgrade() -> None:
    pass
