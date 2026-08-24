import type { SceneNodeInput } from '@/components/rcb/sceneNode';

export function readProcessJobIds(node: SceneNodeInput | null | undefined): string[] {
  if (!node?.attrs) return [];
  try {
    const raw = JSON.parse(String(node.attrs.processJobIds || '[]'));
    if (!Array.isArray(raw)) return [];
    return raw.map((id) => String(id || '').trim()).filter(Boolean);
  } catch {
    return [];
  }
}

export function processJobAttrPatch(jobIds: string[]): Record<string, string> {
  return {
    processJobIds: JSON.stringify(jobIds),
    processStartedAt: String(Date.now()),
  };
}

export function clearProcessJobAttrKeys(attrs: Record<string, unknown>): void {
  delete attrs.processJobIds;
  delete attrs.processStartedAt;
}

export function readProcessStartedAt(node: SceneNodeInput | null | undefined): number {
  const raw = Number(node?.attrs?.processStartedAt);
  return Number.isFinite(raw) && raw > 0 ? raw : 0;
}

/** Jobs older than server timeout + slack — treat as stale after refresh. */
export const PROCESS_JOB_STALE_MS = 190_000;

export function isStaleProcessJob(node: SceneNodeInput | null | undefined): boolean {
  const started = readProcessStartedAt(node);
  if (!started) return true;
  return Date.now() - started > PROCESS_JOB_STALE_MS;
}
