# -*- coding: utf-8 -*-
"""Tool pipeline seams."""
from __future__ import annotations

from unittest.mock import MagicMock

from app.services.design.runtime.seams.registry import HookRegistry
from app.services.design.runtime.seams.tool_pipeline import run_pipeline, validate_ops
from app.services.design.runtime.seams.types import ToolPipelineContext


def _ctx(**kwargs) -> ToolPipelineContext:
    base = {
        "task_id": "t1",
        "stage": "paint_ops",
        "profile_id": "design.canvas",
        "intent": "create",
        "scene_key": "website",
    }
    base.update(kwargs)
    return ToolPipelineContext(**base)


def test_validate_ops_empty_returns_empty():
    ops, errs = validate_ops(_ctx(), None)
    assert ops == []
    assert errs == []


def test_pre_hook_short_circuits_before_validate(monkeypatch):
    registry = HookRegistry()
    seen: list[str] = []

    def pre(ctx, value):
        seen.append("pre")
        return [{"name": "create_frame", "args": {"x": 0, "y": 0, "w": 100, "h": 100}}]

    registry.register_pre("test", pre, priority=1)

    host = MagicMock()
    host.validate_ops.return_value = (
        [{"name": "create_frame", "args": {"x": 0, "y": 0, "w": 100, "h": 100}}],
        [],
    )
    monkeypatch.setattr(
        "app.services.design.runtime.seams.tool_pipeline.resolve_tool_host",
        lambda: host,
    )
    monkeypatch.setattr(
        "app.services.design.runtime.seams.tool_pipeline.assess_tool_ops_result",
        lambda *a, **k: (True, None),
    )

    ops, errs, meta = run_pipeline(_ctx(), None, registry=registry)
    assert seen == ["pre"]
    assert len(ops) == 1
    assert not errs


def test_run_pipeline_returns_metadata_dict():
    registry = HookRegistry()

    def pre(ctx, value):
        ctx.metadata["marker"] = True
        return value

    registry.register_pre("mark", pre)
    ops, errs, meta = run_pipeline(_ctx(), None, registry=registry)
    assert isinstance(meta, dict)
    assert meta.get("marker") is True
    assert ops == []
    assert errs == []


def test_skill_ops_runner_skips_density_gate(monkeypatch):
    registry = HookRegistry()

    def pre(ctx, value):
        ctx.metadata["skill_ops_runner"] = "craft.demo"
        return [{"name": "create_frame", "args": {"x": 0, "y": 0, "w": 40, "h": 40}}]

    registry.register_pre("skill", pre, priority=1)
    host = MagicMock()
    host.validate_ops.return_value = (
        [{"name": "create_frame", "args": {"x": 0, "y": 0, "w": 40, "h": 40}}],
        [],
    )
    monkeypatch.setattr(
        "app.services.design.runtime.seams.tool_pipeline.resolve_tool_host",
        lambda: host,
    )

    def _dense_fail(*_a, **_k):
        raise AssertionError("density gate must not run for skill_ops_runner")

    monkeypatch.setattr(
        "app.services.design.runtime.seams.tool_pipeline.assess_tool_ops_result",
        _dense_fail,
    )
    ops, errs, meta = run_pipeline(_ctx(intent="create"), None, registry=registry)
    assert len(ops) == 1
    assert not errs
    assert meta.get("skill_ops_runner") == "craft.demo"
