/** In-memory only — cleared on page refresh so recovery host can resume persisted jobs. */
const active = new Set<string>();

export function registerGeneratorSession(nodeId: string): void {
  const id = String(nodeId || '').trim();
  if (id) active.add(id);
}

export function unregisterGeneratorSession(nodeId: string): void {
  const id = String(nodeId || '').trim();
  if (id) active.delete(id);
}

export function hasActiveGeneratorSession(nodeId: string): boolean {
  return active.has(String(nodeId || '').trim());
}
