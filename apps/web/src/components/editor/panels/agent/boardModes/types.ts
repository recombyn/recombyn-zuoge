/** Design Agent board paint mode — ops (default) vs img_layers. */

export type AgentPaintMode = 'ops' | 'img_layers';

export const AGENT_PAINT_MODES: readonly AgentPaintMode[] = ['ops', 'img_layers'] as const;

export function normalizeAgentPaintMode(raw: unknown): AgentPaintMode {
  const s = String(raw || '')
    .trim()
    .toLowerCase()
    .replace(/-/g, '_');
  if (s === 'img_layers') {
    return 'img_layers';
  }
  return 'ops';
}
