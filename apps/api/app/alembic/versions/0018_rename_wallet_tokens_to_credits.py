"""Rename wallet 积分 columns tokens → credits.

Revision ID: 0018_rename_wallet_tokens_to_credits
Revises: 0017_drop_image_credits
"""
from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "0018_rename_wallet_tokens_to_credits"
down_revision = "0017_drop_image_credits"
branch_labels = None
depends_on = None

_TABLES = ("user_balances", "card_keys")


def _rename_column(table: str, old: str, new: str) -> None:
    bind = op.get_bind()
    insp = sa.inspect(bind)
    if table not in insp.get_table_names():
        return
    cols = {c["name"] for c in insp.get_columns(table)}
    if old not in cols or new in cols:
        return
    with op.batch_alter_table(table) as batch:
        batch.alter_column(old, new_column_name=new)


def upgrade() -> None:
    for table in _TABLES:
        _rename_column(table, "tokens", "credits")


def downgrade() -> None:
    for table in _TABLES:
        _rename_column(table, "credits", "tokens")
