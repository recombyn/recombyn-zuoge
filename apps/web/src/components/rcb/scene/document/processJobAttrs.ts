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
export const PROCESS_JOB_STALE_MS = 320_000;

export function isStaleProcessJob(node: SceneNodeInput | null | undefined): boolean {
  const started = readProcessStartedAt(node);
  if (!started) return true;
  return Date.now() - started > PROCESS_JOB_STALE_MS;
}

/** Strip trailing ` 42%` progress suffix from SoftGlow labels. */
export function stripProcessProgressLabel(label: string, fallback = '处理中'): string {
  return String(label || fallback).replace(/\s+\d+%$/, '').trim() || fallback;
}

/** Omit `0%` — queued jobs should not look stuck at zero. */
export function formatProcessProgressLabel(labelBase: string, pct: number, fallback = '处理中'): string {
  const base = stripProcessProgressLabel(labelBase, fallback);
  const rounded = Math.round(pct);
  if (!Number.isFinite(rounded) || rounded <= 0) return base;
  return `${base} ${rounded}%`;
}

export type UploadRecoveryBlockReason = 'no_job' | 'stale';

export function uploadRecoveryBlockReason(
  node: SceneNodeInput | null | undefined
): UploadRecoveryBlockReason | null {
  const jobIds = readProcessJobIds(node);
  if (!jobIds.length) return 'no_job';
  if (isStaleProcessJob(node)) return 'stale';
  return null;
}

export function uploadRecoveryFailMessage(reason: UploadRecoveryBlockReason): string {
  if (reason === 'stale') return '上传任务已过期，请重新上传';
  return '上传已中断，请重新选择文件';
}
