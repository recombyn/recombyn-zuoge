/**
 * Board paint mode — product uses tool ops only (img_layers is retired from UI).
 */

import { type AgentPaintMode } from './types';

export function loadAgentPaintMode(): AgentPaintMode {
  return 'ops';
}

export function saveAgentPaintMode(_mode: AgentPaintMode): void {
  /* Product locks board paint to ops; ignore persistence. */
}
