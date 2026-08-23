"""Baseline schema from SQLModel metadata.

Revision ID: 0001_baseline
Revises:
Create Date: 2026-08-06

Greenfield: create_all. Existing MySQL/SQLite with tables already present:
create_all is a no-op for existing tables; alembic_version is stamped.
"""

from __future__ import annotations

from alembic import op
from sqlmodel import SQLModel

from app import models as _models  # noqa: F401

# revision identifiers, used by Alembic.
revision = "0001_baseline"
down_revision = None
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    SQLModel.metadata.create_all(bind=bind)


def downgrade() -> None:
    bind = op.get_bind()
    SQLModel.metadata.drop_all(bind=bind)
