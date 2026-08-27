export function normalizeProjectId(projectId: string | null | undefined): string {
  return String(projectId || '').trim();
}

export function normalizeProjectIds(ids: string[]): string[] {
  return [...new Set(ids.map(normalizeProjectId).filter(Boolean))];
}
