# ADR 0020: Open plugin-sdk package

- **Status:** Accepted
- **Date:** 2026-08-14

## Context

`.recombyn-plugin` install lives in the API (`pack_install.py`), but `plugin.json`
validation is useful for pack authors and offline tooling without booting the API.

## Decision

1. Ship `packages/plugin-sdk` (`recombyn_plugin_sdk`) with `parse_plugin_manifest`,
   slug helpers, and format constants (ADR 0016).
2. API `pack_install` imports those helpers; zip extract / HMAC / disk install stay in-API.
3. Do not document proprietary plugin backends in this repository.

## Consequences

- Manifest shape stays single-sourced for public tooling.
- Install side effects remain operator-controlled in the API.

## References

- `packages/plugin-sdk`
- [ADR 0016](./0016-recombyn-plugin-pack.md)
- [ADR 0019](./0019-open-skill-sdk.md)
