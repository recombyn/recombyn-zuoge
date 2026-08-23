"""Volcengine Ark (方舟) list prices — docs 82379/1544106.

No public price-list API; keep a curated snapshot for catalog reference / credits.
Values are 在线推理（常规）base tier unless noted. Image = 输出图 元/张.
"""

from __future__ import annotations

from typing import Any

# Doc: https://www.volcengine.com/docs/82379/1544106
ARK_PRICE_DOC = "82379/1544106"

# catalog id → { price, price_meta }
# Text `price`: 输入(非音频) 元/百万token at lowest online-inference tier.
# Image `price`: 输出图 元/张 (Pro uses ≤2.36M px tier as list price).
ARK_REFERENCE_PRICES: dict[str, dict[str, Any]] = {
    # —— LLM ——
    "deepseek-v4-flash": {
        "price": "1",
        "price_meta": {
            "source": "ark_docs",
            "doc": ARK_PRICE_DOC,
            "unit": "cny_per_mtok",
            "mode": "online_standard",
            "input": 1.0,
            "output": 2.0,
            "cache_hit": 0.2,
        },
    },
    "deepseek-v4-pro": {
        "price": "12",
        "price_meta": {
            "source": "ark_docs",
            "doc": ARK_PRICE_DOC,
            "unit": "cny_per_mtok",
            "mode": "online_standard",
            "input": 12.0,
            "output": 24.0,
            "cache_hit": 1.0,
        },
    },
    "glm-5-2": {
        "price": "8",
        "price_meta": {
            "source": "ark_docs",
            "doc": ARK_PRICE_DOC,
            "unit": "cny_per_mtok",
            "mode": "online_standard",
            "input": 8.0,
            "output": 28.0,
            "cache_hit": 2.0,
        },
    },
    "doubao-seed-2-0-mini": {
        "price": "0.2",
        "price_meta": {
            "source": "ark_docs",
            "doc": ARK_PRICE_DOC,
            "unit": "cny_per_mtok",
            "mode": "online_standard",
            "tier": "input_0_32k",
            "input": 0.2,
            "output": 2.0,
            "cache_hit": 0.04,
            "note": "分段计费；展示价为输入 [0,32] 千token 档",
        },
    },
    "doubao-seed-2-1-pro": {
        "price": "6",
        "price_meta": {
            "source": "ark_docs",
            "doc": ARK_PRICE_DOC,
            "unit": "cny_per_mtok",
            "mode": "online_standard",
            "tier": "input_0_256k",
            "input": 6.0,
            "output": 30.0,
            "cache_hit": 1.2,
        },
    },
    "doubao-seed-2-1-turbo": {
        "price": "3",
        "price_meta": {
            "source": "ark_docs",
            "doc": ARK_PRICE_DOC,
            "unit": "cny_per_mtok",
            "mode": "online_standard",
            "tier": "input_0_256k",
            "input": 3.0,
            "output": 15.0,
            "cache_hit": 0.6,
        },
    },
    # —— Image (Seedream) ——
    "doubao-seedream-5-0-pro": {
        "price": "0.30",
        "price_meta": {
            "source": "ark_docs",
            "doc": ARK_PRICE_DOC,
            "unit": "cny_per_image",
            "input_image": {"first_free": True, "from_second": 0.02},
            "output_image": 0.30,
            "output_image_high": 0.60,
            "high_pixels_threshold": 2_360_000,
            "note": "输出 ≤236万像素 0.30；>236万像素 0.60。目录价取常用档 0.30",
        },
    },
    "doubao-seedream-5-0-lite": {
        "price": "0.22",
        "price_meta": {
            "source": "ark_docs",
            "doc": ARK_PRICE_DOC,
            "unit": "cny_per_image",
            "input_image": 0,
            "output_image": 0.22,
        },
    },
    "doubao-seedream-4-5": {
        "price": "0.25",
        "price_meta": {
            "source": "ark_docs",
            "doc": ARK_PRICE_DOC,
            "unit": "cny_per_image",
            "input_image": 0,
            "output_image": 0.25,
        },
    },
    "doubao-seedream-4-0": {
        "price": "0.20",
        "price_meta": {
            "source": "ark_docs",
            "doc": ARK_PRICE_DOC,
            "unit": "cny_per_image",
            "input_image": 0,
            "output_image": 0.20,
        },
    },
}


def ark_price_for(model_id: str) -> dict[str, Any] | None:
    row = ARK_REFERENCE_PRICES.get((model_id or "").strip())
    return dict(row) if row else None
