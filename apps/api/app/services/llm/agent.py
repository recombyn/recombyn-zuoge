"""Streaming LLM agent turn (create_agent + bind_tools)."""

from __future__ import annotations

import logging
import re
import threading
from collections.abc import AsyncIterator, Iterator, Sequence
from pathlib import Path
from typing import Any, Literal

from app.services.llm import (
    build_chat_model,
    content_text_from_chunk,
    get_llm_endpoint,
    llm_error_detail,
    thinking_text_from_chunk,
    to_lc_messages,
)
from app.services.llm.design_tools import design_langchain_tools

AgentEvent = Literal["thinking", "token", "tool_call", "tool_result", "message"]

_log = logging.getLogger(__name__)
_CHECKPOINTER_LOCK = threading.Lock()
_CHECKPOINTER: Any = None
_CHECKPOINTER_BACKEND: str = ""
# Keep underlying DB connections alive for process lifetime (from_conn_string closes them).
_CHECKPOINTER_CONN: Any = None

# Design outer graph state (AgentRuntime / nested dataclasses) — msgpack allowlist.
# No pickle_fallback: callables must stay out of checkpointed state.
_CHECKPOINT_MSGPACK_MODULES: tuple[tuple[str, str], ...] = (
    ("app.services.design.runtime.graph.state", "AgentRuntime"),
    ("app.services.design.runtime.graph.state", "AgentRunState"),
    ("app.services.design.runtime.decision_log", "DesignRunDecision"),
    ("services.design.runtime.graph.state", "AgentRuntime"),
    ("services.design.runtime.graph.state", "AgentRunState"),
    ("services.design.runtime.decision_log", "DesignRunDecision"),
)

# Server-executed tool names. Canvas ops stay client-side.
_SERVER_TOOL_NAMES = frozenset({"generate_image"})

# Runtime meta tools — not canvas paint ops.
_HOST_META_TOOL_NAMES = frozenset(
    {
        "finish",
        "ask_user",
        "request_tool_schemas",
        "recall_long_term_memory",
        "remember_long_term_memory",
    }
)


def tool_calls_to_canvas_ops(tool_calls: list[dict[str, Any]] | None) -> list[dict[str, Any]]:
    """Map tool_calls → FE ``tool_ops`` ``{name, args}`` (canvas only)."""
    import json as _json

    out: list[dict[str, Any]] = []
    for tc in tool_calls or []:
        if not isinstance(tc, dict):
            continue
        fn = tc.get("function") if isinstance(tc.get("function"), dict) else {}
        name = str((fn or {}).get("name") or tc.get("name") or "").strip()
        if not name or name in _HOST_META_TOOL_NAMES or name in _SERVER_TOOL_NAMES:
            continue
        raw_args = (fn or {}).get("arguments") if fn else tc.get("arguments")
        if raw_args is None:
            raw_args = tc.get("args")
        if isinstance(raw_args, dict):
            args = raw_args
        else:
            try:
                args = _json.loads(raw_args or "{}")
            except Exception:
                args = {}
        if not isinstance(args, dict):
            args = {}
        out.append({"name": name, "args": args})
    return out


def assemble_turn_from_lc_tools(
    *,
    content: str,
    tool_calls: list[dict[str, Any]] | None,
) -> dict[str, Any]:
    """
    Build the runtime turn dict from LangChain narrate + tool_calls (no JSON blob).

    - Natural-language ``content`` → reply / short thought
    - Canvas tool_calls → tool_ops_raw
    - Meta tools → need_* / choice_ui / done
    """
    import json as _json

    from app.services.design.ops.tool_ops_contract import normalize_need_tools

    text = (content or "").strip()
    ops = tool_calls_to_canvas_ops(tool_calls)
    need_tools: list[str] = []
    ask_labels: list[str] = []
    done = False
    finish_summary = ""
    asked = False

    for tc in tool_calls or []:
        if not isinstance(tc, dict):
            continue
        fn = tc.get("function") if isinstance(tc.get("function"), dict) else {}
        name = str((fn or {}).get("name") or tc.get("name") or "").strip()
        raw_args = (fn or {}).get("arguments") if fn else tc.get("arguments")
        if raw_args is None:
            raw_args = tc.get("args")
        if isinstance(raw_args, dict):
            args = raw_args
        else:
            try:
                args = _json.loads(raw_args or "{}")
            except Exception:
                args = {}
        if not isinstance(args, dict):
            args = {}

        if name == "finish":
            done = True
            finish_summary = str(args.get("summary") or "").strip()
        elif name == "ask_user":
            asked = True
            q = str(args.get("question") or "").strip()
            if q:
                text = q
            raw_c = args.get("options")
            if isinstance(raw_c, list):
                for c in raw_c:
                    s = str(c or "").strip()
                    if s and s not in ask_labels:
                        ask_labels.append(s[:24])
                    if len(ask_labels) >= 6:
                        break
        elif name == "request_tool_schemas":
            need_tools.extend(
                normalize_need_tools(args.get("op_keys") or args)
            )

    need_tools = normalize_need_tools(need_tools)
    reply = finish_summary or text
    thought = (text.split("\n")[0] if text else "")[:40] or (
        "编辑画布" if ops else ("确认需求" if asked else "处理中")
    )

    if ops:
        intent = (
            "create"
            if any(str(o.get("name") or "") in ("create_frame", "create_image") for o in ops)
            else "edit"
        )
    elif need_tools:
        intent = "edit"
    elif asked:
        intent = "ask"
    elif done:
        intent = "done"
    else:
        intent = "chat"

    if intent in ("chat", "ask", "done") and not ops:
        done = True
    if need_tools:
        done = False

    choice_ui = None
    if asked and ask_labels:
        choice_ui = {
            "mode": "single",
            "options": [{"label": label, "action": "reply"} for label in ask_labels],
        }

    return {
        "intent": intent,
        "reply": reply,
        "thought": thought,
        "tool_ops_raw": ops or None,
        "need_tools": need_tools,
        "choice_ui": choice_ui,
        "done": done,
        "raw_obj": {"via": "langchain_tools", "tool_calls": tool_calls or []},
    }


def design_thought_langchain_tools() -> list[Any]:
    """Canvas + runtime meta tools for narrate-then-act turns.

    Runtime ``ask_user`` returns ``await_user`` (choice chips), not delegated_to_client.
    """
    import json as _json

    from langchain_core.tools import StructuredTool
    from pydantic import BaseModel, ConfigDict, Field

    class AskUserRuntimeArgs(BaseModel):
        model_config = ConfigDict(extra="forbid")
        question: str = Field(description="Clarifying question before painting")
        options: list[str] | None = Field(
            default=None,
            description="Optional short choice chips",
        )

    class RequestToolSchemasArgs(BaseModel):
        model_config = ConfigDict(extra="forbid")
        op_keys: list[str] = Field(
            description="Canvas op_keys to load full schemas for",
        )

    def ask_user(question: str, options: list[str] | None = None) -> str:
        """Ask the user one clarifying question before painting. Optional short choice chips."""
        return _json.dumps(
            {"status": "await_user", "question": question, "options": options or []},
            ensure_ascii=False,
        )

    def request_tool_schemas(op_keys: list[str]) -> str:
        """Request full schemas for canvas op_keys from the short catalog.

        Runtime injects details next turn; do not emit canvas ops yet.
        """
        return _json.dumps(
            {"status": "runtime_will_inject", "op_keys": op_keys},
            ensure_ascii=False,
        )

    tools = [
        t
        for t in design_langchain_tools()
        if getattr(t, "name", None) not in _SERVER_TOOL_NAMES
        and getattr(t, "name", None) != "ask_user"
    ]
    tools.extend(
        [
            StructuredTool.from_function(func=ask_user, args_schema=AskUserRuntimeArgs),
            StructuredTool.from_function(
                func=request_tool_schemas,
                args_schema=RequestToolSchemasArgs,
            ),
        ]
    )
    try:
        from app.services.agent_memory.long_term import long_term_store_tools

        tools.extend(long_term_store_tools())
    except Exception:
        _log.debug("long_term_store_tools unavailable", exc_info=True)
    return tools


def _normalize_messages(raw: list[dict[str, Any]] | None) -> list[dict[str, Any]]:
    out: list[dict[str, Any]] = []
    for item in raw or []:
        if not isinstance(item, dict):
            continue
        role = str(item.get("role") or "").strip()
        if role not in ("system", "user", "assistant", "tool"):
            continue
        msg: dict[str, Any] = {"role": role}
        if role == "tool":
            msg["tool_call_id"] = str(item.get("tool_call_id") or "")
            msg["content"] = str(item.get("content") or "")
            out.append(msg)
            continue
        if item.get("content") is not None:
            msg["content"] = item.get("content")
        tcs = item.get("tool_calls")
        if role == "assistant" and isinstance(tcs, list) and tcs:
            msg["tool_calls"] = tcs
            if "content" not in msg:
                msg["content"] = item.get("content")
        out.append(msg)
    return out


def _chat_agent_system(*, model: str | None = None) -> str:
    """Admin design_global_rule only; always prefix IDENTITY when configured."""
    try:
        from app.services.design.prompts.prompt_pack_store import render_prompt_body
        from app.services.design.readpath.catalog import get_global_rules

        rules = get_global_rules() or {}
        base = render_prompt_body(
            "agent.prompt.chat_agent_system", rules=rules
        ).strip()
        mid = (model or "auto").strip() or "auto"
        if mid.lower() == "auto":
            persona = render_prompt_body("agent.persona.auto", rules=rules).strip()
        else:
            persona = render_prompt_body(
                "agent.persona.locked", rules=rules, model_label=mid
            ).strip()
        if persona and "IDENTITY:" not in base:
            return f"IDENTITY: {persona}\n\n{base}" if base else f"IDENTITY: {persona}"
        return base
    except Exception:  # noqa: BLE001
        pass
    return ""


def _with_system_identity(system: str, *, model: str | None = None) -> str:
    """Ensure IDENTITY is present on an explicit system_prompt string."""
    text = (system or "").strip()
    if not text:
        return _chat_agent_system(model=model)
    if "IDENTITY:" in text:
        return text
    prefixed = _chat_agent_system(model=model)
    # Only steal the IDENTITY line from the default composer.
    identity_lines = [
        ln for ln in prefixed.splitlines() if ln.strip().startswith("IDENTITY:")
    ]
    if not identity_lines:
        return text
    return "\n\n".join([*identity_lines, text])


def _agent_model_id(requested: str | None, endpoint_model: str) -> str:
    """Use resolved ``api_model`` (Ark dated ids). Reasoner aliases lack tool_calls."""
    req = (requested or "").strip()
    api = (endpoint_model or "").strip()
    # Catalog ids (deepseek-v4-flash, doubao-seed-2-1-turbo) 404 on Ark; endpoint_model
    # is the real inference id from resolve_provider / get_llm_endpoint.
    probe = f"{api} {req}".lower()
    if "reasoner" in probe:
        return "deepseek-chat"
    return api or req or "deepseek-chat"


def _tool_calls_from_message(msg: Any) -> list[dict[str, Any]]:
    """Normalize tool_calls → OpenAI chat.completions shape."""
    import json as _json

    raw = getattr(msg, "tool_calls", None) or []
    out: list[dict[str, Any]] = []
    for i, tc in enumerate(raw):
        if isinstance(tc, dict):
            name = str(tc.get("name") or "")
            tc_id = str(tc.get("id") or f"call_{i}")
            args = tc.get("args") if "args" in tc else tc.get("arguments")
        else:
            name = str(getattr(tc, "name", "") or "")
            tc_id = str(getattr(tc, "id", "") or f"call_{i}")
            args = getattr(tc, "args", None)
        if not name:
            continue
        if isinstance(args, str):
            args_s = args
        else:
            try:
                args_s = _json.dumps(args if args is not None else {}, ensure_ascii=False)
            except Exception:
                args_s = "{}"
        out.append(
            {
                "id": tc_id,
                "type": "function",
                "function": {"name": name, "arguments": args_s},
            }
        )
    return out


def server_langchain_tools() -> list[Any]:
    """Tools the backend executes (e.g. generate_image)."""
    return [
        t
        for t in design_langchain_tools()
        if getattr(t, "name", None) in _SERVER_TOOL_NAMES
    ]


def agent_thread_config(thread_id: str | None) -> dict[str, Any] | None:
    """LangGraph config with ``thread_id`` for checkpointed runs."""
    tid = str(thread_id or "").strip()
    if not tid:
        return None
    return {"configurable": {"thread_id": tid}}


def langfuse_enabled() -> bool:
    from app.core.config import settings

    return bool(
        settings.langfuse_tracing
        and (settings.langfuse_public_key or "").strip()
        and (settings.langfuse_secret_key or "").strip()
    )


def configure_langfuse() -> dict[str, Any]:
    """Apply Langfuse env from settings. Returns status for Admin / logs."""
    import os

    from app.core.config import settings

    pk = (settings.langfuse_public_key or "").strip()
    sk = (settings.langfuse_secret_key or "").strip()
    base = (settings.langfuse_base_url or "https://cloud.langfuse.com").strip().rstrip("/")
    enabled = bool(settings.langfuse_tracing) and bool(pk) and bool(sk)
    # Disable LangSmith auto-tracing (we use Langfuse).
    os.environ["LANGCHAIN_TRACING_V2"] = "false"
    os.environ.pop("LANGSMITH_TRACING", None)
    if enabled:
        os.environ["LANGFUSE_PUBLIC_KEY"] = pk
        os.environ["LANGFUSE_SECRET_KEY"] = sk
        os.environ["LANGFUSE_BASE_URL"] = base
        os.environ["LANGFUSE_HOST"] = base
        try:
            from langfuse import get_client

            get_client()
        except Exception:
            _log = __import__("logging").getLogger("services.llm.agent")
            _log.exception("langfuse get_client failed")
    else:
        for k in ("LANGFUSE_PUBLIC_KEY", "LANGFUSE_SECRET_KEY", "LANGFUSE_BASE_URL", "LANGFUSE_HOST"):
            os.environ.pop(k, None)
    return {
        "enabled": enabled,
        "host": base,
        "projectId": (settings.langfuse_project_id or "").strip() or None,
        "consoleUrl": langfuse_console_url(),
    }


def langfuse_console_url(
    *,
    task_id: str | None = None,
    trace_id: str | None = None,
) -> str:
    """Best-effort Langfuse console URL (trace deep-link when possible)."""
    from app.core.config import settings

    base = (settings.langfuse_base_url or "https://cloud.langfuse.com").strip().rstrip("/")
    tid = (trace_id or "").strip()
    if tid:
        try:
            from langfuse import get_client

            url = get_client().get_trace_url(trace_id=tid)
            if url:
                return str(url)
        except Exception:
            pass
        proj = (settings.langfuse_project_id or "").strip()
        if proj:
            return f"{base}/project/{proj}/traces/{tid}"
    proj = (settings.langfuse_project_id or "").strip()
    task = (task_id or "").strip()
    if proj:
        # Traces list; filter in UI with metadata.task_id
        url = f"{base}/project/{proj}/traces"
        if task:
            from urllib.parse import quote

            url = f"{url}?search={quote(task)}"
        return url
    return base


def langfuse_callback_handler() -> Any | None:
    """Fresh Langfuse LangChain CallbackHandler, or None if tracing off."""
    if not langfuse_enabled():
        return None
    try:
        from langfuse.langchain import CallbackHandler

        return CallbackHandler()
    except Exception:
        return None


def merge_tracing_config(
    config: dict[str, Any] | None,
    *,
    run_name: str | None = None,
    metadata: dict[str, Any] | None = None,
    tags: list[str] | None = None,
    callbacks: list[Any] | None = None,
) -> dict[str, Any]:
    """Attach Langfuse callbacks + run name / metadata / tags onto LangGraph config."""
    out: dict[str, Any] = dict(config or {})
    if run_name:
        out["run_name"] = str(run_name)[:128]
    merged_tags: list[str] = []
    prev = out.get("tags")
    if isinstance(prev, list):
        merged_tags.extend(str(t) for t in prev if str(t or "").strip())
    if tags:
        for t in tags:
            s = str(t or "").strip()
            if s and s not in merged_tags:
                merged_tags.append(s)
    if merged_tags:
        out["tags"] = merged_tags

    prev_m = out.get("metadata")
    base_m: dict[str, Any] = dict(prev_m) if isinstance(prev_m, dict) else {}
    if metadata:
        for k, v in metadata.items():
            if v is None:
                continue
            # Stringify non-scalars for Langfuse metadata.
            base_m[str(k)] = v if isinstance(v, (str, int, float, bool)) else str(v)
    uid = str(base_m.get("langfuse_user_id") or base_m.get("user_id") or "").strip()
    if uid:
        base_m["langfuse_user_id"] = uid
    session = str(
        base_m.get("langfuse_session_id") or base_m.get("task_id") or base_m.get("trace_id") or ""
    ).strip()
    if session:
        base_m["langfuse_session_id"] = session
    if merged_tags:
        base_m["langfuse_tags"] = list(merged_tags)
    if base_m.get("task_id") is not None:
        base_m["task_id"] = str(base_m["task_id"])
    if base_m:
        out["metadata"] = base_m

    cbs: list[Any] = []
    prev_cbs = out.get("callbacks")
    if isinstance(prev_cbs, list):
        cbs.extend(prev_cbs)
    if callbacks:
        for cb in callbacks:
            if cb is not None and cb not in cbs:
                cbs.append(cb)

    def _is_langfuse_handler(cb: Any) -> bool:
        mod = getattr(type(cb), "__module__", "") or ""
        return type(cb).__name__ == "CallbackHandler" and "langfuse" in mod

    if not any(_is_langfuse_handler(cb) for cb in cbs):
        lf = langfuse_callback_handler()
        if lf is not None:
            cbs.append(lf)
    if cbs:
        out["callbacks"] = cbs
    return out


def _checkpoint_mysql_url() -> str:
    from app.core.config import settings

    raw = (settings.langgraph_checkpoint_url or settings.database_url or "").strip()
    if not raw.startswith("mysql"):
        return ""
    return raw.replace("mysql+pymysql://", "mysql://", 1)


def _checkpoint_sqlite_path() -> Path:
    from app.core.config import _API_ROOT, settings

    raw = (settings.langgraph_checkpoint_sqlite_path or "").strip()
    if not raw:
        raw = "storage/langgraph_checkpoints.db"
    p = Path(raw)
    if not p.is_absolute():
        p = _API_ROOT / p
    p.parent.mkdir(parents=True, exist_ok=True)
    return p


def _checkpoint_serde() -> Any:
    """Shared checkpoint serde (no pickle)."""
    from langgraph.checkpoint.serde.jsonplus import JsonPlusSerializer

    return JsonPlusSerializer(
        pickle_fallback=False,
        allowed_msgpack_modules=list(_CHECKPOINT_MSGPACK_MODULES),
    )


def _mysql_version_ok_for_langgraph(version: str) -> bool:
    """langgraph-checkpoint-mysql needs MySQL >= 8.0.19 or MariaDB >= 10.7.1."""
    raw = (version or "").strip().lower()
    if not raw:
        return False
    if "mariadb" in raw:
        m = re.search(r"(\d+)\.(\d+)\.(\d+)", raw)
        return bool(m) and tuple(int(x) for x in m.groups()) >= (10, 7, 1)
    m = re.match(r"(\d+)\.(\d+)\.(\d+)", raw)
    return bool(m) and tuple(int(x) for x in m.groups()) >= (8, 0, 19)


def _checkpointer_async_is_stub(saver: Any) -> bool:
    """True when ``aget_tuple`` is NotImplemented / SqliteSaver's raise stub."""
    import inspect

    try:
        src = inspect.getsource(type(saver).aget_tuple)
    except (OSError, TypeError):
        return False
    return "NotImplementedError" in src


def _wrap_sync_checkpointer_for_async(inner: Any) -> Any:
    """Bridge sync savers for ``graph.astream`` (``aget_*`` / ``aput_*``).

    Sqlite/PyMySQL are sync-only; conn uses ``check_same_thread=False`` / autocommit.
    """
    from langgraph.checkpoint.base import BaseCheckpointSaver

    if isinstance(inner, BaseCheckpointSaver) and not _checkpointer_async_is_stub(inner):
        return inner

    class _AsyncBridge(BaseCheckpointSaver):
        def __init__(self, wrapped: Any) -> None:
            super().__init__(serde=getattr(wrapped, "serde", None))
            self._inner = wrapped

        def __getattr__(self, name: str) -> Any:
            return getattr(self._inner, name)

        def get_tuple(self, config: Any) -> Any:
            return self._inner.get_tuple(config)

        def list(
            self,
            config: Any | None,
            *,
            filter: dict[str, Any] | None = None,
            before: Any | None = None,
            limit: int | None = None,
        ) -> Iterator[Any]:
            return self._inner.list(config, filter=filter, before=before, limit=limit)

        def put(
            self,
            config: Any,
            checkpoint: Any,
            metadata: Any,
            new_versions: Any,
        ) -> Any:
            return self._inner.put(config, checkpoint, metadata, new_versions)

        def put_writes(
            self,
            config: Any,
            writes: Sequence[tuple[str, Any]],
            task_id: str,
            task_path: str = "",
        ) -> Any:
            return self._inner.put_writes(config, writes, task_id, task_path)

        def delete_thread(self, thread_id: str) -> Any:
            return self._inner.delete_thread(thread_id)

        async def aget_tuple(self, config: Any) -> Any:
            return self._inner.get_tuple(config)

        async def alist(
            self,
            config: Any | None,
            *,
            filter: dict[str, Any] | None = None,
            before: Any | None = None,
            limit: int | None = None,
        ) -> AsyncIterator[Any]:
            for item in self._inner.list(
                config, filter=filter, before=before, limit=limit
            ):
                yield item

        async def aput(
            self,
            config: Any,
            checkpoint: Any,
            metadata: Any,
            new_versions: Any,
        ) -> Any:
            return self._inner.put(config, checkpoint, metadata, new_versions)

        async def aput_writes(
            self,
            config: Any,
            writes: Sequence[tuple[str, Any]],
            task_id: str,
            task_path: str = "",
        ) -> Any:
            return self._inner.put_writes(config, writes, task_id, task_path)

        async def adelete_thread(self, thread_id: str) -> Any:
            return self._inner.delete_thread(thread_id)

    return _AsyncBridge(inner)


def _build_mysql_checkpointer() -> Any | None:
    url = _checkpoint_mysql_url()
    if not url:
        return None
    import pymysql
    from langgraph.checkpoint.mysql.pymysql import PyMySQLSaver

    from app.services.db import _parse_mysql_url

    global _CHECKPOINTER_CONN
    # App parser unquotes password; PyMySQLSaver.parse_conn_string does not
    # (``!`` / ``&`` in DATABASE_URL → Access denied → false sqlite fallback).
    cfg = _parse_mysql_url(url)
    conn = pymysql.connect(
        host=cfg["host"],
        port=int(cfg["port"]),
        user=cfg["user"],
        password=cfg["password"],
        database=cfg["database"],
        charset=cfg.get("charset") or "utf8mb4",
        autocommit=True,
        connect_timeout=10,
    )
    try:
        with conn.cursor() as cur:
            cur.execute("SELECT VERSION()")
            row = cur.fetchone()
        ver = str(row[0] if row else "")
        if not _mysql_version_ok_for_langgraph(ver):
            _log.warning(
                "MySQL %s below langgraph-checkpoint-mysql requirement "
                "(MySQL >= 8.0.19 / MariaDB >= 10.7.1); using sqlite",
                ver,
            )
            conn.close()
            return None
        saver = PyMySQLSaver(conn, serde=_checkpoint_serde())
        saver.setup()
    except Exception:
        try:
            conn.close()
        except Exception:
            pass
        raise
    _CHECKPOINTER_CONN = conn
    return _wrap_sync_checkpointer_for_async(saver)


def _build_sqlite_checkpointer() -> Any:
    import sqlite3

    from langgraph.checkpoint.sqlite import SqliteSaver

    global _CHECKPOINTER_CONN
    path = str(_checkpoint_sqlite_path())
    conn = sqlite3.connect(path, check_same_thread=False, timeout=30.0)
    try:
        from app.services.db import configure_sqlite_connection

        configure_sqlite_connection(conn)
    except Exception:
        try:
            conn.execute("PRAGMA journal_mode = WAL")
            conn.execute("PRAGMA busy_timeout = 30000")
        except Exception:
            pass
    saver = SqliteSaver(conn, serde=_checkpoint_serde())
    saver.setup()
    _CHECKPOINTER_CONN = conn
    return _wrap_sync_checkpointer_for_async(saver)


def get_agent_checkpointer() -> Any:
    """Durable checkpointer: MySQL → Sqlite+async-bridge → memory."""
    global _CHECKPOINTER, _CHECKPOINTER_BACKEND
    if _CHECKPOINTER is not None:
        return _CHECKPOINTER
    with _CHECKPOINTER_LOCK:
        if _CHECKPOINTER is not None:
            return _CHECKPOINTER
        try:
            saver = _build_mysql_checkpointer()
            if saver is not None:
                _CHECKPOINTER = saver
                _CHECKPOINTER_BACKEND = "mysql"
                _log.info("LangGraph checkpointer: MySQL (langgraph-checkpoint-mysql)")
                return _CHECKPOINTER
        except Exception:
            _log.warning("MySQL checkpointer unavailable; falling back", exc_info=True)
        try:
            _CHECKPOINTER = _build_sqlite_checkpointer()
            _CHECKPOINTER_BACKEND = "sqlite"
            _log.info(
                "LangGraph checkpointer: Sqlite+async-bridge (%s)",
                _checkpoint_sqlite_path(),
            )
            return _CHECKPOINTER
        except Exception:
            _log.warning(
                "Sqlite checkpointer unavailable; using InMemorySaver",
                exc_info=True,
            )
        from langgraph.checkpoint.memory import InMemorySaver

        _CHECKPOINTER = InMemorySaver(serde=_checkpoint_serde())
        _CHECKPOINTER_BACKEND = "memory"
        return _CHECKPOINTER


def checkpointer_backend() -> str:
    """mysql | sqlite | memory — for logs / tests."""
    get_agent_checkpointer()
    return _CHECKPOINTER_BACKEND or "memory"


def _finalize_client_tool_interrupt(
    agent: Any,
    *,
    config: dict[str, Any] | None,
    tool_calls: list[dict[str, Any]],
    user_id: str | None = None,
) -> None:
    """After tools interrupt: run Store tools server-side; mark canvas as client_applies."""
    if not config or not tool_calls:
        return
    try:
        from langchain_core.messages import ToolMessage
        from app.services.agent_memory.long_term import (
            is_long_term_tool,
            run_long_term_tool_call,
        )

        tmsgs = []
        for tc in tool_calls:
            tid = str(tc.get("id") or "").strip()
            if not tid:
                continue
            name = str(tc.get("name") or "").strip()
            if is_long_term_tool(name):
                content = run_long_term_tool_call(
                    name=name,
                    arguments=tc.get("arguments") or "{}",
                    user_id=user_id or "",
                )
            else:
                content = '{"status":"client_applies"}'
            tmsgs.append(
                ToolMessage(
                    content=content,
                    tool_call_id=tid,
                    name=name or "tool",
                )
            )
        if not tmsgs:
            return
        agent.update_state(config, {"messages": tmsgs}, as_node="tools")
    except Exception:
        _log.debug("finalize client tool interrupt failed", exc_info=True)


def build_summarization_middleware(
    *,
    agent_model: str | None = None,
    summary_model: str | None = None,
    source: str = "agent",
    enabled: bool | None = None,
) -> list[Any]:
    """SummarizationMiddleware when history crosses trigger tokens; keep last N messages."""
    from app.core.config import settings

    on = settings.agent_summarize_enabled if enabled is None else bool(enabled)
    if not on:
        return []
    try:
        from langchain.agents.middleware import SummarizationMiddleware
    except Exception:
        _log.warning("SummarizationMiddleware unavailable", exc_info=True)
        return []

    mid = (
        (summary_model or "").strip()
        or (settings.agent_summarize_model or "").strip()
        or (settings.llm_default_model or "").strip()
        or (agent_model or "").strip()
        or None
    )
    endpoint = get_llm_endpoint(mid)
    model_id = _agent_model_id(mid, endpoint.model_id)
    summary_llm = build_chat_model(
        endpoint=endpoint,
        model_id_override=model_id,
        streaming=False,
        stream_usage=True,
        source=f"{source}_summarize",
        catalog_model_id=mid or model_id,
    )
    trigger_tokens = max(500, int(settings.agent_summarize_trigger_tokens or 4000))
    keep_n = max(2, int(settings.agent_summarize_keep_messages or 20))
    return [
        SummarizationMiddleware(
            model=summary_llm,
            trigger=("tokens", trigger_tokens),
            keep=("messages", keep_n),
        )
    ]


def build_official_agent(
    *,
    model: str | None = None,
    system: str | None = None,
    tools: list[Any] | None = None,
    source: str = "agent",
    response_format: Any | None = None,
    checkpointer: Any | None = None,
    store: Any | None = None,
    interrupt_before: list[str] | None = None,
    middleware: list[Any] | None = None,
    summarize: bool | None = None,
    with_long_term_store: bool = True,
):
    """Build create_agent graph (optional checkpointer, summarization, Store)."""
    from langchain.agents import create_agent
    from app.services.agent_memory.long_term import AgentMemoryContext, get_agent_store

    endpoint = get_llm_endpoint(model)
    model_id = _agent_model_id(model, endpoint.model_id)
    llm = build_chat_model(
        endpoint=endpoint,
        model_id_override=model_id,
        streaming=True,
        stream_usage=True,
        source=source,
        catalog_model_id=model or model_id,
    )
    tool_list = tools if tools is not None else server_langchain_tools()
    # Structured one-shots don't need session summarization / store tools.
    want_summary = False if response_format is not None else summarize
    mw = (
        list(middleware)
        if middleware is not None
        else build_summarization_middleware(
            agent_model=model or model_id,
            source=source,
            enabled=want_summary,
        )
    )
    kwargs: dict[str, Any] = {
        "system_prompt": _with_system_identity(system or "", model=model or model_id),
        "name": "recombyn_official_agent",
        "checkpointer": checkpointer
        if checkpointer is not None
        else get_agent_checkpointer(),
    }
    if with_long_term_store and response_format is None:
        kwargs["store"] = store if store is not None else get_agent_store()
        kwargs["context_schema"] = AgentMemoryContext
    if mw:
        kwargs["middleware"] = mw
    if interrupt_before:
        kwargs["interrupt_before"] = list(interrupt_before)
    if response_format is not None:
        kwargs["response_format"] = response_format
        kwargs["name"] = "recombyn_structured_agent"
    return create_agent(llm, tool_list, **kwargs)


async def ainvoke_structured(
    *,
    schema: type[Any],
    messages: list[dict[str, Any]],
    model: str | None = None,
    system: str | None = None,
    source: str = "design",
    run_name: str | None = None,
    metadata: dict[str, Any] | None = None,
    tags: list[str] | None = None,
    timeout: float | None = None,
    stream_chunk_timeout: float | None = None,
) -> dict[str, Any]:
    """Structured output via ``with_structured_output``, then create_agent fallback.

    ``timeout`` / ``stream_chunk_timeout`` bound request + inter-chunk stall so a
    half-open stream cannot burn the full graph node budget (default chunk 120s).
    """
    endpoint = get_llm_endpoint(model)
    model_id = _agent_model_id(model, endpoint.model_id)
    sys_text = _with_system_identity(system or "", model=model or model_id)
    lc_messages = to_lc_messages(
        _prepare_agent_messages(messages, system=sys_text, model=model)
    )
    cfg = merge_tracing_config(
        None,
        run_name=run_name or f"structured:{source}",
        metadata=metadata,
        tags=tags or [source, "structured"],
    )
    req_timeout = float(timeout) if timeout is not None and float(timeout) > 0 else 180.0
    chunk_timeout = (
        float(stream_chunk_timeout)
        if stream_chunk_timeout is not None and float(stream_chunk_timeout) > 0
        else None
    )

    # with_structured_output first — create_agent burns multiple round-trips
    # for a simple schema fill (intent_classify hit 6×~4s).
    # function_calling before json_schema: Doubao often 400s on json_schema.
    llm = build_chat_model(
        endpoint=endpoint,
        model_id_override=model_id,
        streaming=False,
        stream_usage=True,
        timeout=req_timeout,
        stream_chunk_timeout=chunk_timeout,
        source=source,
        catalog_model_id=model or model_id,
    )
    for method in ("function_calling", "json_schema"):
        try:
            structured_llm = llm.with_structured_output(schema, method=method)
            got = await structured_llm.ainvoke(lc_messages, config=cfg)
            # Doubao function_calling often returns None without raising — do not
            # treat that as success or intent_classify falls back to heuristic.
            if got is None:
                _log.warning(
                    "with_structured_output(method=%s) returned None; trying next",
                    method,
                )
                continue
            return {"structured": got, "text": "", "messages": lc_messages}
        except Exception as direct_err:
            _log.debug(
                "with_structured_output(method=%s) failed (%s); trying next",
                method,
                type(direct_err).__name__,
            )

    # Fallback: create_agent + response_format.
    import uuid

    from langgraph.checkpoint.memory import InMemorySaver

    agent = build_official_agent(
        model=model,
        system=sys_text,
        tools=[],
        source=source,
        response_format=schema,
        checkpointer=InMemorySaver(),
        summarize=False,
        with_long_term_store=False,
    )
    # InMemorySaver still requires configurable.thread_id.
    agent_cfg = merge_tracing_config(
        agent_thread_config(f"structured:{uuid.uuid4().hex[:16]}"),
        run_name=run_name or f"structured:{source}",
        metadata=metadata,
        tags=tags or [source, "structured"],
    )
    result = await agent.ainvoke({"messages": lc_messages}, config=agent_cfg)
    structured = None
    out_msgs: list[Any] = []
    if isinstance(result, dict):
        structured = result.get("structured_response")
        out_msgs = result.get("messages") or []
    text = ""
    if out_msgs:
        last = out_msgs[-1]
        text = content_text_from_chunk(last) or (
            str(last.content)
            if isinstance(getattr(last, "content", None), str)
            else ""
        )
    if structured is None:
        raise RuntimeError("create_agent returned no structured_response")
    return {"structured": structured, "text": text, "messages": out_msgs}



def _prepare_agent_messages(
    messages: list[dict[str, Any]],
    *,
    system: str | None = None,
    model: str | None = None,
    for_thread: bool = False,
) -> list[dict[str, Any]]:
    """Normalize messages. With ``for_thread``, skip system (lives on create_agent)."""
    normalized = _normalize_messages(messages)
    if for_thread:
        return [m for m in normalized if m.get("role") != "system"]
    has_system = any(m.get("role") == "system" for m in normalized)
    base_system = _with_system_identity(system or "", model=model)
    if not has_system:
        return [{"role": "system", "content": base_system}, *normalized]
    final: list[dict[str, Any]] = []
    for m in normalized:
        if m.get("role") == "system":
            existing = str(m.get("content") or "").strip()
            if "IDENTITY:" in existing:
                final.append({"role": "system", "content": existing or base_system})
            elif existing and base_system not in existing:
                # Prefix Admin IDENTITY from base_system.
                final.append(
                    {"role": "system", "content": f"{base_system}\n\n{existing}"}
                )
            else:
                final.append(
                    {"role": "system", "content": existing or base_system}
                )
        else:
            final.append(m)
    return final


async def stream_official_agent(
    *,
    messages: list[dict[str, Any]],
    model: str | None = None,
    system: str | None = None,
    tools: list[Any] | None = None,
    thread_id: str | None = None,
    user_id: str | None = None,
    interrupt_before_tools: bool = False,
    source: str = "agent",
    run_name: str | None = None,
    metadata: dict[str, Any] | None = None,
    tags: list[str] | None = None,
) -> AsyncIterator[tuple[str, Any]]:
    """Stream create_agent.

    ``thread_id`` → checkpointer; ``user_id`` → Store context;
    ``interrupt_before_tools`` defers canvas tools to FE.
    """
    from app.services.agent_memory.long_term import AgentMemoryContext

    meta = dict(metadata or {})
    if user_id and not meta.get("user_id"):
        meta["user_id"] = user_id
    if thread_id and not meta.get("langfuse_session_id"):
        meta.setdefault("task_id", thread_id)
    config = merge_tracing_config(
        agent_thread_config(thread_id),
        run_name=run_name or f"official_agent:{source}",
        metadata=meta,
        tags=tags or [source, "create_agent"],
    )
    interrupt_before = ["tools"] if interrupt_before_tools else None
    agent = build_official_agent(
        model=model,
        system=system,
        tools=tools,
        source=source,
        interrupt_before=interrupt_before,
    )
    lc_messages = to_lc_messages(
        _prepare_agent_messages(
            messages,
            system=system,
            model=model,
            for_thread=bool(config.get("configurable")),
        )
    )
    content_acc = ""
    last_ai: Any = None
    emitted_tool_ids: set[str] = set()
    collected_tool_calls: list[dict[str, Any]] = []
    ctx = AgentMemoryContext(user_id=str(user_id or "").strip())
    run_kwargs: dict[str, Any] = {"context": ctx, "stream_mode": "messages"}

    try:
        astream = agent.astream({"messages": lc_messages}, config, **run_kwargs)
        async for item in astream:
            msg = item[0] if isinstance(item, tuple) and item else item
            if msg is None:
                continue
            mtype = getattr(msg, "type", None) or ""
            cls_name = type(msg).__name__

            if mtype in ("AIMessageChunk",) or cls_name == "AIMessageChunk":
                thought = thinking_text_from_chunk(msg)
                if thought:
                    yield ("thinking", thought)
                text = content_text_from_chunk(msg)
                if text:
                    content_acc += text
                    yield ("token", text)
                continue

            if mtype == "ai" or cls_name == "AIMessage":
                last_ai = msg
                text = content_text_from_chunk(msg) or (
                    str(msg.content)
                    if isinstance(getattr(msg, "content", None), str)
                    else ""
                )
                if text and not content_acc:
                    content_acc = text
                    yield ("token", text)
                for tc in _tool_calls_from_message(msg):
                    tid = str(tc.get("id") or "")
                    if tid and tid in emitted_tool_ids:
                        continue
                    if tid:
                        emitted_tool_ids.add(tid)
                    piece = {
                        "id": tc.get("id"),
                        "name": (tc.get("function") or {}).get("name"),
                        "arguments": (tc.get("function") or {}).get("arguments")
                        or "{}",
                    }
                    collected_tool_calls.append(piece)
                    yield ("tool_call", piece)
                continue

            if mtype == "tool" or cls_name == "ToolMessage":
                yield (
                    "tool_result",
                    {
                        "tool_call_id": getattr(msg, "tool_call_id", None),
                        "name": getattr(msg, "name", None),
                        "content": getattr(msg, "content", None),
                    },
                )

        if interrupt_before_tools and collected_tool_calls:
            _finalize_client_tool_interrupt(
                agent,
                config=config,
                tool_calls=collected_tool_calls,
                user_id=ctx.user_id,
            )

        assistant: dict[str, Any] = {
            "role": "assistant",
            "content": content_acc or None,
        }
        if last_ai is not None:
            tcs = _tool_calls_from_message(last_ai)
            if tcs:
                assistant["tool_calls"] = tcs
        yield ("message", assistant)
    except Exception as err:
        detail = llm_error_detail(err)
        if "InvalidEndpointOrModel" in detail or "404" in detail:
            raise RuntimeError(
                "Ark model/endpoint not found. Use the catalog's dated api_model "
                "(e.g. deepseek-v4-flash-260425), or activate the model in Volcengine Ark. "
                f"Detail: {detail}"
            ) from err
        raise


async def ainvoke_official_agent(
    *,
    messages: list[dict[str, Any]],
    model: str | None = None,
    system: str | None = None,
    tools: list[Any] | None = None,
    source: str = "agent",
    thread_id: str | None = None,
    user_id: str | None = None,
) -> dict[str, Any]:
    """Blocking create_agent run — final text + messages."""
    from app.services.agent_memory.long_term import AgentMemoryContext

    config = agent_thread_config(thread_id)
    agent = build_official_agent(
        model=model, system=system, tools=tools, source=source
    )
    lc_messages = to_lc_messages(
        _prepare_agent_messages(
            messages,
            system=system,
            model=model,
            for_thread=bool(config),
        )
    )
    ctx = AgentMemoryContext(user_id=str(user_id or "").strip())
    invoke_kwargs: dict[str, Any] = {"context": ctx}
    result = (
        await agent.ainvoke({"messages": lc_messages}, config, **invoke_kwargs)
        if config
        else await agent.ainvoke({"messages": lc_messages}, **invoke_kwargs)
    )
    out_msgs = result.get("messages") if isinstance(result, dict) else None
    final_text = ""
    if isinstance(out_msgs, list) and out_msgs:
        last = out_msgs[-1]
        final_text = content_text_from_chunk(last) or (
            str(last.content)
            if isinstance(getattr(last, "content", None), str)
            else ""
        )
    return {"text": final_text, "messages": out_msgs or []}


async def stream_agent_turn(
    *,
    messages: list[dict[str, Any]],
    model: str | None = None,
    tools: list[Any] | None = None,
    system: str | None = None,
    execute_server_tools: bool = True,
    source: str = "agent",
) -> AsyncIterator[tuple[str, Any]]:
    """One LLM turn with ``bind_tools``.

    Canvas → ``tool_call``; server tools → ``tool_result`` when enabled.
    Text streams before tool_calls.
    """
    endpoint = get_llm_endpoint(model)
    model_id = _agent_model_id(model, endpoint.model_id)
    final_messages = _prepare_agent_messages(messages, system=system, model=model)

    tool_defs = tools if tools is not None else design_langchain_tools()
    base = build_chat_model(
        endpoint=endpoint,
        model_id_override=model_id,
        streaming=True,
        stream_usage=True,
        source=source,
        catalog_model_id=model or model_id,
        with_usage_callback=False,
    )
    from app.services.llm import usage_callback_handler

    handler = usage_callback_handler(
        source=source,
        provider=endpoint.provider,
        catalog_model_id=model or model_id,
        api_model=model_id,
    )
    llm = base.bind_tools(tool_defs, tool_choice="auto").with_config(callbacks=[handler])

    lc_messages = to_lc_messages(final_messages)
    content_acc = ""
    merged: Any = None

    try:
        async for chunk in llm.astream(lc_messages):
            merged = chunk if merged is None else merged + chunk

            thought = thinking_text_from_chunk(chunk)
            if thought:
                yield ("thinking", thought)

            text = content_text_from_chunk(chunk)
            if text:
                content_acc += text
                yield ("token", text)

        tool_calls_out = _tool_calls_from_message(merged) if merged is not None else []
        for tc in tool_calls_out:
            fn = tc.get("function") or {}
            yield (
                "tool_call",
                {
                    "id": tc.get("id"),
                    "name": fn.get("name"),
                    "arguments": fn.get("arguments") or "{}",
                },
            )

        assistant: dict[str, Any] = {
            "role": "assistant",
            "content": content_acc or None,
        }
        if tool_calls_out:
            assistant["tool_calls"] = tool_calls_out
        yield ("message", assistant)

        if (
            execute_server_tools
            and merged is not None
            and any(
                (tc.get("function") or {}).get("name") in _SERVER_TOOL_NAMES
                for tc in tool_calls_out
            )
        ):
            from langchain_core.messages import AIMessage
            from langgraph.prebuilt import ToolNode

            raw_calls = getattr(merged, "tool_calls", None) or []
            server_lc_calls = [
                tc
                for tc in raw_calls
                if (
                    (tc.get("name") if isinstance(tc, dict) else getattr(tc, "name", None))
                    in _SERVER_TOOL_NAMES
                )
            ]
            server_tools = [
                t
                for t in tool_defs
                if getattr(t, "name", None) in _SERVER_TOOL_NAMES
            ]
            if server_lc_calls and server_tools:
                filtered = AIMessage(
                    content=getattr(merged, "content", "") or "",
                    tool_calls=server_lc_calls,
                )
                state = await ToolNode(server_tools).ainvoke({"messages": [filtered]})
                out_msgs = state.get("messages") if isinstance(state, dict) else None
                if isinstance(out_msgs, list):
                    for m in out_msgs:
                        if getattr(m, "type", None) != "tool":
                            continue
                        yield (
                            "tool_result",
                            {
                                "tool_call_id": getattr(m, "tool_call_id", None),
                                "name": getattr(m, "name", None),
                                "content": getattr(m, "content", None),
                            },
                        )
    except Exception as err:
        detail = llm_error_detail(err)
        if "InvalidEndpointOrModel" in detail or "404" in detail:
            raise RuntimeError(
                "Ark model/endpoint not found. Use the catalog's dated api_model "
                "(e.g. deepseek-v4-flash-260425), or activate the model in Volcengine Ark. "
                f"Detail: {detail}"
            ) from err
        raise
