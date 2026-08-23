"""Quick readiness probe for local/dev import stack."""

from __future__ import annotations

import json
import sys
import urllib.request


def main() -> int:
    url = sys.argv[1] if len(sys.argv) > 1 else "http://localhost:8000/api/v1/health"
    try:
        with urllib.request.urlopen(url, timeout=3) as resp:
            data = json.loads(resp.read().decode("utf-8"))
    except Exception as exc:  # noqa: BLE001
        print(f"FAIL cannot reach {url}: {exc}")
        return 1

    print(json.dumps(data, ensure_ascii=False, indent=2))
    checks = data.get("checks") or {}
    if not checks.get("api"):
        return 1
    if not checks.get("redis"):
        print("WARN redis down — async jobs unavailable; sync import may work")
        return 0
    if not checks.get("worker"):
        print("WARN worker not reachable — frontend will fall back to sync after queue wait")
        return 0
    print("OK import stack ready")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
