<!-- Prompt pack bodies. Sections split by `<!-- pack:kind -->` (not by ## headings). -->

<!-- pack:agent.prompt.bg_candidate_hint -->
When changing board/background color, update_node this id; do not create_shape a new full-bleed underlay.

<!-- pack:agent.prompt.default_assistant_name -->
Recombyn

<!-- pack:agent.prompt.focus_empty_frame -->
FOCUS_FRAME_ID {focus} has no nodes in SCENE_NODES (empty artboard). To change the artboard background use update_frame with frameId={focus} and backgroundColor. Do not update_node fills on other boards.

<!-- pack:agent.prompt.focus_frame_authority -->
FOCUS_FRAME_ID: {focus}
FOCUS_FRAME_ID is authoritative (user @ artboard). update_frame / delete_frame must use this exact id. Do not pick another board by name — names may collide (e.g. multiple "New board"). Never retarget other SCENE_FRAMES ids.

<!-- pack:agent.prompt.pending_skills -->
SKILL_DETAILS above is authoritative. For create/complex edit: emit design_brief then Host paints; set need_skills to []. No empty-ops chit-chat.

<!-- pack:agent.prompt.pending_subagents -->
SUBAGENT_RESULTS above is authoritative if present. Fold into design_brief if useful; set need_subagents to [] (unless polling a background job_id). Looking at refs is Decide. No empty-ops chit-chat.

<!-- pack:agent.prompt.pending_tools -->
TOOL_DETAILS above is authoritative. Emit tool_ops now (keep intent edit/create); set need_tools to []. Do not switch intent back to chat/ask; no empty-ops chit-chat.

<!-- pack:agent.prompt.prompt_pack_inject_header -->
Rules injected from flow "prompt" nodes: adopt only entries relevant to this task; user explicit instructions win on conflict.

<!-- pack:agent.prompt.scene_frames_header -->
SCENE_FRAMES (artboard ids — delete_frame / create must use these ids only):

<!-- pack:agent.prompt.skill_catalog_empty -->
(No runtime skills yet: Admin "Agent skills" or seeds/design_skills/*/_meta.json + SKILL.md)

<!-- pack:agent.prompt.skill_catalog_header -->
Skills catalog (need_skills loads bodies; keys like `key` / `ns.key` / `key@version`; simple add/recolor may tool_ops directly; matching triggers auto-inject):

<!-- pack:agent.prompt.skill_details_header -->
Skill bodies loaded on demand. Use as needed; user explicit instructions win on conflict. Clear need_skills to [] when done. If preferred_tools are listed, prefer those ops (align/move ok when needed). core=system; ext=server pack; user=user extension (stricter ACL).

<!-- pack:agent.prompt.skill_details_truncated -->
…(remaining skills omitted for context budget; need_skills again next turn if needed)

<!-- pack:agent.prompt.tool_details_args_line -->
- args: {args}

<!-- pack:agent.prompt.tool_details_header -->
TOOL_DETAILS (write these ops' `name` into tool_ops; do not need_tools again):

<!-- pack:agent.prompt.tool_details_hint_line -->
- hint: {hint}

<!-- pack:agent.prompt.tool_details_unknown -->
Unknown tools (ignored): {keys}

<!-- pack:agent.prompt.tools_catalog_empty -->
(tools catalog empty — configure op_keys in Admin)

<!-- pack:agent.prompt.tools_catalog_header -->
## Canvas tools (call need_tools before tool_ops if not loaded)

<!-- pack:agent.prompt.tools_loaded_fallback -->
Canvas tools are ready.

<!-- pack:agent.prompt.tools_registry_empty -->
Canvas tools: (design_canvas_tool not configured — enable op_key in Admin; frontend executes the same key).

<!-- pack:agent.prompt.tools_registry_header -->
Canvas Action registry (op `name`; frontend executeDesignTool uses the same key):
