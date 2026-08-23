"""P24 — Preference Learning: evidence + frequency + confidence. One edit is not memory."""
from __future__ import annotations

from app.services.agent_memory.compose import format_design_memory_block
from app.services.agent_memory.schema import (
    build_design_memory_patch,
    empty_design_memory,
    empty_task_state,
    user_design_from_long_hits,
)
from app.services.design.runtime.graph.state import (
    accumulate_preference_candidate,
    analyze_edit_preference,
    apply_committed_preferences_to_brief,
    preference_should_commit,
)


def test_title_too_big_is_evidence_not_commit():
    signal = analyze_edit_preference("这个标题太大。")
    assert signal is not None
    assert signal["signal"] == "typography_scale"
    assert signal["direction"] == "decrease"
    assert signal["target"] == "headline"
    user, commits = accumulate_preference_candidate(empty_design_memory()["user"], signal)
    cand = next(iter(user["preference"].values()))
    assert cand["frequency"] == 1
    assert cand["evidence"] == 1
    assert cand["committed"] is False
    assert preference_should_commit(cand) is False
    assert commits == []
    brief = apply_committed_preferences_to_brief(
        {"purpose": "poster", "avoid": []},
        user,
    )
    assert "headline_scale" not in (brief.get("typography") or {})


def test_five_same_direction_commits_into_brief_range():
    user = empty_design_memory()["user"]
    commits: list = []
    for _ in range(5):
        signal = analyze_edit_preference("这个标题太大。")
        user, commits = accumulate_preference_candidate(user, signal)
    cand = next(iter(user["preference"].values()))
    assert cand["frequency"] == 5
    assert cand["committed"] is True
    assert cand["preferred_range"] == {"min": 0.75, "max": 0.9}
    assert commits and commits[0]["committed"] is True
    assert "headline typography_scale decrease" in user["accepted_patterns"][0]
    brief = apply_committed_preferences_to_brief(
        {"purpose": "poster", "visual_thesis": "museum relic"},
        user,
    )
    assert brief["typography"]["headline_scale"] == {"min": 0.75, "max": 0.9}


def test_opposite_direction_resets_streak():
    user = empty_design_memory()["user"]
    for _ in range(3):
        user, _ = accumulate_preference_candidate(
            user, analyze_edit_preference("这个标题太大。")
        )
    user, commits = accumulate_preference_candidate(
        user, analyze_edit_preference("标题太小了，再大一点")
    )
    assert commits == []
    decrease = user["preference"].get("typography_scale:decrease:headline") or {}
    increase = user["preference"].get("typography_scale:increase:headline") or {}
    assert int(decrease.get("frequency") or 0) <= 2
    assert increase.get("frequency") == 1
    assert increase.get("committed") is False


def test_reject_glass_five_times_enters_rejected_and_brief_avoid():
    user = empty_design_memory()["user"]
    for _ in range(5):
        user, commits = accumulate_preference_candidate(
            user, analyze_edit_preference("不要玻璃拟态")
        )
    assert "glassmorphism" in user["rejected_patterns"]
    assert commits
    brief = apply_committed_preferences_to_brief({"avoid": ["HUD"]}, user)
    assert "glassmorphism" in brief["avoid"]
    assert "HUD" in brief["avoid"]


def test_unrelated_prompt_is_not_a_preference():
    assert analyze_edit_preference("帮我做一张海报") is None
    user, commits = accumulate_preference_candidate(
        empty_design_memory()["user"], None
    )
    assert user["preference"] == {}
    assert commits == []


def test_compose_hides_uncommitted_and_lists_committed_range():
    pending = empty_design_memory()
    pending["user"], _ = accumulate_preference_candidate(
        pending["user"], analyze_edit_preference("这个标题太大。")
    )
    pending["session"]["iteration"] = 1
    block = format_design_memory_block(pending)
    assert "learning=1" in block
    assert "committed=0" in block
    assert "0.75" not in block
    committed = empty_design_memory()
    user = committed["user"]
    for _ in range(5):
        user, _ = accumulate_preference_candidate(
            user, analyze_edit_preference("这个标题太大。")
        )
    committed["user"] = user
    committed["session"]["iteration"] = 2
    done = format_design_memory_block(committed)
    assert "committed=1" in done
    assert "0.75-0.9" in done


def test_build_patch_keeps_uncommitted_user_layer():
    medium = empty_task_state()
    user, _ = accumulate_preference_candidate(
        medium["design"]["user"], analyze_edit_preference("这个标题太大。")
    )
    patch = build_design_memory_patch(medium=medium, user_layer=user, painted=False)
    cand = next(iter(patch["user"]["preference"].values()))
    assert cand["committed"] is False
    assert patch["session"]["iteration"] == 0


def test_long_hit_json_hydrates_committed_candidate():
    hit = {
        "kind": "preference",
        "text": (
            '{"signal":"typography_scale","direction":"decrease",'
            '"target":"headline","preferred_range":{"min":0.75,"max":0.9},'
            '"committed":true}'
        ),
    }
    user = user_design_from_long_hits([hit])
    cand = user["preference"]["typography_scale:decrease:headline"]
    assert cand["committed"] is True
    assert cand["preferred_range"]["min"] == 0.75
