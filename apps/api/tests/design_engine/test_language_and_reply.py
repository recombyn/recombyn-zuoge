"""Language context + design assistant reply productization."""
from __future__ import annotations

from app.services.design.runtime.graph.emit_sse import (
    _design_assistant_reply,
    _paint_user_reply,
)
from app.services.design.runtime.host.prompts import (
    detect_locale_from_text,
    language_directive,
    normalize_locale,
    resolve_output_locale,
)


def test_normalize_locale_aliases():
    assert normalize_locale("zh") == "zh-CN"
    assert normalize_locale("zh-Hans") == "zh-CN"
    assert normalize_locale("zh_TW") == "zh-TW"
    assert normalize_locale("en-US") == "en"
    assert normalize_locale("ja-JP") == "ja"


def test_resolve_output_locale_prefers_llm_then_prompt():
    assert (
        resolve_output_locale(llm_locale="en", prompt="添加一个矩形") == "en"
    )
    assert resolve_output_locale(prompt="添加一个矩形在画布") == "zh-CN"
    assert resolve_output_locale(prompt="hello world", profile_locale="ja") == "ja"
    # UI locale must not override user message language
    assert (
        resolve_output_locale(client_locale="en", prompt="添加一个矩形") == "zh-CN"
    )


def test_detect_locale_from_text():
    assert detect_locale_from_text("你好") == "zh-CN"
    assert detect_locale_from_text("hello") is None


def test_language_directive_mentions_locale():
    text = language_directive("zh-CN")
    assert "output_language: zh-CN" in text
    assert "same language they use in their message" in text


def test_paint_user_reply_strips_tool_dumps_keeps_prose():
    assert _paint_user_reply("好的，已添加矩形") == "好的，已添加矩形"
    assert _paint_user_reply("emit tool_ops now") == ""
    long = "x" * 400
    assert len(_paint_user_reply(long, limit=280)) == 280


def test_design_assistant_reply_zh_fallback_with_ops():
    text = _design_assistant_reply(
        raw_reply="",
        ops=[{"name": "create_shape", "args": {"shapeType": "rect", "fill": "#E0E0E0"}}],
        locale="zh-CN",
    )
    assert "已完成" in text or "好的" in text
    assert "下一步" in text
    assert "rect" in text.lower() or "+rect" in text.lower()


def test_design_assistant_reply_keeps_model_prose():
    text = _design_assistant_reply(
        raw_reply="好的，我已经在中心放了一个圆角矩形。",
        ops=[],
        locale="zh-CN",
    )
    assert "圆角矩形" in text


def test_design_intensity_maps_review_mode():
    from app.services.design.runtime.graph.build import (
        _normalize_design_intensity,
        _review_mode_for_intensity,
    )

    assert _normalize_design_intensity("light") == "light"
    assert _normalize_design_intensity("extreme") == "extreme"
    assert _normalize_design_intensity("unknown") == "medium"
    assert _review_mode_for_intensity("light") == "off"
    assert _review_mode_for_intensity("medium") == "auto"
    assert _review_mode_for_intensity("high") == "always"
    assert _review_mode_for_intensity("extreme") == "always"


def test_intent_decision_carries_output_locale():
    from app.services.design.runtime.models_route import IntentClassifyDecision

    d = IntentClassifyDecision(
        intent="canvas_op",
        paint_lane="create",
        output_locale="zh-CN",
        rationale="test",
    )
    assert d.output_locale == "zh-CN"


def test_localize_ux_tip_uses_runtime_locale_not_ui():
    from app.services.i18n.errors import localize_ux_tip

    zh = localize_ux_tip("observe_scene_timeout", "zh-CN")
    en = localize_ux_tip("observe_scene_timeout", "en")
    assert "超时" in zh or "回传" in zh
    assert "timed out" in en.lower()
    # Chinese prompt locale must win over English UI setting
    from app.services.design.runtime.host.prompts import resolve_output_locale

    assert resolve_output_locale(client_locale="en", prompt="添加矩形") == "zh-CN"


def test_brief_step_labels_follow_locale():
    from app.services.design.runtime.graph.nodes.decide import (
        _brief_avoid_step,
        _brief_hero_step,
    )

    assert _brief_avoid_step("glassmorphism", "zh-CN").startswith("避免")
    assert _brief_hero_step("sword", "zh-CN").startswith("突出主体")
    assert _brief_avoid_step("glassmorphism", "en").startswith("Avoid")
    assert _brief_hero_step("sword", "en").startswith("Hero focus")
    assert _brief_avoid_step("glassmorphism", "ja").startswith("避ける")
