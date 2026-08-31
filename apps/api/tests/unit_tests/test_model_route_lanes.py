"""Unit tests for design-agent model route lanes."""

from __future__ import annotations

from app.services.design.runtime.models_route import (
    apply_user_route_overrides,
    clamp_lane,
    model_for_lane,
    normalize_lane,
    parse_model_lanes,
    pin_user_locked_model_routes,
)


def test_normalize_known_lanes():
    assert normalize_lane("fast") == "fast"
    assert normalize_lane("standard") == "standard"
    assert normalize_lane("reasoning") == "reasoning"
    assert normalize_lane("vision") == "vision"
    assert normalize_lane("unknown") == "standard"


def test_parse_threshold_map():
    lanes = parse_model_lanes(
        {
            "precheck.model_threshold": (
                "fast->a;standard->b;reasoning->c;else->b"
            )
        }
    )
    assert lanes["fast"] == "a"
    assert lanes["standard"] == "b"
    assert lanes["reasoning"] == "c"


def test_pin_lock_writes_new_lane_keys():
    rules = pin_user_locked_model_routes({}, "deepseek-v4-pro")
    assert "fast->deepseek-v4-pro" in rules["precheck.model_threshold"]
    assert rules["precheck.vision_model"] == "deepseek-v4-pro"
    assert rules["agent.review.model"] == "deepseek-v4-pro"


def test_resolve_review_honors_user_lock_over_pinned_vision():
    from app.services.design.runtime.models_route import resolve_review_model

    rules = {
        "agent.review.model": "doubao-seed-2-1-turbo",
        "precheck.vision_model": "doubao-seed-2-1-turbo",
        "precheck.model_threshold": "fast->a;standard->b;reasoning->c",
    }
    mid, reason = resolve_review_model(
        rules, user_selected_model="deepseek-v4-flash"
    )
    assert mid == "deepseek-v4-flash"
    assert reason == "review_user_lock"


def test_resolve_review_auto_uses_admin_pin():
    from app.services.design.runtime.models_route import resolve_review_model

    rules = {"agent.review.model": "review-y"}
    mid, reason = resolve_review_model(rules, user_selected_model="auto")
    assert mid == "review-y"
    assert "review_pinned" in reason


def test_resolve_review_follows_design_model_when_no_lock():
    from app.services.design.runtime.models_route import resolve_review_model

    mid, reason = resolve_review_model(
        {}, user_selected_model="auto", design_model="or-gpt-5-6-luna"
    )
    assert mid == "or-gpt-5-6-luna"
    assert reason == "review_follow_design"


def test_resolve_review_raises_when_unconfigured():
    from app.services.design.runtime.models_route import (
        ModelRouteError,
        resolve_review_model,
    )

    try:
        resolve_review_model({}, user_selected_model="auto")
        assert False, "expected ModelRouteError"
    except ModelRouteError:
        pass


def test_user_overrides_canonical_lanes():
    rules = apply_user_route_overrides(
        {},
        {"fast": "m1", "standard": "m2", "vision": "m3"},
    )
    lanes = parse_model_lanes(rules)
    assert lanes["fast"] == "m1"
    assert lanes["standard"] == "m2"
    assert rules["precheck.vision_model"] == "m3"


def test_model_for_lane_and_clamp():
    rules = {
        "precheck.model_threshold": "fast->f;standard->s;reasoning->r;vision->v"
    }
    assert model_for_lane("fast", rules) == "f"
    assert clamp_lane("reasoning", ["fast", "standard"]) == "standard"
