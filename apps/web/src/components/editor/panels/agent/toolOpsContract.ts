/** Agent edit tool_ops — allowlist synced from design_canvas_tool (via catalog). */

export const TOOL_OPS_SCHEMA_VERSION = '2026-07-21-v2';

const allowedKeys = new Set<string>();

/** Live allowlist Set (mutated when catalog / canvas_tools loads). */
export const AGENT_EDIT_TOOL_OPS = allowedKeys;

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

function tryParseJson(text: string): unknown | null {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function coerceRawOp(raw: unknown): AgentToolOp | null {
  if (!raw || typeof raw !== 'object') return null;
  const row = raw as Record<string, unknown>;
  const name = String(row.name || '').trim();
  if (!name) return null;
  const argsRaw = row.args;
  const args =
    argsRaw && typeof argsRaw === 'object' && !Array.isArray(argsRaw)
      ? { ...(argsRaw as Record<string, unknown>) }
      : {};
  delete args.op_id;
  const op_id = String(row.op_id || '').trim() || undefined;
  return { name, args, ...(op_id ? { op_id } : {}) };
}

function coerceOpsPayload(data: unknown): AgentToolOp[] {
  if (!data) return [];
  if (Array.isArray(data)) {
    return data.map(coerceRawOp).filter((x): x is AgentToolOp => Boolean(x));
  }
  if (typeof data !== 'object') return [];
  const obj = data as Record<string, unknown>;
  const list = obj.tool_ops;
  if (Array.isArray(list)) {
    return list.map(coerceRawOp).filter((x): x is AgentToolOp => Boolean(x));
  }
  return [];
}

/** Pull canvas tool_ops from coding-CLI / LLM prose (fenced JSON or embedded object). */
export function extractToolOpsFromText(text: string): AgentToolOp[] {
  const raw = String(text || '');
  if (!raw.trim()) return [];

  const fenced = [...raw.matchAll(/```(?:json|JSON)?\s*([\s\S]*?)```/g)];
  for (let i = fenced.length - 1; i >= 0; i -= 1) {
    const body = String(fenced[i]?.[1] || '').trim();
    if (!body) continue;
    const ops = filterAllowedToolOps(coerceOpsPayload(tryParseJson(body)));
    if (ops.length) return ops;
  }

  const marker = raw.search(/\{\s*"tool_ops"\s*:/);
  if (marker >= 0) {
    const slice = raw.slice(marker);
    const end = slice.lastIndexOf('}');
    if (end > 0) {
      const ops = filterAllowedToolOps(
        coerceOpsPayload(tryParseJson(slice.slice(0, end + 1)))
      );
      if (ops.length) return ops;
    }
  }

  const arrMarker = raw.lastIndexOf('[');
  if (arrMarker >= 0) {
    const slice = raw.slice(arrMarker);
    const end = slice.lastIndexOf(']');
    if (end > 0) {
      const ops = filterAllowedToolOps(
        coerceOpsPayload(tryParseJson(slice.slice(0, end + 1)))
      );
      if (ops.length) return ops;
    }
  }

  return [];
}
