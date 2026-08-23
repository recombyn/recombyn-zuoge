"""Smoke test: web BFF exposes ILP vision tools only when intelligence is configured.

Use --mock for offline routing checks.
"""

from __future__ import annotations

import argparse
import asyncio
import sys
from pathlib import Path

_API_ROOT = Path(__file__).resolve().parents[1]
if str(_API_ROOT) not in sys.path:
    sys.path.insert(0, str(_API_ROOT))


def test_routing_offline() -> bool:
    from app.services.llm.image_tools import ilp_supports, requires_ilp

    import app.services.vision.ilp_client as ilp

    old_enabled = ilp.ilp_enabled
    try:
        ilp.ilp_enabled = lambda: False  # type: ignore[method-assign]
        assert requires_ilp("removeBg") is True
        assert ilp_supports() == []
        print("routing OK: ILP-exclusive tools hidden when service off")

        ilp.ilp_enabled = lambda: True  # type: ignore[method-assign]
        assert ilp_supports() == ["removeBg", "eraser", "editText", "editElements", "detectRegions", "upscale"]
        print("routing OK: ILP tools advertised when service on")
        return True
    finally:
        ilp.ilp_enabled = old_enabled  # type: ignore[method-assign]


async def test_live_api(base: str, token: str) -> bool:
    import httpx

    headers = {"Authorization": f"Bearer {token}"}
    async with httpx.AsyncClient(timeout=30.0) as client:
        tools = await client.get(f"{base.rstrip('/')}/api/v1/image/tools", headers=headers)
        if tools.status_code >= 400:
            print("tools failed:", tools.status_code, tools.text[:300])
            return False
        body = tools.json()
        ilp = body.get("ilp") or {}
        print("ilp:", ilp)
        if not ilp.get("enabled"):
            print("ILP not enabled on API — check RECOMBYN_INTELLIGENCE_URL")
            return False
        supports = ilp.get("supports") or []
        if not supports:
            print("ILP enabled but supports empty")
            return False
        print("live API OK: ILP enabled on BFF")
        return True


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--mock", action="store_true", help="offline routing checks only")
    parser.add_argument("--base", default="http://127.0.0.1:8000")
    parser.add_argument("--token", default="")
    args = parser.parse_args()

    if args.mock or not args.token:
        return 0 if test_routing_offline() else 1
    ok = asyncio.run(test_live_api(args.base, args.token))
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
