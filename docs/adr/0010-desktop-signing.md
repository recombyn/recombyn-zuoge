# ADR 0010: Desktop (Tauri) release signing

- **Status:** Accepted
- **Date:** 2026-08-12

## Context

Phase 4 asks for signed Tauri builds. Signing needs org-owned certificates (Windows Authenticode, Apple Developer ID + notarization) that must not live in the OSS repo. Unsigned installers are still useful for CI smoke and self-host testing.

## Decision

1. **Document** the local/CI signing checklist in [desktop.md](../desktop.md) (env vars, secret names, never commit `.p12` / `.pem`).
2. **CI:** `.github/workflows/desktop-build.yml` is **`workflow_dispatch` only** — builds **unsigned** Windows desktop bundle, uploads artifacts. If repository secrets for updater signing are present, pass them through; Authenticode/notarization remain operator-run until secrets exist.
3. **Do not** block PR `CI / gate` on desktop builds (too slow / platform-specific).
4. **k8s manifests** stay out of scope (compose + GHCR is the OSS default).

## Consequences

### Positive

- Clear path for maintainers with certs; OSS contributors keep unsigned builds.
- Artifacts available without forcing Apple/Windows account on every fork.

### Negative / trade-offs

- Store / SmartScreen / Gatekeeper trust still requires real certs offline or via private secrets.

## Alternatives considered

1. **Commit a self-signed cert** — rejected (useless + dangerous).
2. **Always-on PR desktop CI** — rejected (45m+ runners, flaky tooling).

## References

- [desktop.md](../desktop.md)
- `.github/workflows/desktop-build.yml`
- Tauri v2: https://v2.tauri.app/distribute/
