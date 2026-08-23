"""Admin authorization helpers — role checks + bootstrap constants.

HTTP auth lives in ``app.api.deps`` (``CurrentUser`` / ``AdminUser``).
"""

from __future__ import annotations

import os

from app.services.auth import SessionUser

# Bootstrap admin (seeded on email login). Prefer users.role = 'admin' going forward.
# Override via env before public deploy (do not ship real secrets in git).
SUPER_ADMIN_EMAIL = (
    os.environ.get("SUPER_ADMIN_EMAIL") or "admin@recombyn.com"
).strip().lower()
SUPER_ADMIN_ID = (os.environ.get("SUPER_ADMIN_ID") or "user_super_admin").strip()
SUPER_ADMIN_BOOTSTRAP_PASSWORD = (
    os.environ.get("SUPER_ADMIN_BOOTSTRAP_PASSWORD") or "Admin@2026"
)


def is_admin_user(user: SessionUser) -> bool:
    role = (getattr(user, "role", None) or "user").strip().lower()
    if role == "admin":
        return True
    if user.id == SUPER_ADMIN_ID:
        return True
    if (user.email or "").strip().lower() == SUPER_ADMIN_EMAIL:
        return True
    return False
