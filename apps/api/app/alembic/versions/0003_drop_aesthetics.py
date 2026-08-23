"""Drop design_quality_sample and related rows.

Revision ID: 0003_drop_aesthetics
Revises: 0002_sync_missing_columns
Create Date: 2026-08-09
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "0003_drop_aesthetics"
down_revision = "0002_sync_missing_columns"
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    insp = sa.inspect(bind)

    if "design_quality_sample" in insp.get_table_names():
        op.drop_table("design_quality_sample")

    # Prompt packs / system prompts / skills that only served aesthetics RAG.
    statements = [
        (
            "design_prompt_pack",
            "DELETE FROM design_prompt_pack WHERE "
            "kind LIKE 'agent.prompt.aesthetic%' OR "
            "kind LIKE 'aesthetics.%' OR "
            "kind = 'agent.prompt.pending_aesthetics' OR "
            "kind LIKE '%aesthetic%'",
        ),
        (
            "design_system_prompt",
            "DELETE FROM design_system_prompt WHERE "
            "prompt_key LIKE 'aesthetics.%' OR "
            "prompt_key LIKE 'agent.prompt.aesthetic%' OR "
            "prompt_key = 'agent.prompt.pending_aesthetics' OR "
            "group_key = 'aesthetics'",
        ),
        (
            "design_skill",
            "DELETE FROM design_skill WHERE "
            "skill_key = 'aesthetics_align' OR "
            "category = 'aesthetics' OR "
            "mutex_group = 'aesthetics'",
        ),
        (
            "design_skill_revision",
            "DELETE FROM design_skill_revision WHERE "
            "skill_key = 'aesthetics_align'",
        ),
        (
            "design_user_skill_pref",
            "DELETE FROM design_user_skill_pref WHERE skill_key = 'aesthetics_align'",
        ),
        (
            "design_global_rule",
            "DELETE FROM design_global_rule WHERE "
            "rule_key LIKE 'aesthetics.%' OR "
            "rule_key LIKE '%aesthetic%'",
        ),
    ]
    tables = set(insp.get_table_names())
    for table, sql in statements:
        if table not in tables:
            continue
        op.execute(sa.text(sql))

def downgrade() -> None:
    # Irreversible data drop — recreate empty table shape only if needed later.
    pass
