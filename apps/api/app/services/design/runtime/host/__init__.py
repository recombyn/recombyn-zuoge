"""Host-side prompt assembly, placement, ops gate, deferred resources."""
from app.services.design.runtime.host.prompts import (
    assemble_stage_system,
    interaction_mode_rules_pack,
    language_directive,
    locale_for_runtime,
    normalize_locale,
    require_prompt_pack,
    resolve_output_locale,
)
from app.services.design.runtime.host.placement import (
    build_placement_block,
    placement_errors_for_free_creates,
)
from app.services.design.runtime.host.ops_gate import validate_paint_ops
from app.services.design.runtime.host.resources import load_deferred_resources

__all__ = [
    "assemble_stage_system",
    "require_prompt_pack",
    "interaction_mode_rules_pack",
    "language_directive",
    "locale_for_runtime",
    "normalize_locale",
    "resolve_output_locale",
    "validate_paint_ops",
    "build_placement_block",
    "placement_errors_for_free_creates",
    "load_deferred_resources",
]
