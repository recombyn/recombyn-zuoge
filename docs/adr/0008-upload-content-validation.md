# ADR 0008: Upload content validation + optional AV hook

- **Status:** Accepted
- **Date:** 2026-08-12

## Context

Uploads already enforce auth, ownership prefixes, size caps, and declared MIME allowlists. Attackers can still rename executables or polyglots to `.png`. Full antivirus in-process is heavy for OSS/self-host defaults.

## Decision

1. **Magic-byte sniff** in `app.services.uploads` before `put_bytes`. Prefer sniffed ext/MIME when family matches claim; reject family mismatches, PE/ELF, and SVG with `<script>` / `<foreignObject>`.
2. **Setting** `upload_require_magic_match` (default true). Unknown magic for claimed media fails closed (except Pillow-openable raster when sniff is inconclusive, e.g. some AVIF).
3. **Optional AV hook:** `upload_av_hook_enabled` + `upload_av_command` (argv prefix; path appended). Off by default — operators wire ClamAV via `docker-compose.av.yml` (`INSTALL_AV` + `clamdscan --host=clamav`).
4. **No orphan scanner module** — keep helpers in `uploads.py`.

## Consequences

### Positive

- Blocks trivial content-type spoofing on the hot path.
- Self-hosters can plug AV without forking the API.

### Negative / trade-offs

- Exotic codecs without magic may need Pillow fallback or a config escape.
- AV hook is best-effort subprocess, not a sandbox.

## Alternatives considered

1. **Mandatory ClamAV in compose** — rejected for laptop/OSS DX.
2. **Only client Content-Type** — status quo; insufficient.

## References

- `apps/api/app/services/uploads.py`
- [SECURITY.md](../../SECURITY.md)
- [RBAC notes](../security-rbac.md)
