"""
Generate prepaid card keys locally.

1. Random plaintext (XXXXX-XXXXX-XXXXX-XXXXX, ambiguous chars excluded)
2. Store HMAC-SHA256(plaintext, CARD_KEY_SALT) — never plaintext
3. Export plaintext to a file for the card-selling platform
4. Delete that file after upload

Usage (from apps/api):
  python -m scripts.gen_card_keys --count 20 --credits 50 --expires-days 365 --out ./_card_keys_export.txt

Env:
  CARD_KEY_SALT must be a strong random string (len>=24), same as the API.
"""

from __future__ import annotations

import argparse
import sys
import time
from pathlib import Path

# Allow `python -m scripts.gen_card_keys` from apps/api
_API_ROOT = Path(__file__).resolve().parents[1]
if str(_API_ROOT) not in sys.path:
    sys.path.insert(0, str(_API_ROOT))

from app.core.config import settings  # noqa: E402
from app.services.wallet.card_keys import (  # noqa: E402
    generate_plaintext_key,
    insert_card_keys,
    require_strong_card_key_salt,
)
from app.services.wallet.db import init_wallet_db  # noqa: E402


def main() -> int:
    parser = argparse.ArgumentParser(description="Generate card keys for credit top-up")
    parser.add_argument("--count", type=int, default=10, help="How many keys to generate")
    parser.add_argument(
        "--kind",
        type=str,
        default="credit",
        choices=("credit", "plan"),
        help="credit = 积分 top-up; plan = membership + credits",
    )
    parser.add_argument(
        "--plan-id",
        type=str,
        default="",
        help="Required for --kind plan: plus | pro | ultra",
    )
    parser.add_argument(
        "--credits",
        type=int,
        default=0,
        help="Credits per key (required for credit; optional for plan — uses catalog default)",
    )
    parser.add_argument(
        "--expires-days",
        type=int,
        default=0,
        help="Days until expiry (0 = never expires)",
    )
    parser.add_argument(
        "--out",
        type=str,
        default="_card_keys_export.txt",
        help="Plaintext export path (delete after uploading to the platform)",
    )
    args = parser.parse_args()

    if args.count <= 0 or args.count > 10_000:
        print("error: --count must be 1..10000", file=sys.stderr)
        return 1
    if args.kind == "credit" and args.credits <= 0:
        print("error: --credits must be > 0 for credit keys", file=sys.stderr)
        return 1
    if args.kind == "plan" and args.plan_id.strip().lower() not in ("plus", "pro", "ultra"):
        print("error: --plan-id must be plus|pro|ultra for plan keys", file=sys.stderr)
        return 1
    if not (settings.card_key_salt or "").strip():
        print(
            "error: CARD_KEY_SALT is empty. Set it in apps/api/.env before generating keys.",
            file=sys.stderr,
        )
        return 1
    try:
        require_strong_card_key_salt()
    except ValueError as err:
        print(f"error: {err}", file=sys.stderr)
        return 1

    init_wallet_db()
    expires_at = None
    if args.expires_days and args.expires_days > 0:
        expires_at = time.time() + args.expires_days * 86400

    plaintexts: list[str] = []
    seen: set[str] = set()
    while len(plaintexts) < args.count:
        k = generate_plaintext_key()
        if k in seen:
            continue
        seen.add(k)
        plaintexts.append(k)

    inserted = insert_card_keys(
        plaintexts=plaintexts,
        credits=args.credits,
        expires_at=expires_at,
        kind=args.kind,
        plan_id=args.plan_id or None,
    )
    out_path = Path(args.out)
    if not out_path.is_absolute():
        out_path = Path.cwd() / out_path

    header = (
        f"# recombyn card keys — kind={args.kind} plan={args.plan_id or '-'} "
        f"credits={args.credits} each — count={inserted}\n"
        f"# Upload to your card platform, then DELETE this file.\n"
        f"# Generated at unix={int(time.time())}\n"
    )
    out_path.write_text(header + "\n".join(plaintexts) + "\n", encoding="utf-8")

    print(f"Inserted {inserted} hashed keys into wallet DB.")
    print(f"Plaintext written to: {out_path}")
    print("IMPORTANT: After uploading to the card platform, delete the plaintext file.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
