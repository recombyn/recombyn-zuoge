"""Live smoke test against running API (default :8000)."""
from __future__ import annotations

import json
import sys
import urllib.error
import urllib.request

BASE = sys.argv[1] if len(sys.argv) > 1 else "http://127.0.0.1:8000"
FAKE_TTF = (
    b"\x00\x01\x00\x00\x00\x0b\x00\x80\x00\x03\x00\x30"
    b"OS/2\x00\x00\x00\x56\x00\x00\x00\x01\x00\x00\x00"
    + b"\x00" * 200
)


def http_json(method: str, path: str, *, token: str | None = None, body: bytes | None = None, content_type: str | None = None) -> tuple[int, dict | str]:
    url = f"{BASE.rstrip('/')}{path}"
    headers = {}
    if token:
        headers["Authorization"] = f"Bearer {token}"
    if content_type:
        headers["Content-Type"] = content_type
    req = urllib.request.Request(url, data=body, headers=headers, method=method)
    try:
        with urllib.request.urlopen(req, timeout=30) as res:
            raw = res.read().decode("utf-8", errors="replace")
            try:
                return res.status, json.loads(raw)
            except json.JSONDecodeError:
                return res.status, raw
    except urllib.error.HTTPError as err:
        raw = err.read().decode("utf-8", errors="replace")
        try:
            return err.code, json.loads(raw)
        except json.JSONDecodeError:
            return err.code, raw


def multipart_upload(filename: str, content: bytes, token: str) -> tuple[int, dict | str]:
    boundary = "----RecombynFontSmoke"
    body = (
        f"--{boundary}\r\n"
        f'Content-Disposition: form-data; name="file"; filename="{filename}"\r\n'
        f"Content-Type: font/ttf\r\n\r\n"
    ).encode("utf-8") + content + f"\r\n--{boundary}--\r\n".encode("utf-8")
    return http_json(
        "POST",
        "/api/v1/fonts/upload",
        token=token,
        body=body,
        content_type=f"multipart/form-data; boundary={boundary}",
    )


def main() -> int:
    print(f"API base: {BASE}")

    status, auth_cfg = http_json("GET", "/api/v1/auth/config")
    print(f"auth/config -> {status}: {auth_cfg}")

    status, login = http_json("POST", "/api/v1/auth/desktop-local", body=b"{}", content_type="application/json")
    if status != 200:
        print(f"desktop-local login failed ({status}): {login}")
        print("Cannot test authenticated upload without token.")
        return 1

    token = login.get("token") if isinstance(login, dict) else None
    if not token:
        print(f"No token in login response: {login}")
        return 1

    print(f"Logged in as: {login.get('user', {}).get('email')}")

    name = "LiveSmokeDupFont.ttf"
    first_status, first = multipart_upload(name, FAKE_TTF + b"x", token)
    print(f"upload #1 -> {first_status}: {first}")

    second_status, second = multipart_upload(name, FAKE_TTF + b"y", token)
    print(f"upload #2 -> {second_status}: {second}")

    list_status, listed = http_json("GET", "/api/v1/fonts?page=1&pageSize=500", token=token)
    mine = []
    if isinstance(listed, dict):
        mine = [it for it in listed.get("items") or [] if it.get("isMine")]
    print(f"list -> {list_status}, mine_count={len(mine)}")

    if second_status == 400:
        detail = second.get("detail", "") if isinstance(second, dict) else str(second)
        print(f"PASS duplicate rejected: {detail}")
        return 0

    print("FAIL expected second upload to return 400")
    return 2


if __name__ == "__main__":
    raise SystemExit(main())
