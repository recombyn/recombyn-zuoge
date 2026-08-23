"""Install recombyn-protocol then this package (dev bootstrap).

Resolution order for the protocol package:
1. RECOMBYN_PROTOCOL_PATH
2. Monorepo packages/protocol (recombyn-dev layout)
3. Sibling ../resume-creation-web/packages/protocol
4. Sibling ../recombyn/packages/protocol
5. pip install recombyn-protocol>=0.1.3
"""

from __future__ import annotations

import os
import subprocess
import sys
from pathlib import Path

_ROOT = Path(__file__).resolve().parents[1]
_MIN = "0.1.3"


def _candidates() -> list[Path]:
    out: list[Path] = []
    env = str(os.environ.get("RECOMBYN_PROTOCOL_PATH") or "").strip()
    if env:
        out.append(Path(env).expanduser())
    # src/commercial/intelligence → repo root is parents[2]
    out.append(_ROOT.parents[2] / "packages" / "protocol")
    out.append(_ROOT.parent / "resume-creation-web" / "packages" / "protocol")
    out.append(_ROOT.parent / "recombyn" / "packages" / "protocol")
    return out


def _run(cmd: list[str]) -> None:
    print("+", " ".join(cmd), flush=True)
    subprocess.check_call(cmd)


def main() -> int:
    py = sys.executable
    installed = False
    for path in _candidates():
        if (path / "pyproject.toml").is_file():
            _run([py, "-m", "pip", "install", "-e", str(path)])
            installed = True
            break
    if not installed:
        _run([py, "-m", "pip", "install", f"recombyn-protocol>={_MIN}"])
    _run([py, "-m", "pip", "install", "-e", f"{_ROOT}[dev]"])
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
