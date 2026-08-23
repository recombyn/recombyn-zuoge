#!/usr/bin/env python3
"""Smoke test: GET /health and optional pipeline queue stats."""

from __future__ import annotations

import json
import sys
import urllib.request

BASE = sys.argv[1] if len(sys.argv) > 1 else "http://127.0.0.1:8091"


def main() -> int:
    url = f"{BASE.rstrip('/')}/health"
    with urllib.request.urlopen(url, timeout=10) as resp:
        body = json.loads(resp.read().decode("utf-8"))
    print(json.dumps(body, indent=2, ensure_ascii=False))
    status = body.get("status")
    if status not in {"ok", "degraded"}:
        return 1
    vision = body.get("vision") or {}
    if not vision.get("enabled"):
        print("vision not enabled", file=sys.stderr)
        return 1
    if status == "degraded":
        blocker = body.get("production_blocker")
        if blocker:
            print(f"degraded: {blocker}", file=sys.stderr)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
