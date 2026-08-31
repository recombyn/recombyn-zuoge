"""Drop unused design_layer_lock table.

Layer locks CRUD/model were removed; table may still exist from older schemas.

Revision ID: 0028_drop_design_layer_lock
Revises: 0027_drop_token_pack_long_memory
Create Date: 2026-08-31
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "0028_drop_design_layer_lock"
down_revision = "0027_drop_token_pack_long_memory"
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    insp = sa.inspect(bind)
    if "design_layer_lock" in insp.get_table_names():
        op.drop_table("design_layer_lock")


def downgrade() -> None:
    pass
