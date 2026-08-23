"""Open .recombyn-plugin manifest helpers."""

from __future__ import annotations

from recombyn_plugin_sdk.manifest import (
    FORMAT_NAME,
    INSTALL_TARGETS,
    KINDS,
    PLUGIN_JSON,
    PLUGIN_SIG,
    parse_plugin_manifest,
    slug_plugin_id,
)

__all__ = [
    "FORMAT_NAME",
    "INSTALL_TARGETS",
    "KINDS",
    "PLUGIN_JSON",
    "PLUGIN_SIG",
    "parse_plugin_manifest",
    "slug_plugin_id",
]
