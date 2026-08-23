"""Email OTP timestamps: MySQL FLOAT/DOUBLE to BIGINT unix seconds.

Revision ID: 0010_email_code_double
Revises: 0009_design_text_columns
Create Date: 2026-08-13
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "0010_email_code_double"
down_revision = "0009_design_text_columns"
branch_labels = None
depends_on = None

# Keep revision id for servers that already applied an earlier DOUBLE draft of 0010;
# upgrading FLOAT or DOUBLE to BIGINT is idempotent for OTP tables.
_MYSQL_ALTERS = (
    "ALTER TABLE email_codes MODIFY sent_at BIGINT NOT NULL DEFAULT 0",
    "ALTER TABLE email_codes MODIFY expires_at BIGINT NOT NULL DEFAULT 0",
    "ALTER TABLE email_tickets MODIFY expires_at BIGINT NOT NULL DEFAULT 0",
    "ALTER TABLE email_activate_tokens MODIFY expires_at BIGINT NOT NULL DEFAULT 0",
    "ALTER TABLE email_activate_tokens MODIFY created_at BIGINT NOT NULL DEFAULT 0",
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
    pass
