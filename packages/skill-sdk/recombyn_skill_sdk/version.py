"""Pack version label + sortable int."""

from __future__ import annotations

import re
from typing import Any


def parse_pack_version(raw: Any) -> tuple[str, int]:
    """Return (label, sortable int). Accepts 1 / '1' / '1.0.0'."""
    s = str(raw if raw is not None else "1").strip() or "1"
    if re.fullmatch(r"-?\d+", s):
        return s, max(1, int(s))
    m = re.match(r"^(\d+)(?:\.(\d+))?(?:\.(\d+))?", s)
    if m:
        major = int(m.group(1))
        minor = int(m.group(2) or 0)
        patch = int(m.group(3) or 0)
        return s, max(1, major * 1_000_000 + minor * 1_000 + patch)
    return s, 1
