/** Shared timing + interaction policy for tool_ops apply (Agent SSE + MCP live). */

/** Default stagger between successful ops — matches SVG first-paint feel (~Figma step). */
export const TOOL_OPS_INTER_OP_DELAY_MS = 48;

/** Minimum delay when batch is large or incremental refresh. */
export const TOOL_OPS_INTER_OP_DELAY_FAST_MS = 24;

export function resolveToolOpsInterOpDelayMs(opts?: {
  opCount?: number;
  firstPaint?: boolean;
  overrideMs?: number;
}): number {
  if (opts?.overrideMs != null) return Math.max(0, opts.overrideMs);
  const count = Math.max(0, opts?.opCount ?? 0);
  if (opts?.firstPaint) return Math.max(16, TOOL_OPS_INTER_OP_DELAY_MS);
  if (count > 24) return TOOL_OPS_INTER_OP_DELAY_FAST_MS;
  return TOOL_OPS_INTER_OP_DELAY_MS;
}
