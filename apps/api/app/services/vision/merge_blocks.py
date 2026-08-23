"""Merge OCR word/line fragments into stable text boxes."""

from __future__ import annotations

from typing import Any


def _median(values: list[float], default: float = 14.0) -> float:
    if not values:
        return default
    vals = sorted(values)
    mid = len(vals) // 2
    if len(vals) % 2:
        return vals[mid]
    return (vals[mid - 1] + vals[mid]) / 2.0


def merge_text_blocks(blocks: list[dict[str, Any]], y_tol_ratio: float = 0.55) -> list[dict[str, Any]]:
    """
    Cluster nearby text lines on the same page into fewer textboxes.

    Lines whose vertical centers are within ~y_tol_ratio * median line height
    are joined left-to-right with a space.
    Non-text blocks pass through unchanged.
    """
    others = [b for b in blocks if b.get("type") != "text" or not str(b.get("text") or "").strip()]
    texts = [b for b in blocks if b.get("type") == "text" and str(b.get("text") or "").strip()]
    if not texts:
        return others

    by_page: dict[int, list[dict]] = {}
    for block in texts:
        page = int(block.get("page") or 0)
        by_page.setdefault(page, []).append(block)

    merged: list[dict[str, Any]] = []
    for page, page_blocks in sorted(by_page.items()):
        heights = [max(float(b.get("height") or 0), 1.0) for b in page_blocks]
        median_h = _median(heights)
        y_tol = max(median_h * y_tol_ratio, 4.0)

        ordered = sorted(
            page_blocks,
            key=lambda b: (
                float(b.get("y") or 0) + float(b.get("height") or 0) / 2.0,
                float(b.get("x") or 0),
            ),
        )

        clusters: list[list[dict]] = []
        for block in ordered:
            cy = float(block.get("y") or 0) + float(block.get("height") or 0) / 2.0
            if not clusters:
                clusters.append([block])
                continue
            last = clusters[-1]
            last_cy = sum(float(b.get("y") or 0) + float(b.get("height") or 0) / 2.0 for b in last) / len(last)
            if abs(cy - last_cy) <= y_tol:
                clusters[-1].append(block)
            else:
                clusters.append([block])

        for cluster in clusters:
            cluster = sorted(cluster, key=lambda b: float(b.get("x") or 0))
            xs0 = [float(b.get("x") or 0) for b in cluster]
            ys0 = [float(b.get("y") or 0) for b in cluster]
            xs1 = [float(b.get("x") or 0) + float(b.get("width") or 0) for b in cluster]
            ys1 = [float(b.get("y") or 0) + float(b.get("height") or 0) for b in cluster]
            text = " ".join(str(b.get("text") or "").strip() for b in cluster if str(b.get("text") or "").strip())
            h = max(ys1) - min(ys0)
            font_sizes = [float(b.get("font_size") or h * 0.8) for b in cluster]
            base = dict(cluster[0])
            base.update(
                {
                    "type": "text",
                    "page": page,
                    "text": text,
                    "x": min(xs0),
                    "y": min(ys0),
                    "width": max(max(xs1) - min(xs0), 20),
                    "height": max(h, 12),
                    "font_size": _median(font_sizes, max(h * 0.8, 12)),
                    "source": "merged",
                    "merged_count": len(cluster),
                }
            )
            merged.append(base)

    # Preserve reading order: page then y then x; keep non-text interleaved by geometry
    combined = merged + others
    combined.sort(
        key=lambda b: (
            int(b.get("page") or 0),
            float(b.get("y") or 0),
            float(b.get("x") or 0),
        )
    )
    return combined
