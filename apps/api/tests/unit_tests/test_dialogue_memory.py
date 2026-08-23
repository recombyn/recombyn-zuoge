"""Optimal dialogue memory: facts + rolling summary + recent window."""

from __future__ import annotations

from app.services.agent_memory.compose import compose_memory_blocks
from app.services.agent_memory.short_term import (
    assistant_facing_text,
    extract_facts_from_text,
    facts_to_summary,
    prepare_dialogue_layers,
    update_dialogue_after_run,
)


def test_assistant_unwraps_json_reply():
    raw = '{"thought":"打招呼","intent":"chat","reply":"你好，我是助手","tool_ops":[],"done":true}'
    assert assistant_facing_text(raw) == "你好，我是助手"


def test_extract_goal_and_constraint_facts():
    facts = extract_facts_from_text(
        role="user",
        text="帮我做一张登录页，主色 #3366FF，不要卡片风，尺寸 375x812",
    )
    kinds = {f["kind"] for f in facts}
    assert "color" in kinds
    assert "size" in kinds
    assert "constraint" in kinds or "goal" in kinds


def test_prepare_layers_keeps_recent_folds_older():
    short = [
        {"role": "user", "text": "帮我做海报，主色#112233"},
        {"role": "assistant", "text": "已按主色#112233起稿"},
        {"role": "user", "text": "标题再大一点"},
        {"role": "assistant", "text": "已加大标题"},
        {"role": "user", "text": "再加点留白"},
        {"role": "assistant", "text": "已增加留白"},
        {"role": "user", "text": "当前这句"},  # deduped as current_prompt
    ]
    rules = {
        "memory.dialogue.recent_turns": "2",
        "memory.dialogue.recent_chars": "800",
        "memory.dialogue.summary_chars": "400",
        "memory.dialogue.facts_max": "12",
        "memory.dialogue.per_turn_chars": "200",
    }
    recent, dialogue, cleaned = prepare_dialogue_layers(
        short=short,
        medium={},
        rules=rules,
        current_prompt="当前这句",
    )
    assert all(t["text"] != "当前这句" for t in cleaned)
    assert len(recent) <= 2
    assert dialogue.get("summary") or dialogue.get("facts")
    assert "112233" in (dialogue.get("summary") or "") or any(
        "112233" in str(f.get("text")) for f in (dialogue.get("facts") or [])
    )


def test_compose_shows_summary_not_recent_by_default():
    medium = {
        "dialogue": {
            "summary": "目标：登录页；色：#3366FF；约束：不要卡片",
            "facts": [
                {"kind": "goal", "text": "登录页"},
                {"kind": "color", "text": "#3366FF"},
            ],
        }
    }
    blocks = compose_memory_blocks(
        medium=medium,
        short=[{"role": "user", "text": "标题大一点"}],
        long_hits=[],
        rules={},
        dialogue=medium["dialogue"],
    )
    assert "[Dialogue summary]" in blocks
    assert "[Recent dialogue]" not in blocks
    # Design agent load() opts in; compose default stays off for other callers.
    blocks2 = compose_memory_blocks(
        medium=medium,
        short=[{"role": "user", "text": "标题大一点"}],
        long_hits=[],
        rules={},
        dialogue=medium["dialogue"],
        include_recent_dialogue=True,
    )
    assert "[Recent dialogue]" in blocks2
    assert "标题大一点" in blocks2

def test_update_dialogue_persists_facts():
    state = update_dialogue_after_run(
        None,
        user_prompt="做一张电商海报，不要大红",
        assistant_reply="好的，我按电商海报来，避开大红。",
        intent="create",
        tool_ops_applied=True,
        short_turns=[],
        rules={"memory.dialogue.facts_max": "12", "memory.dialogue.summary_chars": "300"},
    )
    assert state["facts"]
    assert state["summary"]
    assert facts_to_summary(state["facts"], max_chars=300)
