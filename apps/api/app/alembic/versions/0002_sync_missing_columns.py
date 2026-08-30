"""Sync columns missing from pre-Alembic DBs (stamped 0001 no-op).

Revision ID: 0002_sync_missing_columns
Revises: 0001_baseline
Create Date: 2026-08-08

``0001_baseline`` used ``create_all``, which does not ALTER existing tables.
DBs stamped at 0001 can lack columns added to SQLModel later
(e.g. ``users.default_avatar``).
"""

from __future__ import annotations

from collections import defaultdict

import sqlalchemy as sa
from alembic import op

revision = "0002_sync_missing_columns"
down_revision = "0001_baseline"
branch_labels = None
depends_on = None

# (table, column_name, sa.Column(...)) — only added when missing.
_COLUMNS: list[tuple[str, str, sa.Column]] = [
    ("users", "default_avatar", sa.Column("default_avatar", sa.Text(), nullable=True)),
    (
        "users",
        "role",
        sa.Column("role", sa.String(length=16), nullable=False, server_default="user"),
    ),
    (
        "users",
        "status",
        sa.Column("status", sa.String(length=16), nullable=False, server_default="active"),
    ),
    ("chat_messages", "meta_json", sa.Column("meta_json", sa.Text(), nullable=True)),
    ("chat_sessions", "meta_json", sa.Column("meta_json", sa.Text(), nullable=True)),
    (
        "card_keys",
        "kind",
        sa.Column("kind", sa.String(length=16), nullable=False, server_default="token"),
    ),
    ("card_keys", "plan_id", sa.Column("plan_id", sa.String(length=16), nullable=True)),
    ("plaza_submissions", "cover_json", sa.Column("cover_json", sa.Text(), nullable=True)),
    (
        "plaza_submissions",
        "cover_image_url",
        sa.Column("cover_image_url", sa.Text(), nullable=True),
    ),
    (
        "plaza_submissions",
        "custom_cover_image_url",
        sa.Column("custom_cover_image_url", sa.Text(), nullable=True),
    ),
    (
        "plaza_submissions",
        "panel_urls_json",
        sa.Column("panel_urls_json", sa.Text(), nullable=True),
    ),
    (
        "plaza_submissions",
        "like_count",
        sa.Column("like_count", sa.Integer(), nullable=False, server_default="0"),
    ),
    (
        "plaza_submissions",
        "use_count",
        sa.Column("use_count", sa.Integer(), nullable=False, server_default="0"),
    ),
    (
        "plaza_submissions",
        "is_visible",
        sa.Column("is_visible", sa.Integer(), nullable=False, server_default="1"),
    ),
    (
        "projects",
        "thumbnail_custom",
        sa.Column("thumbnail_custom", sa.Integer(), nullable=False, server_default="0"),
    ),
    (
        "projects",
        "revision",
        sa.Column("revision", sa.Integer(), nullable=False, server_default="1"),
    ),
    (
        "user_balances",
        "image_credits",
        sa.Column("image_credits", sa.Integer(), nullable=False, server_default="0"),
    ),
    (
        "user_balances",
        "plan_id",
        sa.Column("plan_id", sa.String(length=16), nullable=False, server_default="free"),
    ),
    (
        "user_balances",
        "plan_expires_at",
        sa.Column("plan_expires_at", sa.Float(), nullable=True),
    ),
]


def _columns_by_table() -> dict[str, list[tuple[str, sa.Column]]]:
    grouped: dict[str, list[tuple[str, sa.Column]]] = defaultdict(list)
    for table, col_name, column in _COLUMNS:
        grouped[table].append((col_name, column))
    return grouped


def upgrade() -> None:
    bind = op.get_bind()
    insp = sa.inspect(bind)
    tables = set(insp.get_table_names())
    for table, cols in _columns_by_table().items():
        if table not in tables:
            continue
        existing = {c["name"] for c in insp.get_columns(table)}
        to_add = [(name, column) for name, column in cols if name not in existing]
        if not to_add:
            continue
        with op.batch_alter_table(table) as batch:
            for _name, column in to_add:
                batch.add_column(column)


def downgrade() -> None:
    bind = op.get_bind()
    insp = sa.inspect(bind)
    tables = set(insp.get_table_names())
    for table, cols in reversed(list(_columns_by_table().items())):
        if table not in tables:
            continue
        existing = {c["name"] for c in insp.get_columns(table)}
        to_drop = [name for name, _column in cols if name in existing]
        if not to_drop:
            continue
        with op.batch_alter_table(table) as batch:
            for name in to_drop:
                batch.drop_column(name)
