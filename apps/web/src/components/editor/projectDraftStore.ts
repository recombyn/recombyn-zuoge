import type { SceneDocument } from '@/components/rcb/sceneNode';
/**
 * Local project drafts + editor session (persistenceKey → IndexedDB).
 * Document drafts may sync to cloud; session (camera / selection) stays local only.
 */

const DB_NAME = 'rcb-project-drafts';
const DB_VERSION = 2;
const STORE_DRAFTS = 'drafts';
const STORE_SESSIONS = 'sessions';

/** One persistence key per document. */
export function projectPersistenceKey(projectId: string): string {
  return `rcb-project:${String(projectId || '').trim()}`;
}

/** Local-only viewport / selection — never PUT to cloud. */
export function projectSessionKey(projectId: string): string {
  return `rcb-session:${String(projectId || '').trim()}`;
}

export type ProjectDraftRecord = {
  /** IndexedDB primary key (= persistence key). */
  persistenceKey: string;
  projectId: string;
  name: string;
  document: unknown;
  updatedAt: number;
  /** FNV-ish fingerprint of document JSON — skip cloud PUT when unchanged. */
  contentHash: string;
  /** Last successful cloud ACK time (ms), if any. */
  syncedAt: number | null;
  /** Last known cloud optimistic-lock revision (If-Match / baseRevision). */
  cloudRevision?: number | null;
  /**
   * Last cloud-acked document snapshot for incremental PATCH diffs.
   * Cleared / replaced on full sync success; preserved across dirty writes.
   */
  baseDocument?: unknown | null;
};

export type ProjectSessionCamera = { x: number; y: number; zoom: number };

export type ProjectSessionRecord = {
  persistenceKey: string;
  projectId: string;
  camera: ProjectSessionCamera;
  selectedNodeIds: string[];
  selectedFrameIds: string[];
  /** Local grid preference — never synced to cloud. */
  isGridMode?: boolean;
  updatedAt: number;
};

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('indexedDB unavailable'));
      return;
    }
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onerror = () => reject(req.error || new Error('idb open failed'));
    req.onsuccess = () => resolve(req.result);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_DRAFTS)) {
        db.createObjectStore(STORE_DRAFTS, { keyPath: 'persistenceKey' });
      }
      if (!db.objectStoreNames.contains(STORE_SESSIONS)) {
        db.createObjectStore(STORE_SESSIONS, { keyPath: 'persistenceKey' });
      }
    };
  });
}

function idbReq<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error || new Error('idb request failed'));
  });
}

function fnv1aUpdate(h: number, s: string): number {
  let next = h;
  for (let i = 0; i < s.length; i += 1) {
    next ^= s.charCodeAt(i);
    next = Math.imul(next, 16777619);
  }
  return next;
}

function fnv1aFinish(h: number, approxLen: number): string {
  return `${(h >>> 0).toString(36)}:${approxLen}`;
}

/**
 * Stream-hash a scene document without `JSON.stringify` of the whole tree.
 * Full stringify froze paste/autosave at 2k–10k nodes (multi-MB strings).
 */
function hashSceneDocument(doc: SceneDocument): string {
  let h = 2166136261;
  let approxLen = 64;
  const meta = [
    String(doc.width ?? ''),
    String(doc.height ?? ''),
    String(doc.backgroundColor ?? ''),
    String(doc.activeFrameId ?? ''),
    String(doc.coordSpace ?? ''),
    String(doc.gridSize ?? ''),
  ].join('\0');
  h = fnv1aUpdate(h, meta);
  approxLen += meta.length;

  const frames = Array.isArray(doc.frames) ? doc.frames : [];
  h = fnv1aUpdate(h, `f:${frames.length}`);
  for (const f of frames) {
    if (!f || typeof f !== 'object') continue;
    const row = `${f.id}\0${f.x}\0${f.y}\0${f.width}\0${f.height}\0${f.kind ?? ''}`;
    h = fnv1aUpdate(h, row);
    approxLen += row.length;
  }

  const order = Array.isArray(doc.stackOrder) ? doc.stackOrder : [];
  h = fnv1aUpdate(h, `o:${order.length}`);
  for (let i = 0; i < order.length; i += 1) {
    h = fnv1aUpdate(h, String(order[i] ?? ''));
  }
  approxLen += order.length * 8;

  const delta = doc.deltaSetLike && typeof doc.deltaSetLike === 'object' ? doc.deltaSetLike : {};
  // Order-independent mix — avoid Object.keys().sort() on 10k ids (autosave/paste).
  let nodeCount = 0;
  for (const id of Object.keys(delta)) {
    nodeCount += 1;
    const node = delta[id] as
      | {
          key?: unknown;
          x?: unknown;
          y?: unknown;
          width?: unknown;
          height?: unknown;
          attrs?: Record<string, unknown>;
        }
      | null
      | undefined;
    if (!node || typeof node !== 'object') {
      h = (h ^ fnv1aUpdate(2166136261, id)) >>> 0;
      continue;
    }
    const attrs = node.attrs;
    const row = [
      id,
      String(node.key ?? ''),
      String(node.x ?? ''),
      String(node.y ?? ''),
      String(node.width ?? ''),
      String(node.height ?? ''),
      String(attrs?.frameId ?? ''),
      String(attrs?.frameOrder ?? ''),
      String(attrs?.['fill-color'] ?? attrs?.fill ?? ''),
      String(attrs?.shapeType ?? ''),
    ].join('\0');
    h = (h ^ fnv1aUpdate(2166136261, row)) >>> 0;
    approxLen += row.length;
  }
  h = fnv1aUpdate(h, `n:${nodeCount}`);
  approxLen += nodeCount * 8;
  return fnv1aFinish(h, approxLen);
}

/** Cheap stable fingerprint for skip-upload (not cryptographic). */
export function hashDocument(document: unknown): string {
  if (
    document &&
    typeof document === 'object' &&
    document !== null &&
    'deltaSetLike' in document
  ) {
    return hashSceneDocument(document as SceneDocument);
  }
  let s = '';
  try {
    s = JSON.stringify(document) || '';
  } catch {
    s = String(document);
  }
  return fnv1aFinish(fnv1aUpdate(2166136261, s), s.length);
}

const CANVAS_META_KEYS = [
  'x',
  'y',
  'width',
  'height',
  'gridSize',
  'backgroundColor',
  'backgroundFillType',
  'backgroundGradient',
  'backgroundOpacity',
  'backgroundImageSrc',
  'backgroundImageFit',
  'backgroundImageRotate',
  'backgroundImageAdjust',
] as const;

export type ProjectDocumentPatch = {
  upsertNodes?: Record<string, unknown>;
  removeNodeIds?: string[];
  pageChildren?: string[];
  frames?: unknown[];
  activeFrameId?: string | null;
  canvas?: Record<string, unknown>;
};

function pageChildrenOf(doc: SceneDocument): string[] {
  const pages = doc?.pages;
  if (Array.isArray(pages) && pages[0] && Array.isArray(pages[0].children)) {
    return pages[0].children.map(String);
  }
  const rootKids = doc?.deltaSetLike?.ROOT?.children;
  return Array.isArray(rootKids) ? rootKids.map(String) : [];
}

function stableJson(value: unknown): string {
  try {
    return JSON.stringify(value) ?? '';
  } catch {
    return '';
  }
}

/**
 * Diff `base` → `next` into a node-level cloud patch.
 * Returns null when identical; `preferFull` when the delta is too large for PATCH.
 */
export function buildProjectDocumentPatch(
  base: unknown,
  next: unknown
): { patch: ProjectDocumentPatch; preferFull: boolean } | null {
  if (!next || typeof next !== 'object') return null;
  if (!base || typeof base !== 'object') {
    return { patch: {}, preferFull: true };
  }
  const b = base as Record<string, any>;
  const n = next as Record<string, any>;
  const baseDelta = (b.deltaSetLike && typeof b.deltaSetLike === 'object'
    ? b.deltaSetLike
    : {}) as Record<string, unknown>;
  const nextDelta = (n.deltaSetLike && typeof n.deltaSetLike === 'object'
    ? n.deltaSetLike
    : {}) as Record<string, unknown>;

  const upsertNodes: Record<string, unknown> = {};
  const removeNodeIds: string[] = [];

  for (const id of Object.keys(nextDelta)) {
    if (id === 'ROOT') continue;
    const a = baseDelta[id];
    const c = nextDelta[id];
    // Same Immer ref ⇒ unchanged (skip stringify).
    if (a === c) continue;
    if (a === undefined || stableJson(a) !== stableJson(c)) {
      upsertNodes[id] = c;
    }
  }
  for (const id of Object.keys(baseDelta)) {
    if (id === 'ROOT') continue;
    if (!(id in nextDelta)) removeNodeIds.push(id);
  }

  const patch: ProjectDocumentPatch = {};
  if (Object.keys(upsertNodes).length) patch.upsertNodes = upsertNodes;
  if (removeNodeIds.length) patch.removeNodeIds = removeNodeIds;

  const baseKids = pageChildrenOf(b as SceneDocument);
  const nextKids = pageChildrenOf(n as SceneDocument);
  if (stableJson(baseKids) !== stableJson(nextKids)) {
    patch.pageChildren = nextKids;
  }

  if (stableJson(b.frames ?? []) !== stableJson(n.frames ?? [])) {
    patch.frames = Array.isArray(n.frames) ? n.frames : [];
  }

  const baseAf = b.activeFrameId ?? null;
  const nextAf = n.activeFrameId ?? null;
  if (String(baseAf ?? '') !== String(nextAf ?? '')) {
    patch.activeFrameId = nextAf == null ? null : String(nextAf);
  }

  const canvas: Record<string, unknown> = {};
  for (const key of CANVAS_META_KEYS) {
    if (stableJson(b[key]) !== stableJson(n[key])) {
      canvas[key] = n[key];
    }
  }
  if (Object.keys(canvas).length) patch.canvas = canvas;

  if (
    !patch.upsertNodes &&
    !patch.removeNodeIds &&
    !patch.pageChildren &&
    !patch.frames &&
    !('activeFrameId' in patch) &&
    !patch.canvas
  ) {
    return null;
  }

  const nodeCount = Math.max(
    1,
    Object.keys(nextDelta).filter((id) => id !== 'ROOT').length
  );
  const changed =
    Object.keys(upsertNodes).length + removeNodeIds.length;
  const patchBytes = stableJson(patch).length;
  const fullBytes = Math.max(1, stableJson(next).length);
  // Byte-ratio vs the whole doc is useless on small canvases: a 2-shape boolean
  // PATCH is already most of the JSON, so 0.6 * full forced PUT every save.
  // Prefer PUT only when the delta is a large fraction of a large graph, or
  // when the patch payload is strictly bigger than a full replace.
  const preferFull =
    changed > Math.max(24, Math.ceil(nodeCount * 0.35)) || patchBytes > fullBytes;

  return { patch, preferFull };
}

export async function putProjectDraft(input: {
  projectId: string;
  name: string;
  document: unknown;
  updatedAt?: number;
  syncedAt?: number | null;
  keepSyncedAt?: boolean;
  cloudRevision?: number | null;
  keepCloudRevision?: boolean;
  baseDocument?: unknown | null;
  keepBaseDocument?: boolean;
}): Promise<ProjectDraftRecord | null> {
  const projectId = String(input.projectId || '').trim();
  if (!projectId || input.document == null) return null;
  const persistenceKey = projectPersistenceKey(projectId);
  const contentHash = hashDocument(input.document);
  const updatedAt = Number(input.updatedAt) || Date.now();

  try {
    const db = await openDb();
    const tx = db.transaction(STORE_DRAFTS, 'readwrite');
    const store = tx.objectStore(STORE_DRAFTS);
    const prev = (await idbReq(store.get(persistenceKey))) as ProjectDraftRecord | undefined;

    let syncedAt: number | null =
      input.syncedAt !== undefined ? input.syncedAt : null;
    const nextName = String(input.name || 'Untitled');
    const prevName = String(prev?.name || 'Untitled');
    const nameSame = !prev || prevName === nextName;
    if (input.keepSyncedAt && prev) {
      // Name-only edits must invalidate sync so cloud flush still PUTs/PATCHes.
      syncedAt =
        prev.contentHash === contentHash && nameSame ? prev.syncedAt : null;
    } else if (input.syncedAt === undefined && prev?.contentHash === contentHash) {
      syncedAt = nameSame ? prev.syncedAt : null;
    }

    let cloudRevision: number | null | undefined = input.cloudRevision;
    if (input.keepCloudRevision && prev) {
      cloudRevision = prev.cloudRevision ?? null;
    } else if (cloudRevision === undefined) {
      cloudRevision = prev?.cloudRevision ?? null;
    }

    let baseDocument: unknown | null | undefined = input.baseDocument;
    if (input.keepBaseDocument && prev) {
      // Freeze last ACKed (or last persisted) doc when content diverges so PATCH can diff.
      // Do not require syncedAt — otherwise a pending draft with cloudRevision but no
      // baseDocument forces a full PUT on every edit.
      if (prev.contentHash !== contentHash) {
        baseDocument =
          prev.baseDocument !== undefined && prev.baseDocument !== null
            ? prev.baseDocument
            : prev.document;
      } else {
        baseDocument = prev.baseDocument ?? null;
      }
    } else if (baseDocument === undefined) {
      baseDocument = prev?.baseDocument ?? null;
    }

    const record: ProjectDraftRecord = {
      persistenceKey,
      projectId,
      name: nextName,
      document: input.document,
      updatedAt,
      contentHash,
      syncedAt,
      cloudRevision: cloudRevision ?? null,
      baseDocument: baseDocument ?? null,
    };

    await idbReq(store.put(record));
    db.close();
    return record;
  } catch {
    return null;
  }
}

/** New / duplicated / imported project — local draft only until cloud flush. */
export function writeUnsyncedProjectDraft(
  projectId: string,
  name: string,
  document: unknown
) {
  void putProjectDraft({
    projectId,
    name,
    document,
    updatedAt: Date.now(),
    syncedAt: null,
    cloudRevision: null,
    baseDocument: null,
  });
}

export async function getProjectDraft(
  projectId: string
): Promise<ProjectDraftRecord | null> {
  const id = String(projectId || '').trim();
  if (!id) return null;
  try {
    const db = await openDb();
    const row = await idbReq(
      db
        .transaction(STORE_DRAFTS, 'readonly')
        .objectStore(STORE_DRAFTS)
        .get(projectPersistenceKey(id))
    );
    db.close();
    return (row as ProjectDraftRecord) || null;
  } catch {
    return null;
  }
}

export async function markProjectDraftSynced(
  projectId: string,
  contentHash: string,
  cloudRevision?: number | null
): Promise<void> {
  const id = String(projectId || '').trim();
  if (!id || !contentHash) return;
  try {
    const db = await openDb();
    const tx = db.transaction(STORE_DRAFTS, 'readwrite');
    const store = tx.objectStore(STORE_DRAFTS);
    const draft = (await idbReq(
      store.get(projectPersistenceKey(id))
    )) as ProjectDraftRecord | undefined;
    if (!draft) {
      db.close();
      return;
    }
    if (draft.contentHash !== contentHash) {
      // ACK still advanced the server revision; this draft is a newer local edit
      // (boolean / delete during the in-flight PUT). Keep it unsynced but store
      // the new If-Match so the follow-up write is not 412.
      const nextRev =
        cloudRevision !== undefined ? cloudRevision : draft.cloudRevision ?? null;
      if (nextRev != null && nextRev !== (draft.cloudRevision ?? null)) {
        await idbReq(
          store.put({
            ...draft,
            cloudRevision: nextRev,
            syncedAt: null,
          })
        );
      }
      db.close();
      return;
    }
    const record: ProjectDraftRecord = {
      ...draft,
      syncedAt: Date.now(),
      cloudRevision:
        cloudRevision !== undefined ? cloudRevision : draft.cloudRevision ?? null,
      // After ACK, live document is the new diff base.
      baseDocument: draft.document,
    };
    await idbReq(store.put(record));
    db.close();
  } catch {
    /* ignore */
  }
}

export async function deleteProjectDraft(projectId: string): Promise<void> {
  const id = String(projectId || '').trim();
  if (!id) return;
  try {
    const db = await openDb();
    const tx = db.transaction([STORE_DRAFTS, STORE_SESSIONS], 'readwrite');
    tx.objectStore(STORE_DRAFTS).delete(projectPersistenceKey(id));
    tx.objectStore(STORE_SESSIONS).delete(projectSessionKey(id));
    await new Promise<void>((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error || new Error('idb delete failed'));
    });
    db.close();
  } catch {
    /* ignore */
  }
}

export async function deleteProjectDrafts(projectIds: string[]): Promise<void> {
  await Promise.all(projectIds.map((id) => deleteProjectDraft(id)));
}

/** Wipe every local draft + editor session (logout). */
export async function clearAllProjectDrafts(): Promise<void> {
  try {
    const db = await openDb();
    const tx = db.transaction([STORE_DRAFTS, STORE_SESSIONS], 'readwrite');
    tx.objectStore(STORE_DRAFTS).clear();
    tx.objectStore(STORE_SESSIONS).clear();
    await new Promise<void>((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error || new Error('idb clear failed'));
    });
    db.close();
  } catch {
    /* ignore */
  }
}

function normalizeCamera(raw: unknown): ProjectSessionCamera | null {
  if (!raw || typeof raw !== 'object') return null;
  const c = raw as Record<string, unknown>;
  const x = Number(c.x);
  const y = Number(c.y);
  const zoom = Number(c.zoom);
  if (![x, y, zoom].every((n) => Number.isFinite(n))) return null;
  if (!(zoom > 0.01) || zoom > 64) return null;
  return { x, y, zoom };
}

export async function putProjectSession(input: {
  projectId: string;
  camera: ProjectSessionCamera;
  selectedNodeIds?: string[];
  selectedFrameIds?: string[];
  isGridMode?: boolean;
}): Promise<ProjectSessionRecord | null> {
  const projectId = String(input.projectId || '').trim();
  const camera = normalizeCamera(input.camera);
  if (!projectId || !camera) return null;
  const persistenceKey = projectSessionKey(projectId);
  const record: ProjectSessionRecord = {
    persistenceKey,
    projectId,
    camera,
    selectedNodeIds: (input.selectedNodeIds || []).map(String).filter(Boolean),
    selectedFrameIds: (input.selectedFrameIds || []).map(String).filter(Boolean),
    isGridMode: Boolean(input.isGridMode),
    updatedAt: Date.now(),
  };
  try {
    const db = await openDb();
    await idbReq(
      db.transaction(STORE_SESSIONS, 'readwrite').objectStore(STORE_SESSIONS).put(record)
    );
    db.close();
    return record;
  } catch {
    return null;
  }
}

export async function getProjectSession(
  projectId: string
): Promise<ProjectSessionRecord | null> {
  const id = String(projectId || '').trim();
  if (!id) return null;
  try {
    const db = await openDb();
    const row = await idbReq(
      db
        .transaction(STORE_SESSIONS, 'readonly')
        .objectStore(STORE_SESSIONS)
        .get(projectSessionKey(id))
    );
    db.close();
    const rec = row as ProjectSessionRecord | undefined;
    if (!rec?.camera) return null;
    const camera = normalizeCamera(rec.camera);
    if (!camera) return null;
    return { ...rec, camera };
  } catch {
    return null;
  }
}
