"""ADR 0006 façade + Alembic single-head gate."""

from __future__ import annotations

from pathlib import Path


def test_llm_facade_exports_endpoint_and_chat_model():
    from app.services import llm as mod

    assert callable(mod.get_llm_endpoint)
    assert callable(mod.build_chat_model)
    assert not hasattr(mod, "resolve_chat_endpoint")
    assert not hasattr(mod, "chat_model_for")


def test_memory_tiers_documented():
    from app.services.agent_memory.service import MEMORY_TIERS

    assert set(MEMORY_TIERS) == {"session", "project", "global"}
    for note in MEMORY_TIERS.values():
        assert note.strip()


def test_alembic_single_head():
    """CI gate: migration graph must have exactly one head (no branches)."""
    from alembic.config import Config
    from alembic.script import ScriptDirectory

    api_root = Path(__file__).resolve().parents[2]
    cfg = Config(str(api_root / "alembic.ini"))
    script = ScriptDirectory.from_config(cfg)
    heads = script.get_heads()
    assert len(heads) == 1, f"expected one alembic head, got {heads}"


def test_alembic_revision_ids_fit_mysql_version_num():
    """MySQL alembic_version.version_num was historically VARCHAR(32).

    Keep ids short; 0013 widens to 128 — still enforce a hard ceiling in CI.
    """
    from alembic.config import Config
    from alembic.script import ScriptDirectory

    api_root = Path(__file__).resolve().parents[2]
    cfg = Config(str(api_root / "alembic.ini"))
    script = ScriptDirectory.from_config(cfg)
    too_long = [r.revision for r in script.walk_revisions() if len(r.revision) > 128]
    assert not too_long, f"revision id(s) longer than 128 chars: {too_long}"
