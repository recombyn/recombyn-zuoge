"""Canvas/meta tools: Admin registry + Pydantic args.

Name/doc/params from ``__name__`` / ``__doc__`` / ``args_schema``.
Prompts live in Admin ``design_global_rule``, not here.
"""

from __future__ import annotations

import json
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field, create_model


_META_TOOL_NAMES = frozenset(
    {
        "get_scene_summary",
        "ask_user",
        "list_capabilities",
        "finish",
    }
)


# --- Pydantic args models (meta tools) ---------------------------------------


class EmptyArgs(BaseModel):
    model_config = ConfigDict(extra="forbid")


class AskUserArgs(BaseModel):
    model_config = ConfigDict(extra="forbid")

    question: str = Field(description="Question shown to the user")
    options: list[str] | None = Field(
        default=None,
        description="Optional choice chips (one action each; do not include Cancel)",
    )


class FinishArgs(BaseModel):
    model_config = ConfigDict(extra="forbid")

    summary: str = Field(
        description="Short Chinese summary after canvas mutations succeeded",
    )


# --- Admin compact schema → Pydantic ----------------------------------------


def _parse_compact_field_spec(spec: Any) -> tuple[dict[str, Any], bool]:
    """Admin compact field → (JSON-Schema property, is_optional)."""
    if isinstance(spec, dict):
        return dict(spec), False
    s = str(spec or "string").strip()
    optional = s.endswith("?")
    if optional:
        s = s[:-1].strip()
    if s.endswith("[]"):
        item, _ = _parse_compact_field_spec(s[:-2].strip())
        return {"type": "array", "items": item}, optional
    if s in ("string", "str"):
        return {"type": "string"}, optional
    if s in ("number", "float"):
        return {"type": "number"}, optional
    if s in ("integer", "int"):
        return {"type": "integer"}, optional
    if s in ("boolean", "bool"):
        return {"type": "boolean"}, optional
    if s in ("object", "dict"):
        return {"type": "object"}, optional
    if s in ("array", "list"):
        return {"type": "array", "items": {"type": "string"}}, optional
    if "|" in s:
        enums = [p.strip() for p in s.split("|") if p.strip()]
        return {"type": "string", "enum": enums}, optional
    return {"type": "string", "description": s}, optional


def _args_schema_to_json_schema(raw: Any) -> dict[str, Any]:
    """Admin ``args_schema`` → OpenAI-style parameters object."""
    if isinstance(raw, str):
        text = raw.strip()
        if not text:
            return {"type": "object", "properties": {}, "additionalProperties": True}
        try:
            raw = json.loads(text)
        except Exception:
            return {"type": "object", "properties": {}, "additionalProperties": True}
    if not isinstance(raw, dict):
        return {"type": "object", "properties": {}, "additionalProperties": True}
    if raw.get("type") == "object" and isinstance(raw.get("properties"), dict):
        return {
            "type": "object",
            "properties": dict(raw.get("properties") or {}),
            "required": list(raw.get("required") or []),
            "additionalProperties": bool(raw.get("additionalProperties", False)),
        }
    props: dict[str, Any] = {}
    required: list[str] = []
    for key, spec in raw.items():
        name = str(key or "").strip()
        if not name:
            continue
        prop, optional = _parse_compact_field_spec(spec)
        props[name] = prop
        if not optional:
            required.append(name)
    return {
        "type": "object",
        "properties": props,
        "required": required,
        "additionalProperties": False,
    }


def _python_type_from_json_prop(meta: dict[str, Any]) -> Any:
    """JSON-Schema property → Python/typing annotation for create_model."""
    enums = meta.get("enum")
    if isinstance(enums, list) and enums:
        vals = tuple(str(x) for x in enums)
        return Literal.__getitem__(vals)  # type: ignore[index]

    t = str(meta.get("type") or "string")
    if t == "number":
        return float
    if t == "integer":
        return int
    if t == "boolean":
        return bool
    if t == "array":
        return list
    if t == "object":
        return dict
    return str


class _ForbidBase(BaseModel):
    """Base for dynamically created canvas args models."""

    model_config = ConfigDict(extra="forbid")


def pydantic_model_from_args_schema(
    op_key: str,
    raw: Any,
    *,
    model_name: str | None = None,
) -> type[BaseModel]:
    """Build a Pydantic args model from Admin compact / JSON Schema."""
    parameters = _args_schema_to_json_schema(raw)
    props = parameters.get("properties") if isinstance(parameters.get("properties"), dict) else {}
    required = set(parameters.get("required") or [])
    field_defs: dict[str, Any] = {}
    for key, meta in props.items():
        # Seed meta like ``_rev`` is not a model arg (Pydantic forbids leading ``_``).
        if not str(key).strip() or str(key).startswith("_"):
            continue
        meta = meta if isinstance(meta, dict) else {}
        typ = _python_type_from_json_prop(meta)
        desc_f = str(meta.get("description") or key)
        if key in required:
            field_defs[key] = (typ, Field(description=desc_f))
        else:
            field_defs[key] = (typ | None, Field(default=None, description=desc_f))
    name = model_name or f"{op_key}_Args"
    if not field_defs:
        return create_model(name, __base__=_ForbidBase)
    return create_model(name, __base__=_ForbidBase, **field_defs)


def _parameters_from_pydantic(model: type[BaseModel] | None) -> dict[str, Any]:
    """Pydantic model → OpenAI function ``parameters`` object."""
    if model is None:
        return {"type": "object", "properties": {}, "additionalProperties": False}
    schema = model.model_json_schema()
    out: dict[str, Any] = {
        "type": "object",
        "properties": dict(schema.get("properties") or {}),
        "additionalProperties": False,
    }
    req = schema.get("required")
    if isinstance(req, list) and req:
        out["required"] = list(req)
    # Keep $defs when nested models exist (rare for our tools).
    if "$defs" in schema:
        out["$defs"] = schema["$defs"]
    return out


def _doc_first_line(fn: Any) -> str:
    import inspect

    text = inspect.cleandoc(getattr(fn, "__doc__", None) or "").strip()
    if not text:
        return str(getattr(fn, "__name__", "tool") or "tool")
    return text.split("\n\n")[0].replace("\n", " ").strip()


# --- Canvas rows ------------------------------------------------------------


def _canvas_rows_for_tools() -> list[dict[str, Any]]:
    """Enabled Admin canvas tools; fall back to action_registry seed defaults."""
    try:
        from app.services.design.ops.tool_ops_contract import list_canvas_tools

        rows = list_canvas_tools(enabled_only=True)
        if rows:
            return rows
    except Exception:
        pass
    try:
        from app.services.design.ops.action_registry import default_canvas_actions

        out: list[dict[str, Any]] = []
        for a in default_canvas_actions():
            key = str(a.get("op_key") or "").strip()
            if not key:
                continue
            schema = a.get("args_schema")
            if not isinstance(schema, str):
                schema = json.dumps(schema or {}, ensure_ascii=False)
            out.append(
                {
                    "op_key": key,
                    "kind": str(a.get("kind") or "node"),
                    "label": str(a.get("label") or "").strip(),
                    "model_hint": str(a.get("model_hint") or "").strip(),
                    "args_schema": schema,
                }
            )
        return out
    except Exception:
        return []


def _delegated_payload(name: str, **kwargs: Any) -> str:
    """Client executes canvas mutations; server only acknowledges the tool call."""
    args = {k: v for k, v in kwargs.items() if v is not None}
    return json.dumps(
        {"status": "delegated_to_client", "name": name, "args": args},
        ensure_ascii=False,
    )


# --- Meta tools: function name + docstring + Pydantic args_schema -----------


def get_scene_summary() -> str:
    """Read frames + nodes. Call when unsure about canvas state or which artboard exists."""
    return _delegated_payload("get_scene_summary")


def ask_user(question: str, options: list[str] | None = None) -> str:
    """Stop and ask the user: unclear target frame, OR mid-task confirmation.

    Provide option chips (one action each; do not include Cancel).
    """
    return _delegated_payload("ask_user", question=question, options=options)


def list_capabilities() -> str:
    """List which canvas/editor features the Agent can control vs which are not wired yet.

    Call when the user asks about zoom, canvas color, agent mode, preview, share, export,
    or chrome. Export IS available via export_canvas.
    """
    return _delegated_payload("list_capabilities")


def finish(summary: str) -> str:
    """Mark the design task complete AFTER canvas tools succeeded.

    Call only after create_frame / create_shape / create_text / update_node (etc.) ran.
    Do not call if you only wrote a plan in chat.
    """
    return _delegated_payload("finish", summary=summary)


def _meta_tool_specs() -> list[tuple[Any, type[BaseModel]]]:
    """(function, Pydantic args model) — name/doc from function, params from model."""
    return [
        (get_scene_summary, EmptyArgs),
        (ask_user, AskUserArgs),
        (list_capabilities, EmptyArgs),
        (finish, FinishArgs),
    ]


def _structured_tool_from_fn(
    fn: Any,
    args_model: type[BaseModel] | None,
) -> Any:
    """Build StructuredTool from function + optional args_schema."""
    import inspect

    from langchain_core.tools import StructuredTool

    kwargs: dict[str, Any] = {
        "func": fn,
        "description": inspect.cleandoc(fn.__doc__ or fn.__name__),
    }
    if args_model is not None:
        kwargs["args_schema"] = args_model
    return StructuredTool.from_function(**kwargs)


def _make_canvas_tool(op_key: str, description: str, args_model: type[BaseModel]) -> Any:
    """Dynamic canvas tool: name=op_key, doc=model_hint, params=Pydantic model."""

    def _run(**kwargs: Any) -> str:
        return _delegated_payload(op_key, **kwargs)

    _run.__name__ = op_key
    _run.__doc__ = description or op_key
    return _structured_tool_from_fn(_run, args_model)


def _openai_fn_def(
    name: str,
    description: str,
    parameters: dict[str, Any],
) -> dict[str, Any]:
    return {
        "type": "function",
        "function": {
            "name": name,
            "description": (description or name).strip(),
            "parameters": parameters
            if isinstance(parameters, dict)
            else {"type": "object", "properties": {}},
        },
    }


def design_tool_definitions() -> list[dict[str, Any]]:
    """OpenAI function-calling list: meta + Admin-enabled canvas ops."""
    out: list[dict[str, Any]] = []
    for fn, model in _meta_tool_specs():
        out.append(
            _openai_fn_def(
                fn.__name__,
                _doc_first_line(fn),
                _parameters_from_pydantic(model),
            )
        )

    seen = set(_META_TOOL_NAMES)
    for row in _canvas_rows_for_tools():
        key = str(row.get("op_key") or "").strip()
        if not key or key in seen:
            continue
        seen.add(key)
        hint = str(row.get("model_hint") or "").strip()
        label = str(row.get("label") or "").strip()
        desc = hint or (f"{label} ({key})" if label else key)
        model = pydantic_model_from_args_schema(key, row.get("args_schema"))
        out.append(_openai_fn_def(key, desc, _parameters_from_pydantic(model)))
    return out


def design_langchain_tools() -> list[Any]:
    """StructuredTools for meta + Admin canvas ops; appends ``generate_image``."""
    tools: list[Any] = []
    for fn, model in _meta_tool_specs():
        tools.append(_structured_tool_from_fn(fn, model))

    seen = set(_META_TOOL_NAMES)
    for row in _canvas_rows_for_tools():
        key = str(row.get("op_key") or "").strip()
        if not key or key in seen:
            continue
        seen.add(key)
        hint = str(row.get("model_hint") or "").strip()
        label = str(row.get("label") or "").strip()
        desc = hint or (f"{label} ({key})" if label else key)
        model = pydantic_model_from_args_schema(key, row.get("args_schema"))
        tools.append(_make_canvas_tool(key, desc, model))

    try:
        from app.services.llm.image import image_chain

        tools.append(image_chain)
    except Exception:
        pass
    return tools
