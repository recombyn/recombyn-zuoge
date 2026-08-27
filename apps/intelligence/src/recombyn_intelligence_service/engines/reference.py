"""Reference intelligence pipeline.

Deterministic compile path: ingest -> analyze (heuristic or provided) ->
segment -> extract -> dna -> lock. Never paints. No vision LLM in this service.
"""

from __future__ import annotations

import re
from typing import Any

from recombyn_intelligence_service.engines._schemas import (
    REFERENCE_DNA_AXES,
    _clamp_unit,
    parse_reference_analyze,
    parse_reference_dna,
)

_EDITORIAL_RX = re.compile(r"editorial|杂志|编辑|asymmetr|不对称|museum|艺术指导", re.I)
_MINIMAL_RX = re.compile(r"minimal|极简|clean|留白|whitespace|quiet", re.I)
_PRODUCT_RX = re.compile(r"product|产品|saas|landing|官网|hero", re.I)
_DENSE_RX = re.compile(r"dense|密集|dashboard|仪表|card.?wall|信息密集", re.I)


def ingest_reference_images(images: Any) -> list[str]:
    """User attachments only; empty means skip the pipeline."""
    return [str(x).strip() for x in (images or []) if str(x).strip()][:4]


def should_run_reference_intelligence(
    *,
    images: Any = None,
    reference_dna: Any = None,
    intent: str = "",
) -> bool:
    if isinstance(reference_dna, dict) and reference_dna:
        return False
    if not ingest_reference_images(images):
        return False
    if str(intent or "").strip().lower() in ("chat", "ask", "done"):
        return False
    return True


def segment_reference_analyze(analyzed: dict[str, Any] | None) -> dict[str, Any]:
    src = analyzed if isinstance(analyzed, dict) else {}
    return {
        "composition": src.get("composition") if isinstance(src.get("composition"), dict) else {},
        "hierarchy": src.get("hierarchy") if isinstance(src.get("hierarchy"), dict) else {},
        "imagery": src.get("imagery") if isinstance(src.get("imagery"), dict) else {},
    }


def extract_reference_features(analyzed: dict[str, Any] | None) -> dict[str, Any]:
    src = analyzed if isinstance(analyzed, dict) else {}
    return {
        "palette": src.get("palette") if isinstance(src.get("palette"), dict) else {},
        "typography": src.get("typography") if isinstance(src.get("typography"), dict) else {},
        "density": src.get("density"),
        "grid": str(src.get("grid") or ""),
        "spacing": str(src.get("spacing") or ""),
        "lighting": str(src.get("lighting") or ""),
        "material": str(src.get("material") or ""),
        "depth": str(src.get("depth") or ""),
        "contrast": str(src.get("contrast") or ""),
        "rhythm": str(src.get("rhythm") or ""),
    }


def derive_reference_dna(analyzed: dict[str, Any] | None) -> dict[str, Any]:
    src = analyzed if isinstance(analyzed, dict) else {}
    density = _clamp_unit(src.get("density"), 0.5)
    comp = src.get("composition") if isinstance(src.get("composition"), dict) else {}
    typo = src.get("typography") if isinstance(src.get("typography"), dict) else {}
    imagery = src.get("imagery") if isinstance(src.get("imagery"), dict) else {}
    ctype = str(comp.get("type") or "").lower()
    balance = str(comp.get("balance") or "").lower()
    scale = str(typo.get("scale") or "").lower()
    t_contrast = str(typo.get("contrast") or "").lower()
    istyle = str(imagery.get("style") or "").lower()
    lighting = str(src.get("lighting") or imagery.get("lighting") or "").lower()
    material = str(src.get("material") or "").lower()

    if "asymmetric" in ctype:
        asymmetry = 0.75
    elif "center" in ctype or "symmetr" in ctype:
        asymmetry = 0.22
    else:
        asymmetry = 0.45
    editorial = 0.4
    if "editorial" in ctype or "editorial" in istyle:
        editorial = 0.88
    elif scale == "large":
        editorial = 0.7
    contrast_n = 0.5
    if t_contrast == "high" or balance == "dynamic":
        contrast_n = 0.78
    elif t_contrast == "low" or balance in ("static", "stable"):
        contrast_n = 0.35
    decoration = _clamp_unit(density * 0.4)
    if "decor" in ctype:
        decoration = 0.7
    minimalism = _clamp_unit(1.0 - density * 0.8 - decoration * 0.3)
    texture = 0.35
    if any(k in lighting for k in ("soft", "atmospheric", "directional", "tactile")):
        texture = 0.48
    if material:
        texture = max(texture, 0.55)
    return parse_reference_dna(
        {
            "visual_dna": {
                "minimalism": round(minimalism, 2),
                "editorial": round(editorial, 2),
                "contrast": round(contrast_n, 2),
                "density": round(density, 2),
                "asymmetry": round(asymmetry, 2),
                "texture": round(texture, 2),
                "decoration": round(decoration, 2),
            }
        }
    )


def _dna_from_seed_or_derive(analyzed: dict[str, Any], raw_dna: Any) -> dict[str, Any]:
    derived = derive_reference_dna(analyzed)
    src = raw_dna
    if isinstance(raw_dna, dict) and isinstance(raw_dna.get("visual_dna"), dict):
        src = raw_dna.get("visual_dna")
    if not isinstance(src, dict) or not src:
        return derived
    merged = dict(derived.get("visual_dna") or {})
    for axis in REFERENCE_DNA_AXES:
        if axis in src and src[axis] is not None:
            merged[axis] = _clamp_unit(src[axis])
    return parse_reference_dna({"visual_dna": merged})


def build_reference_lock(
    analyzed: dict[str, Any] | None,
    dna: dict[str, Any] | None = None,
) -> dict[str, Any]:
    _ = dna
    src = analyzed if isinstance(analyzed, dict) else {}
    return {
        "allow": ["content", "images", "brand_details"],
        "forbid": ["changing core visual language"],
        "composition": src.get("composition") if isinstance(src.get("composition"), dict) else {},
        "palette": src.get("palette") if isinstance(src.get("palette"), dict) else {},
        "typography": src.get("typography") if isinstance(src.get("typography"), dict) else {},
        "imagery": src.get("imagery") if isinstance(src.get("imagery"), dict) else {},
        "hierarchy": src.get("hierarchy") if isinstance(src.get("hierarchy"), dict) else {},
    }


def compile_reference_intelligence(raw_analyze: Any, raw_dna: Any = None) -> dict[str, Any]:
    analyze = parse_reference_analyze(raw_analyze)
    return {
        "analyze": analyze,
        "segments": segment_reference_analyze(analyze),
        "features": extract_reference_features(analyze),
        "dna": _dna_from_seed_or_derive(analyze, raw_dna),
        "lock": build_reference_lock(analyze),
    }


def heuristic_reference_analyze(
    *,
    prompt: str = "",
    scene_key: str = "",
    image_count: int = 1,
) -> dict[str, Any]:
    """Deterministic visual-law seed when private service has no vision LLM."""
    text = f"{prompt} {scene_key}".strip()
    editorial = bool(_EDITORIAL_RX.search(text))
    minimal = bool(_MINIMAL_RX.search(text))
    product = bool(_PRODUCT_RX.search(text)) or str(scene_key or "").lower() in (
        "landing",
        "saas",
        "website",
    )
    dense = bool(_DENSE_RX.search(text)) or str(scene_key or "").lower() in (
        "dashboard",
        "admin",
    )

    if editorial:
        ctype, balance, density = "asymmetric editorial", "dynamic", 0.38
        scale, t_contrast, istyle = "large", "high", "editorial photography"
    elif minimal or product:
        ctype, balance, density = "product focal center", "stable", 0.28
        scale, t_contrast, istyle = "medium", "medium", "single product metaphor"
    elif dense:
        ctype, balance, density = "multi-panel grid", "static", 0.72
        scale, t_contrast, istyle = "small", "low", "ui chrome"
    else:
        ctype, balance, density = "balanced layout", "stable", 0.45
        scale, t_contrast, istyle = "medium", "medium", "general photography"

    # More attachments → slightly higher density read (composition complexity).
    density = _clamp_unit(density + max(0, image_count - 1) * 0.04)

    return parse_reference_analyze(
        {
            "composition": {"type": ctype, "balance": balance, "focal": "primary"},
            "hierarchy": {
                "primary": "hero / title",
                "secondary": "supporting copy",
                "tertiary": "meta / chrome",
            },
            "density": density,
            "palette": {
                "dominant": ["#1a1a1a", "#f5f5f0"] if minimal or editorial else ["#111827", "#ffffff"],
                "accent": ["#c45c26"] if editorial else (["#2563eb"] if product else ["#64748b"]),
            },
            "typography": {
                "scale": scale,
                "contrast": t_contrast,
                "pairing": "display + quiet sans" if editorial else "sans stack",
            },
            "imagery": {
                "style": istyle,
                "lighting": "soft directional" if editorial or minimal else "even",
            },
            "grid": "asymmetric columns" if editorial else ("task panels" if dense else "single column hero"),
            "spacing": "generous" if minimal or editorial else ("tight" if dense else "balanced"),
            "lighting": "soft directional" if editorial or minimal else "even",
            "material": "paper / ink" if editorial else ("product surface" if product else ""),
            "depth": "layered" if editorial else "flat",
            "contrast": t_contrast,
            "rhythm": "editorial beat" if editorial else ("dense scan" if dense else "steady"),
        }
    )


def run_reference_intelligence_pipeline(
    *,
    images: Any = None,
    prompt: str = "",
    scene_key: str = "",
    intent: str = "",
    reference_dna: Any = None,
    reference_analyze: Any = None,
    visual_dna: Any = None,
) -> dict[str, Any] | None:
    """Fail-open: return None when gate says skip (host may use local fallback)."""
    if not should_run_reference_intelligence(
        images=images,
        reference_dna=reference_dna,
        intent=intent,
    ):
        # Allow compile-only when caller already supplied analyze (no images).
        if not isinstance(reference_analyze, dict) or not reference_analyze:
            return None
    imgs = ingest_reference_images(images)
    seed = reference_analyze if isinstance(reference_analyze, dict) and reference_analyze else None
    if seed is None:
        seed = heuristic_reference_analyze(
            prompt=prompt,
            scene_key=scene_key,
            image_count=max(1, len(imgs)),
        )
    dna_in = visual_dna
    if dna_in is None and isinstance(seed, dict):
        dna_in = seed.get("visual_dna")
    compiled = compile_reference_intelligence(seed, dna_in)
    analyze = compiled.get("analyze") if isinstance(compiled.get("analyze"), dict) else {}
    comp = analyze.get("composition") if isinstance(analyze.get("composition"), dict) else {}
    ctype = str(comp.get("type") or "").strip()
    compiled["summary"] = (ctype or "reference dna locked")[:160]
    compiled["image_count"] = len(imgs)
    return compiled
