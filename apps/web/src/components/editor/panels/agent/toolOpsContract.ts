/** Agent edit tool_ops — allowlist synced from design_canvas_tool (via catalog). */

const allowedKeys = new Set<string>();

export function getAllowedCanvasToolKeys(): Set<string> {
  return allowedKeys;
}

/** Sync allowlist from catalog canvas_tools (same op_key FE executes). */
export function setAllowedCanvasToolKeys(keys: Iterable<string>): void {
  allowedKeys.clear();
  for (const k of keys) {
    const key = String(k || '').trim();
    if (key) allowedKeys.add(key);
  }
}

export type AgentToolOp = {
  name: string;
  args: Record<string, unknown>;
  op_id?: string;
};

export function dedupeToolOpsById(
  ops: AgentToolOp[],
  seen: Set<string> = new Set()
): AgentToolOp[] {
  const out: AgentToolOp[] = [];
  for (const op of ops) {
    const oid = String(op.op_id || '').trim();
    if (oid) {
      if (seen.has(oid)) continue;
      seen.add(oid);
    }
    out.push(op);
  }
  return out;
}

export function filterAllowedToolOps(
  ops: Array<{ name?: string; args?: Record<string, unknown>; op_id?: string }>
): AgentToolOp[] {
  const allow = getAllowedCanvasToolKeys();
  // Catalog not loaded yet — do not drop ops (backend already allowlisted).
  const enforce = allow.size > 0;
  const out: AgentToolOp[] = [];
  for (const raw of ops) {
    const name = String(raw?.name || '').trim();
    if (!name) continue;
    if (enforce && !allow.has(name)) continue;
    const args = { ...(raw?.args && typeof raw.args === 'object' ? raw.args : {}) };
    delete args.op_id;
    const op_id = String(raw.op_id || '').trim() || undefined;
    out.push({ name, args, ...(op_id ? { op_id } : {}) });
  }
  return out;
}
