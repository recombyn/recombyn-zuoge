"""Prompts unique to img_layers board mode."""

from __future__ import annotations


def board_image_prompt(user_prompt: str, *, width: int, height: int) -> str:
    """Steer the image model toward a clean, decomposable poster/board."""
    base = str(user_prompt or "").strip()
    return (
        f"{base}\n\n"
        "Design constraints for editable layer split:\n"
        f"- Exact canvas {width}x{height}px, full-bleed composition, no UI chrome.\n"
        "- Clear visual hierarchy: solid/simple background, distinct subjects, readable text.\n"
        "- Prefer high-contrast lettering; avoid tiny microcopy and dense paragraphs.\n"
        "- Flat or lightly shaded shapes; avoid heavy glassmorphism / noisy textures.\n"
        "- No watermark, no mock device frames, no extra margins around the design."
    )
