# Plugin packs (``.recombyn-plugin``)

You can pack a Skill or Canvas plugin into a `.recombyn-plugin` file and install it (Skills library upload, or API). Canvas packs must install to disk.

## Build

```bash
# from repo root
node scripts/pack-recombyn-plugin.mjs plugins/skills/festival_poster
node scripts/pack-recombyn-plugin.mjs plugins/canvas/watermark --out dist/plugins

# optional HMAC (same secret as API DESIGN_PLUGIN_HMAC_SECRET)
DESIGN_PLUGIN_HMAC_SECRET=dev-secret node scripts/pack-recombyn-plugin.mjs plugins/skills/festival_poster --sign
```

Output: `dist/plugins/<id>-<version>.recombyn-plugin`.

## `plugin.json`

```json
{
  "format": "recombyn-plugin",
  "formatVersion": 1,
  "id": "festival_poster",
  "kind": "skill",
  "name": "Festival poster",
  "version": "1.0.0",
  "author": "you",
  "install": "user",
  "permissions": ["tools"]
}
```

| Field | Notes |
|-------|--------|
| `kind` | `skill` or `canvas` |
| `install` | `user` (skill → account DB) or `disk` (write `plugins/…`; canvas must use disk) |
| `permissions` | Documented allowlist; live ACL still skill `preferred_tools` / canvas host |

## Install

| Surface | How |
|---------|-----|
| Skills library upload | `.zip` or `.recombyn-plugin` → `POST /design/skills/import` |
| Explicit plugin API | `POST /design/plugins/install` |
| Disk (self-host) | Set `DESIGN_PLUGIN_DISK_INSTALL=true` |

### Env

```bash
# DESIGN_PLUGIN_HMAC_SECRET=          # empty = signature optional
# DESIGN_PLUGIN_DISK_INSTALL=false    # true = allow install=disk
```

## Signature

When `DESIGN_PLUGIN_HMAC_SECRET` is set, packs must include `plugin.sig` (HMAC-SHA256 hex of the canonical digest). The pack script `--sign` flag writes it.

## Samples

- Skill: `plugins/skills/festival_poster/plugin.json`
- Canvas: `plugins/canvas/watermark/plugin.json`

→ [ADR 0016](./adr/0016-recombyn-plugin-pack.md)
