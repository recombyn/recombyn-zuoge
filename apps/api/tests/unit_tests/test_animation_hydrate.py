"""Unit tests for create_lottie genPrompt hydrate / fallback."""

from __future__ import annotations

import asyncio


def test_validate_lottie_animation_requires_layers_and_size():
    from app.services.design.ops.animation_hydrate import validate_lottie_animation

    assert validate_lottie_animation(None) is None
    assert validate_lottie_animation({}) is None
    assert validate_lottie_animation({"layers": [], "w": 100, "h": 100}) is None
    assert validate_lottie_animation({"layers": [{}], "w": 4, "h": 100}) is None

    ok = validate_lottie_animation(
        {
            "layers": [
                {
                    "ty": 4,
                    "shapes": [
                        {"ty": "el", "p": {"a": 0, "k": [0, 0]}, "s": {"a": 0, "k": [40, 40]}},
                        {"ty": "fl", "c": {"a": 0, "k": [1, 0.2, 0.3, 1]}},
                    ],
                }
            ],
            "w": 120,
            "h": 80,
        }
    )
    assert ok is not None
    assert ok["w"] == 120
    assert ok["h"] == 80
    assert ok["fr"] == 30
    assert ok["assets"] == []


def test_hydrate_tool_ops_lottie_fills_gen_prompt(monkeypatch):
    from app.services.design.ops import animation_hydrate as mod

    async def _fake_gen(*, prompt, width, height, duration_sec, model=None):
        return {
            "v": "5.7.4",
            "fr": 30,
            "ip": 0,
            "op": 60,
            "w": int(width),
            "h": int(height),
            "nm": str(prompt or "Lottie")[:80],
            "ddd": 0,
            "assets": [],
            "layers": [
                {
                    "ty": 4,
                    "shapes": [
                        {"ty": "el", "p": {"a": 0, "k": [0, 0]}, "s": {"a": 0, "k": [40, 40]}},
                        {"ty": "fl", "c": {"a": 0, "k": [0.2, 0.45, 1.0, 1]}},
                    ],
                }
            ],
        }

    monkeypatch.setattr(mod, "generate_lottie_animation", _fake_gen)

    ops = [
        {
            "name": "create_lottie",
            "args": {
                "genPrompt": "success check pulse",
                "x": 10,
                "y": 20,
                "width": 100,
                "height": 100,
            },
        },
        {
            "name": "create_lottie",
            "args": {
                "animationData": {"layers": [{"ty": 4}], "w": 50, "h": 50},
                "x": 0,
                "y": 0,
            },
        },
    ]
    out, n = asyncio.run(mod.hydrate_tool_ops_lottie(ops, limit=4))
    assert n == 1
    assert out[0]["args"]["animationData"]["layers"]
    assert out[0]["args"]["genPrompt"] == "success check pulse"
    # Already had animationData — unchanged
    assert out[1]["args"]["animationData"]["w"] == 50


def test_flatten_lottie_groups_lifts_fill_out_of_gr():
    from app.services.design.ops.animation_hydrate import (
        _flatten_lottie_groups,
        validate_lottie_animation,
    )

    raw = {
        "w": 100,
        "h": 100,
        "layers": [
            {
                "ty": 4,
                "shapes": [
                    {
                        "ty": "gr",
                        "nm": "g",
                        "it": [
                            {
                                "ty": "el",
                                "p": {"a": 0, "k": [0, 0]},
                                "s": {"a": 0, "k": [40, 40]},
                            },
                            {"ty": "fl", "c": {"a": 0, "k": [1, 0, 0, 1]}},
                        ],
                    }
                ],
            }
        ],
    }
    ok = validate_lottie_animation(raw)
    assert ok is not None
    tys = [s.get("ty") for s in ok["layers"][0]["shapes"]]
    assert "gr" not in tys
    assert "el" in tys and "fl" in tys
    from app.services.design.ops.animation_hydrate import _keep_animation_canvas_size

    kept = _keep_animation_canvas_size(
        {"layers": [{"ty": 4}], "w": 200, "h": 200}, design_w=1588, design_h=1588
    )
    assert kept["w"] == 200
    assert kept["h"] == 200

    filled = _keep_animation_canvas_size(
        {"layers": [{"ty": 4}], "w": 0, "h": 0}, design_w=256, design_h=128
    )
    assert filled["w"] == 256
    assert filled["h"] == 128


def test_clamp_lottie_design_size_caps_huge_plates():
    from app.services.design.ops.animation_hydrate import _clamp_lottie_design_size

    w, h = _clamp_lottie_design_size(1588, 1588)
    assert max(w, h) == 512
    assert w == h


def test_create_lottie_contract_requires_source(monkeypatch):
    from app.services.design.ops import tool_ops_contract as toc

    monkeypatch.setattr(
        toc,
        "allowed_canvas_tool_keys",
        lambda: frozenset({"create_lottie", "create_shape"}),
    )

    err = toc._validate_single_op("create_lottie", {"x": 0, "y": 0}, scene_node_ids=None)
    assert err and "create_lottie_missing_source" in err

    assert (
        toc._validate_single_op("create_lottie", {"genPrompt": "loading"}, scene_node_ids=None)
        is None
    )
    assert (
        toc._validate_single_op(
            "create_lottie",
            {"animationData": {"layers": [{}], "w": 40, "h": 40}},
            scene_node_ids=None,
        )
        is None
    )
