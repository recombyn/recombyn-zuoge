# Extensibility — ``.recombyn-plugin`` pack install (Phase D)

- **Status:** Accepted
- **Date:** 2026-08-12

## Context

Skills and canvas plugins are folders today. Distributors need a single uploadable artifact with a declared kind, optional integrity check, and a clear install target (end-user skill DB vs self-host disk).

## Decision

1. **Format:** a zip whose filename may end in ``.recombyn-plugin`` (``.zip`` with ``plugin.json`` also accepted).
2. **Required root ``plugin.json``:**
   - ``format: "recombyn-plugin"``, ``formatVersion: 1``
   - ``id``, ``kind`` (``skill`` | ``canvas``), ``name``, ``version``
   - ``install``: ``user`` (default for skill) | ``disk`` (required for canvas)
   - ``permissions``: documentation / future ACL list
3. **Install paths:**
   - ``skill`` + ``user`` → existing end-user skill upsert
   - ``skill|canvas`` + ``disk`` → write under ``<repo>/plugins/{skills|canvas}/<id>/`` when ``DESIGN_PLUGIN_DISK_INSTALL=true``
4. **Optional signature:** ``plugin.sig`` = HMAC-SHA256 hex of a canonical digest. Required only when ``DESIGN_PLUGIN_HMAC_SECRET`` is set.
5. **APIs:** ``POST /api/v1/design/plugins/install``; ``POST /api/v1/design/skills/import`` auto-detects branded packs.
6. **Packaging helper:** ``node scripts/pack-recombyn-plugin.mjs <dir>``.

## Consequences

### Positive

- One distributor artifact for Skills and Canvas.
- Skill ``.zip`` without ``plugin.json`` still installs via ``/design/skills/import``.
- Disk install stays opt-in (self-host).

### Negative / trade-offs

- Canvas disk install still needs a web rebuild/register step for toolbar buttons until a dynamic loader exists.
- HMAC is shared-secret integrity, not a public-key trust chain.

## Alternatives considered

1. **Only rename .zip** — rejected; need kind + install target + signature hook.
2. **Public-key signatures first** — deferred; HMAC is enough for private deploy.

## References

- [docs/plugin-packs.md](../plugin-packs.md)
- `app/services/design/plugins/pack_install.py`
- [ADR 0013](./0013-skill-extensions.md) · [ADR 0014](./0014-canvas-plugins.md)
