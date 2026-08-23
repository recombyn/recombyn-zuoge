from app.services.llm.agent import (
    assemble_turn_from_lc_tools,
    design_thought_langchain_tools,
    tool_calls_to_canvas_ops,
)


def test_tool_calls_to_canvas_ops_skips_meta():
    ops = tool_calls_to_canvas_ops(
        [
            {"name": "create_text", "arguments": '{"text":"hi"}'},
            {"name": "finish", "arguments": '{"summary":"done"}'},
            {"name": "ask_user", "arguments": '{"question":"q"}'},
        ]
    )
    assert len(ops) == 1
    assert ops[0]["name"] == "create_text"
    assert ops[0]["args"]["text"] == "hi"


def test_assemble_narrate_then_edit():
    turn = assemble_turn_from_lc_tools(
        content="明白了，我先加个标题。",
        tool_calls=[{"name": "create_text", "arguments": '{"text":"A"}'}],
    )
    assert turn["intent"] == "edit"
    assert "标题" in turn["reply"]
    assert turn["tool_ops_raw"][0]["name"] == "create_text"


def test_assemble_chat_and_ask():
    chat = assemble_turn_from_lc_tools(content="你好", tool_calls=[])
    assert chat["intent"] == "chat"
    ask = assemble_turn_from_lc_tools(
        content="",
        tool_calls=[
            {
                "name": "ask_user",
                "arguments": '{"question":"品牌名？","options":["A","B"]}',
            }
        ],
    )
    assert ask["intent"] == "ask"
    assert ask["reply"] == "品牌名？"
    assert ask["choice_ui"] == {
        "mode": "single",
        "options": [
            {"label": "A", "action": "reply"},
            {"label": "B", "action": "reply"},
        ],
    }


def test_design_thought_tools_include_meta():
    names = {getattr(t, "name", None) for t in design_thought_langchain_tools()}
    assert "ask_user" in names
    assert "request_tool_schemas" in names
    assert "request_knowledge" not in names
    assert "finish" in names
    assert "generate_image" not in names
