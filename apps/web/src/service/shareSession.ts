import type { ShareDto } from '@/models/shares';
import { apiClient } from '@/service/client';

const STORAGE_KEY = 'rcb:share-record-by-project';

function loadPersistedShares(): Map<string, ShareDto> {
  if (typeof sessionStorage === 'undefined') return new Map();
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return new Map();
    const obj = JSON.parse(raw) as Record<string, ShareDto>;
    return new Map(Object.entries(obj));
  } catch {
    return new Map();
  }
}

function persistShares(map: Map<string, ShareDto>): void {
  if (typeof sessionStorage === 'undefined') return;
  try {
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(Object.fromEntries(map)));
  } catch {
    /* quota / private mode */
  }
}

const shareRecordByProjectId = loadPersistedShares();
const createShareInflightByProjectId = new Map<string, Promise<{ share: ShareDto }>>();

export function getCachedShareRecord(projectId: string): ShareDto | undefined {
  const id = String(projectId || '').trim();
  return id ? shareRecordByProjectId.get(id) : undefined;
}

export function cacheShareRecord(projectId: string, share: ShareDto): void {
  const id = String(projectId || '').trim();
  if (!id) return;
  shareRecordByProjectId.set(id, share);
  persistShares(shareRecordByProjectId);
}

export function isLinkedProjectShare(
  share: ShareDto | null | undefined,
  projectId?: string | null
): boolean {
  const src = String(share?.sourceProjectId || projectId || '').trim();
  return Boolean(src);
}

export async function syncShareDocument(
  shareId: string,
  document: unknown
): Promise<void> {
  const sid = String(shareId || '').trim();
  if (!sid || document == null || typeof document !== 'object') return;
  await apiClient.sharesSharesUpdateDocument({
    params: { share_id: sid },
    body: { document: document as Record<string, unknown> },
  });
}

export function syncShareDocumentQuiet(shareId: string, document: unknown): void {
  void syncShareDocument(shareId, document).catch(() => {});
}

export type EnsureShareRecordInput = {
  projectId: string;
  projectName: string;
  document: unknown;
  sourceProjectId?: string;
};

export async function ensureShareRecord(
  input: EnsureShareRecordInput
): Promise<{ share: ShareDto }> {
  const projectId = String(input.projectId || input.sourceProjectId || '').trim();
  const linked = Boolean(String(input.sourceProjectId || projectId || '').trim());

  const cached = projectId ? shareRecordByProjectId.get(projectId) : undefined;
  if (cached) {
    return { share: cached };
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
    if (linked) {
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
    if (projectId) cacheShareRecord(projectId, res.share);
    if (!linked) syncShareDocumentQuiet(res.share.id, input.document);
    return { share: res.share };
  } finally {
    createShareInflightByProjectId.delete(inflightKey);
  }
}

export function prefetchShareRecord(input: EnsureShareRecordInput): void {
  if (!input.projectId && !input.sourceProjectId) return;
  void ensureShareRecord(input).catch(() => {});
}
