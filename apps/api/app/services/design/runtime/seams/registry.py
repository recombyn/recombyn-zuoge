"""Hook registry for tool pipeline pre/post execution."""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any

from app.services.design.runtime.seams.types import ToolOpsHook, ToolPipelineContext


@dataclass(order=True)
class _HookEntry:
    priority: int
    name: str = field(compare=False)
    fn: ToolOpsHook = field(compare=False)


class HookRegistry:
    def __init__(self) -> None:
        self._pre: list[_HookEntry] = []
        self._post: list[_HookEntry] = []

    def has_pre(self, name: str) -> bool:
        return any(entry.name == name for entry in self._pre)

    def register_pre(self, name: str, fn: ToolOpsHook, *, priority: int = 50) -> None:
        self._pre.append(_HookEntry(priority=priority, name=name, fn=fn))
        self._pre.sort()

    def register_post(self, name: str, fn: ToolOpsHook, *, priority: int = 50) -> None:
        self._post.append(_HookEntry(priority=priority, name=name, fn=fn))
        self._post.sort()

    def _run(self, hooks: list[_HookEntry], ctx: ToolPipelineContext, value: Any) -> Any:
        current = value
        for entry in hooks:
            try:
                result = entry.fn(ctx, current)
            except Exception:
                continue
            if result is not None:
                current = result
        return current

    def run_pre(self, ctx: ToolPipelineContext, value: Any) -> Any:
        return self._run(self._pre, ctx, value)

    def run_post(self, ctx: ToolPipelineContext, value: Any) -> Any:
        return self._run(self._post, ctx, value)


DEFAULT_HOOK_REGISTRY = HookRegistry()
