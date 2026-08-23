"""Pricing versions + model.pricing_id + model_usage.pricing_version_id.

Revision ID: 0015_pricing_versions
Revises: 0014_chat_session_message_text
Create Date: 2026-08-14
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "0015_pricing_versions"
down_revision = "0014_chat_session_message_text"
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    dialect = bind.dialect.name
    insp = sa.inspect(bind)

    if "pricing_versions" not in set(insp.get_table_names()):
        op.create_table(
            "pricing_versions",
            sa.Column("pricing_version_id", sa.String(128), primary_key=True),
            sa.Column("pricing_id", sa.String(128), nullable=False, server_default=""),
            sa.Column("provider", sa.String(64), nullable=False, server_default=""),
            sa.Column("model_id", sa.String(128), nullable=False, server_default=""),
            sa.Column("currency", sa.String(16), nullable=False, server_default="USD"),
            # MySQL: TEXT/BLOB/JSON cannot have a DEFAULT — app writes "[]".
            sa.Column("rates_json", sa.Text(), nullable=False),
            sa.Column("status", sa.String(32), nullable=False, server_default="draft"),
            sa.Column("effective_from", sa.Float(), nullable=True),
            sa.Column("effective_to", sa.Float(), nullable=True),
            sa.Column("source", sa.String(64), nullable=False, server_default=""),
            sa.Column("notes", sa.Text(), nullable=True),
            sa.Column("created_at", sa.Float(), nullable=False, server_default="0"),
            sa.Column("updated_at", sa.Float(), nullable=False, server_default="0"),
        )
        op.create_index("ix_pricing_versions_pricing_id", "pricing_versions", ["pricing_id"])
        op.create_index("ix_pricing_versions_model_id", "pricing_versions", ["model_id"])
        op.create_index("ix_pricing_versions_status", "pricing_versions", ["status"])

    if "llm_models" in set(insp.get_table_names()):
        cols = {c["name"] for c in insp.get_columns("llm_models")}
        if "pricing_id" not in cols:
            if dialect == "mysql":
                op.execute("ALTER TABLE llm_models ADD COLUMN pricing_id VARCHAR(128) NULL")
            else:
                op.add_column("llm_models", sa.Column("pricing_id", sa.String(128), nullable=True))

    if "model_usage" in set(insp.get_table_names()):
        cols = {c["name"] for c in insp.get_columns("model_usage")}
        if "pricing_version_id" not in cols:
            if dialect == "mysql":
                op.execute(
                    "ALTER TABLE model_usage ADD COLUMN pricing_version_id VARCHAR(128) NULL"
                )
            else:
                op.add_column(
                    "model_usage",
                    sa.Column("pricing_version_id", sa.String(128), nullable=True),
                )


def downgrade() -> None:
    bind = op.get_bind()
    dialect = bind.dialect.name
    insp = sa.inspect(bind)
    if "model_usage" in set(insp.get_table_names()):
        cols = {c["name"] for c in insp.get_columns("model_usage")}
        if "pricing_version_id" in cols:
            if dialect == "mysql":
                op.execute("ALTER TABLE model_usage DROP COLUMN pricing_version_id")
            else:
                op.drop_column("model_usage", "pricing_version_id")
    if "llm_models" in set(insp.get_table_names()):
        cols = {c["name"] for c in insp.get_columns("llm_models")}
        if "pricing_id" in cols:
            if dialect == "mysql":
                op.execute("ALTER TABLE llm_models DROP COLUMN pricing_id")
            else:
                op.drop_column("llm_models", "pricing_id")
    if "pricing_versions" in set(insp.get_table_names()):
        op.drop_table("pricing_versions")
