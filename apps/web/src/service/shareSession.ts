/**
 * Share dialog session — reuse share rows per project, dedupe in-flight creates.
 */

import type { ShareDto } from '@/models/shares';
import { apiClient } from '@/service/client';

const shareRecordByProjectId = new Map<string, ShareDto>();
const createShareInflightByProjectId = new Map<string, Promise<{ share: ShareDto }>>();

export function getCachedShareRecord(projectId: string): ShareDto | undefined {
  const id = String(projectId || '').trim();
  return id ? shareRecordByProjectId.get(id) : undefined;
}

export function cacheShareRecord(projectId: string, share: ShareDto): void {
  const id = String(projectId || '').trim();
  if (id) shareRecordByProjectId.set(id, share);
}

/** Sync latest editor document to an existing share row (non-blocking). */
export function syncShareDocumentQuiet(shareId: string, document: unknown): void {
  const sid = String(shareId || '').trim();
  if (!sid || document == null || typeof document !== 'object') return;
  void apiClient
    .sharesSharesUpdateDocument({
      params: { share_id: sid },
      body: { document: document as Record<string, unknown> },
    })
    .catch(() => {});
}

export type EnsureShareRecordInput = {
  projectId: string;
  projectName: string;
  /** Latest editor document — synced in background after fast create. */
  document: unknown;
  sourceProjectId?: string;
};

/**
 * Ensure a share row exists for this project.
 * When `sourceProjectId` is set, create uses server-side project document (fast).
 */
export async function ensureShareRecord(
  input: EnsureShareRecordInput
): Promise<{ share: ShareDto; fromCache: boolean }> {
  const projectId = String(input.projectId || input.sourceProjectId || '').trim();
  const cached = projectId ? shareRecordByProjectId.get(projectId) : undefined;
  if (cached) {
    syncShareDocumentQuiet(cached.id, input.document);
    return { share: cached, fromCache: true };
  }

  const inflightKey = projectId || '__no_project__';
  let inflight = createShareInflightByProjectId.get(inflightKey);
  if (!inflight) {
    const src = String(input.sourceProjectId || projectId || '').trim() || undefined;
    const body: Record<string, unknown> = {
      name: input.projectName,
      permission: 'preview',
      sourceProjectId: src,
      editorUserIds: [],
      viewerUserIds: [],
      linkPublic: true,
    };
    // Owned cloud project → server loads document from DB (no multi-MB upload).
    if (src) {
      body.document = {};
    } else if (input.document != null && typeof input.document === 'object') {
      body.document = input.document as Record<string, unknown>;
    } else {
      body.document = {};
    }
    inflight = apiClient.sharesSharesCreate({ body: body as never }) as Promise<{
      share: ShareDto;
    }>;
    createShareInflightByProjectId.set(inflightKey, inflight);
  }

  try {
    const res = await inflight;
    if (projectId) shareRecordByProjectId.set(projectId, res.share);
    syncShareDocumentQuiet(res.share.id, input.document);
    return { share: res.share, fromCache: false };
  } finally {
    createShareInflightByProjectId.delete(inflightKey);
  }
}

/** Fire-and-forget before the dialog opens so the first paint is often instant. */
export function prefetchShareRecord(input: EnsureShareRecordInput): void {
  if (!input.document || typeof input.document !== 'object') return;
  void ensureShareRecord(input).catch(() => {});
}
