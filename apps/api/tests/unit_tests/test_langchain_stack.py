"""LangChain official APIs smoke coverage (no custom wrapper factories)."""

from __future__ import annotations

from langchain_core.prompts import ChatPromptTemplate
from unittest.mock import patch

from app.services.design.prompts.rules_text import render_prompt_template
from app.services.design.ops.validate import extract_json
from app.services.agent_memory.short_term import split_recent_and_older, trim_turns_by_chars


def test_prompt_template_official():
    assert render_prompt_template("A {x} B", x="1") == "A 1 B"
    assert "{" in render_prompt_template('say {"a":1} and {name}', name="n")
    # Zero-variable bodies still go through LangChain PromptTemplate.
    assert '{"a":1}' in render_prompt_template('keep {"a":1} literal')
    msgs = ChatPromptTemplate.from_messages(
        [("system", "{system}"), ("human", "{user}")]
    ).format_messages(system="sys Z", user="hi Z")
    assert len(msgs) == 2
    assert "Z" in str(msgs[0].content)


def test_render_prompt_body_admin_then_langchain():
    """All packs: Admin/seed body → LangChain fill (not Hub)."""
    from app.services.design.prompts.prompt_pack_store import render_prompt_body

    paint = render_prompt_body("agent.prompt.paint_system")
    assert "PAINT" in paint.upper() or "tool_ops" in paint
    assert "{ask_rule}" not in paint
    # Static pack (no placeholders) still renders via LC.
    intent = render_prompt_body("agent.prompt.intent_classify")
    assert "canvas_op" in intent or "Intent" in intent or "intent" in intent.lower()


def test_structured_json_langchain_then_rescue():
    assert extract_json('{"a": 1}') == {"a": 1}
    assert extract_json("```json\n{\"a\": 1}\n```") == {"a": 1}
    assert extract_json("[1, 2]") == [1, 2]


def test_trim_turns_preserves_window():
    turns = [
        {"role": "user", "text": "u1"},
        {"role": "assistant", "text": "a1"},
        {"role": "user", "text": "u2"},
    ]
    recent, older = split_recent_and_older(turns, recent_turns=2, recent_chars=500)
    assert len(recent) == 2
    assert len(older) == 1
    trimmed = trim_turns_by_chars(turns, max_chars=500)
    assert len(trimmed) == 3


def test_splitter_embeddings_and_format_document():
    from langchain_core.documents import Document
    from langchain_core.embeddings import Embeddings
    from langchain_core.messages import BaseMessage, HumanMessage
    from app.services.agent_memory.text_embed import (
        ClipTextEmbeddings,
        format_rag_block,
        get_text_embeddings,
        hits_to_documents,
        split_text_chunks,
    )
    from app.services.llm import to_lc_messages

    chunks = split_text_chunks("word " * 80, chunk_size=40, chunk_overlap=5)
    assert len(chunks) >= 2
    emb = get_text_embeddings()
    assert isinstance(emb, Embeddings)
    assert isinstance(emb, ClipTextEmbeddings)
    docs = hits_to_documents([{"text": "kb hit", "score": 0.91}])
    assert isinstance(docs[0], Document)
    block = format_rag_block(docs)
    assert "kb hit" in block
    msgs = to_lc_messages([{"role": "user", "content": "hi"}])
    assert isinstance(msgs[0], BaseMessage)
    assert isinstance(msgs[0], HumanMessage)



def test_tool_node_and_official_agent_factory():
    from langchain.agents import create_agent
    from langchain.agents.middleware import SummarizationMiddleware
    from langgraph.graph.state import CompiledStateGraph
    from langgraph.prebuilt import ToolNode
    from app.services.llm import LlmEndpoint
    from app.services.llm.design_tools import design_langchain_tools
    from app.services.llm.agent import (
        agent_thread_config,
        build_official_agent,
        build_summarization_middleware,
        checkpointer_backend,
        get_agent_checkpointer,
        server_langchain_tools,
    )

    tools = design_langchain_tools()
    assert len(tools) >= 10
    names = {t.name for t in tools}
    assert "finish" in names
    assert isinstance(ToolNode(tools), ToolNode)
    server = server_langchain_tools()
    assert any(getattr(t, "name", None) == "generate_image" for t in server)
    cp = get_agent_checkpointer()
    assert cp is not None
    assert checkpointer_backend() in ("mysql", "memory")
    assert agent_thread_config("sess-1") == {
        "configurable": {"thread_id": "sess-1"}
    }
    assert agent_thread_config("") is None
    assert build_summarization_middleware(enabled=False) == []
    ep = LlmEndpoint(
        base_url="https://example.invalid/v1",
        api_key="sk-test",
        model_id="deepseek-chat",
        provider="deepseek",
    )
    with patch("app.services.llm.agent.get_llm_endpoint", return_value=ep):
        mw = build_summarization_middleware(agent_model="deepseek-chat", enabled=True)
        assert len(mw) == 1
        assert isinstance(mw[0], SummarizationMiddleware)
        agent = build_official_agent(
            model="deepseek-chat",
            tools=server,
            checkpointer=cp,
            middleware=mw,
            summarize=True,
        )
    assert isinstance(agent, CompiledStateGraph)
    assert "model" in agent.nodes and "tools" in agent.nodes
    assert create_agent is not None


def test_build_official_agent_accepts_response_format():
    from pydantic import BaseModel
    from langgraph.checkpoint.memory import InMemorySaver
    from app.services.llm import LlmEndpoint
    from app.services.llm.agent import build_official_agent

    class Cap(BaseModel):
        name: str

    ep = LlmEndpoint(
        base_url="https://example.invalid/v1",
        api_key="sk-test",
        model_id="deepseek-chat",
        provider="deepseek",
    )
    with patch("app.services.llm.agent.get_llm_endpoint", return_value=ep):
        agent = build_official_agent(
            model="deepseek-chat",
            tools=[],
            response_format=Cap,
            system="你是科幻作家",
            checkpointer=InMemorySaver(),
            summarize=False,
        )
    assert agent is not None
    assert "model" in agent.nodes


def test_checkpointer_setup_and_thread_config(monkeypatch):
    import asyncio

    from langgraph.checkpoint.base import BaseCheckpointSaver
    from app.services.llm import agent as agent_mod

    # Reset singleton so this test observes the live mysql|memory backend.
    agent_mod._CHECKPOINTER = None
    agent_mod._CHECKPOINTER_BACKEND = ""
    agent_mod._CHECKPOINTER_CONN = None
    cp = agent_mod.get_agent_checkpointer()
    assert agent_mod.checkpointer_backend() in ("mysql", "memory")
    assert cp is not None
    assert isinstance(cp, BaseCheckpointSaver)
    cfg = agent_mod.agent_thread_config("unit-thread")
    assert cfg and cfg["configurable"]["thread_id"] == "unit-thread"
    assert asyncio.run(cp.aget_tuple(cfg)) is None


def test_mysql_version_ok_for_langgraph():
    from app.services.llm.agent import _mysql_version_ok_for_langgraph

    assert _mysql_version_ok_for_langgraph("8.0.19")
    assert _mysql_version_ok_for_langgraph("8.4.0")
    assert not _mysql_version_ok_for_langgraph("5.7.18-cynos-2.1.14-log")
    assert _mysql_version_ok_for_langgraph("10.7.1-MariaDB")
    assert not _mysql_version_ok_for_langgraph("10.6.0-MariaDB")


def test_summarization_middleware_matches_docs(monkeypatch):
    """Docs: SummarizationMiddleware(trigger=('tokens', 4000), keep=('messages', 20))."""
    from langchain.agents.middleware import SummarizationMiddleware
    from app.core.config import settings as settings_mod
    from app.services.llm import LlmEndpoint
    from app.services.llm.agent import build_summarization_middleware

    monkeypatch.setattr(settings_mod, "agent_summarize_enabled", True)
    monkeypatch.setattr(settings_mod, "agent_summarize_trigger_tokens", 4000)
    monkeypatch.setattr(settings_mod, "agent_summarize_keep_messages", 20)
    ep = LlmEndpoint(
        base_url="https://example.invalid/v1",
        api_key="sk-test",
        model_id="deepseek-chat",
        provider="deepseek",
    )
    with patch("app.services.llm.agent.get_llm_endpoint", return_value=ep):
        mw = build_summarization_middleware(agent_model="deepseek-chat")
    assert len(mw) == 1
    assert isinstance(mw[0], SummarizationMiddleware)
    assert mw[0].trigger == ("tokens", 4000)
    assert mw[0].keep == ("messages", 20)


def test_langgraph_store_long_term_put_search(monkeypatch):
    """Docs long-term memory: Store put/search under (user_id, namespace)."""
    from app.services.agent_memory import long_term as lt

    lt._STORE = None
    lt._STORE_BACKEND = ""
    lt._STORE_CONN = None

    store = lt.get_agent_store()
    assert store is not None
    assert lt.store_backend() in ("mysql", "memory")
    mid = lt.put_long_term_store(
        "user_test",
        key="pref_1",
        kind="preference",
        text="User likes short blue posters",
    )
    assert mid == "pref_1"
    hits = lt.search_long_term_store(
        "user_test", query="blue posters", limit=3
    )
    assert hits
    assert any("blue" in str(h.get("text") or "") for h in hits)
    tools = lt.long_term_store_tools()
    names = {getattr(t, "name", "") for t in tools}
    assert "recall_long_term_memory" in names
    assert "remember_long_term_memory" in names
    out = lt.run_long_term_tool_call(
        name="recall_long_term_memory",
        arguments={"query": "blue"},
        user_id="user_test",
    )
    assert "blue" in out.lower() or "Long-term" in out
