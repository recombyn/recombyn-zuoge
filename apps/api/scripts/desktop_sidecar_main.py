"""Entry for the desktop-local API sidecar (PyInstaller → recombyn-api.exe)."""

from __future__ import annotations

import os
import sys


def _bootstrap_root() -> None:
    """Ensure frozen / source layouts resolve ``app`` and seed ``seeds/``."""
    if getattr(sys, "frozen", False):
        meipass = getattr(sys, "_MEIPASS", None)
        if meipass and meipass not in sys.path:
            sys.path.insert(0, meipass)
        # Prefer empty DB URL unless the host explicitly set one (Tauri forces "").
        os.environ.setdefault("DATABASE_URL", "")
        os.environ.setdefault("S3_ENABLED", "false")
        os.environ.setdefault("DESKTOP_LOCAL_AUTO_LOGIN", "true")


def main() -> None:
    _bootstrap_root()
    host = (os.environ.get("RECOMBYN_API_HOST") or "127.0.0.1").strip() or "127.0.0.1"
    port_raw = (os.environ.get("RECOMBYN_API_PORT") or "8000").strip() or "8000"
    try:
        port = int(port_raw)
    except ValueError:
        port = 8000

    import uvicorn

    from app.main import app

    uvicorn.run(app, host=host, port=port, log_level="info", access_log=False)


if __name__ == "__main__":
    main()
