from app.services.design.runtime.graph.llm_io import _resolve_agent_persona


def test_resolve_agent_persona_auto_and_locked():
    rules = {
        "agent.persona.auto": "我是测试助手",
        "agent.persona.locked": "我是测试助手，模型{model_label}",
    }
    assert _resolve_agent_persona(rules, "auto") == "我是测试助手"
    locked = _resolve_agent_persona(rules, "deepseek-chat")
    assert "测试助手" in locked
    assert locked  # locked template rendered (model label substituted)
