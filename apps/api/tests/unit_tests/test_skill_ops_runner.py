"""Optional skill handler.py → tool_ops runner."""
from __future__ import annotations

from pathlib import Path

import pytest

from app.services.design.prompts.skill_store import ops_runner


def test_runner_disabled_by_default(monkeypatch):
    monkeypatch.setattr(ops_runner, "_runner_enabled", lambda: False)
    ops, key, err = ops_runner.try_skill_ops_for_paint(
        skill_keys=["festival_poster"],
        prompt="中秋红色海报",
        scene_key="website",
    )
    assert ops is None
    assert key is None
    assert err is None


def test_festival_handler_resolves_and_runs(monkeypatch, tmp_path):
    monkeypatch.setattr(ops_runner, "_runner_enabled", lambda: True)
    monkeypatch.setattr(ops_runner, "_runner_timeout_sec", lambda: 10.0)

    repo = Path(__file__).resolve().parents[4]
    sample = repo / "plugins" / "skills" / "festival_poster" / "handler.py"
    assert sample.is_file(), f"missing sample handler: {sample}"

    root = tmp_path / "skills"
    pack = root / "festival_poster"
    pack.mkdir(parents=True)
    (pack / "handler.py").write_text(sample.read_text(encoding="utf-8"), encoding="utf-8")
    monkeypatch.setattr(
        "app.services.design.prompts.skill_store.pack_io._file_skills_dirs",
        lambda: [root],
    )

    hit = ops_runner.find_handler_for_skills(["festival_poster"])
    assert hit is not None
    assert hit[0] == "festival_poster"

    ops, key, err = ops_runner.try_skill_ops_for_paint(
        skill_keys=["festival_poster"],
        prompt="帮我生成一张中秋红色海报",
        scene_key="website",
    )
    assert err is None
    assert key == "festival_poster"
    assert ops is not None
    names = [str(o.get("name")) for o in ops]
    assert "create_frame" in names
    assert "create_text" in names


def test_handler_missing_run_returns_error(monkeypatch, tmp_path):
    monkeypatch.setattr(ops_runner, "_runner_enabled", lambda: True)
    pack = tmp_path / "broken"
    pack.mkdir()
    (pack / "handler.py").write_text("x = 1\n", encoding="utf-8")
    ops, err = ops_runner.run_skill_handler_ops(
        handler_path=pack / "handler.py",
        skill_key="broken",
        ctx={},
        payload={},
        timeout_sec=5.0,
    )
    assert ops is None
    assert err and "run_missing" in err


def test_pack_load_records_handler_path():
    from app.services.design.prompts.skill_store.pack_io import _load_file_skills

    items = {str(x.get("skill_key")): x for x in _load_file_skills()}
    fp = items.get("festival_poster")
    assert fp is not None
    handler = str(fp.get("_handler") or "")
    assert handler.endswith("handler.py")
