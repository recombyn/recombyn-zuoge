/**
 * Debounced project sync: IndexedDB draft → incremental PATCH (or PUT) for document.
 * Covers are generated on the API from the saved document (≤4 element tiles).
 */

import { useCallback, useEffect, useRef } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import { useTranslation } from 'react-i18next';
import {
  upsertProjectApi,
  patchProjectApi,
  deleteProjectApi,
  deleteProjectsApi,
  fetchProject,
  invalidateProjectsListCache,
  patchProjectSummaryInListCache,
  refetchProjectsListCache,
} from '@/service/projects';
import store from '@/store';
import {
  clearEditorDirty,
  persistCurrent,
  setTemplateThumbnail,
} from '@/store/modules/editor';
import { isOwnedTemplate } from '@/utils/templatesStorage';
import { getToken } from '@/utils/token';
import { getHttpStatus, getHttpErrorBody } from '@/service/client';
import { normalizeProjectThumbnailUrls } from '@/utils/projectThumb';
import {
  buildProjectDocumentPatch,
  deleteProjectDraft,
  deleteProjectDrafts,
  getProjectDraft,
  hashDocument,
  markProjectDraftSynced,
  putProjectDraft,
} from '@/components/editor/projectDraftStore';
import { isCollabCloudPersistOwned } from '@/components/editor/collab/collabRuntime';
import { message } from '@/components/base';

const DEBOUNCE_MS = 800;
/** Coalesce rapid Ctrl/⌘+S into one flush. */
const MANUAL_SAVE_DEBOUNCE_MS = 300;
/** Delete / structural edits should hit the cloud ASAP (refresh must not restore old nodes). */
const FLUSH_NOW_EVENT = 'resume:flush-project';
/**
 * After a failed PUT/PATCH, do not hammer the API every debounce tick.
 * Pause auto-retry for the same document hash once this ladder is exhausted.
 */
const CLOUD_FAIL_BACKOFF_MS = [2_000, 5_000, 15_000, 45_000] as const;

function cloudFailRetryDelayMs(failCount: number): number {
  const idx = Math.max(
    0,
    Math.min(failCount - 1, CLOUD_FAIL_BACKOFF_MS.length - 1)
  );
  return CLOUD_FAIL_BACKOFF_MS[idx];
}

function shouldPauseCloudAutoRetry(failCount: number): boolean {
  return failCount >= CLOUD_FAIL_BACKOFF_MS.length;
}

/** Latest in-flight / queued editor flush — Home awaits this before re-listing projects. */
let flushChain: Promise<void> = Promise.resolve();
let flushRunner: ((opts?: FlushProjectOptions) => Promise<FlushProjectResult>) | null = null;

export type FlushProjectOptions = {
  /**
   * Leave-editor / Home: always push document + regenerate auto cover,
   * even when Redux dirty is false or the local draft looks already synced.
   */
  force?: boolean;
};

/** Outcome of a single flush pass — manual save uses this for user feedback. */
export type FlushProjectResult = 'saved' | 'local' | 'unchanged' | 'failed' | 'conflict' | 'skipped';

/**
 * Force an immediate project sync (document + auto cover) and wait until it settles.
 * Safe to call from Home / leave-editor even when the hook is unmounted.
 */
export function flushCurrentProjectNow(opts?: FlushProjectOptions): Promise<FlushProjectResult> {
  const run = flushRunner;
  if (!run) return Promise.resolve('skipped');
  const next: Promise<FlushProjectResult> = (async () => {
    await flushChain;
    return run(opts);
  })();
  // Keep the queue alive even if one pass fails.
  flushChain = (async () => {
    try {
      await next;
    } catch {
      /* ignore */
    }
  })();
  return next;
}

/** Multi-tab / stale client lost the race — server document is newer. */
export class ProjectRevisionConflictError extends Error {
  projectId: string;
  revision: number;
  updatedAt: number;

  constructor(opts: { projectId: string; revision: number; updatedAt?: number }) {
    super('project_revision_conflict');
    this.name = 'ProjectRevisionConflictError';
    this.projectId = opts.projectId;
    this.revision = opts.revision;
    this.updatedAt = opts.updatedAt || 0;
  }
}

export type CloudAck = {
  revision: number;
  thumbnailUrl?: string | string[] | null;
};

/** Discriminated write outcome — callers branch on `status`, not nested catch. */
export type CloudWriteResult =
  | { status: 'ok'; ack: CloudAck }
  | { status: 'conflict'; conflict: ProjectRevisionConflictError }
  | { status: 'failed' };

function asConflict(err: unknown): ProjectRevisionConflictError | null {
  if (getHttpStatus(err) !== 412) return null;
  const body = getHttpErrorBody(err) as { detail?: unknown } | undefined;
  const detail = body && typeof body === 'object' ? body.detail : undefined;
  const row =
    detail && typeof detail === 'object'
      ? (detail as Record<string, unknown>)
      : null;
  const revision = Number(row?.revision);
  return new ProjectRevisionConflictError({
    projectId: String(row?.id || ''),
    revision: Number.isFinite(revision) && revision >= 1 ? revision : 0,
    updatedAt: Number(row?.updatedAt) || 0,
  });
}

/** Single IO boundary: network throws become a status the caller can judge. */
async function tryCloudApi<T>(fn: () => Promise<T>): Promise<
  | { status: 'ok'; data: T }
  | { status: 'conflict'; conflict: ProjectRevisionConflictError }
  | { status: 'failed' }
> {
  try {
    return { status: 'ok', data: await fn() };
  } catch (err) {
    const conflict =
      err instanceof ProjectRevisionConflictError ? err : asConflict(err);
    if (conflict) return { status: 'conflict', conflict };
    return { status: 'failed' };
  }
}

type ThumbUpload = {
  thumbnailDataUrl?: string;
  thumbnailDataUrls?: string[];
  thumbnailUrls?: string[];
};

function applyThumbUpload(
  data: {
    thumbnailDataUrl?: string | null;
    thumbnailDataUrls?: string[] | null;
    thumbnailUrls?: string[] | null;
  },
  thumb: ThumbUpload
) {
  if (thumb.thumbnailUrls?.length) data.thumbnailUrls = thumb.thumbnailUrls;
  if (thumb.thumbnailDataUrls?.length) data.thumbnailDataUrls = thumb.thumbnailDataUrls;
  if (thumb.thumbnailDataUrl) data.thumbnailDataUrl = thumb.thumbnailDataUrl;
}

function ackThumbnail(
  url: string | string[] | null | undefined,
  version?: number
): string | string[] | null {
  const list = normalizeProjectThumbnailUrls(url, version);
  if (!list.length) return null;
  return list.length === 1 ? list[0] : list;
}

function clearDirtyIfSameDoc(
  dispatch: ReturnType<typeof useDispatch>,
  pushedDoc: unknown
): void {
  const after = store.getState().editor as { document: unknown };
  if (after.document === pushedDoc) dispatch(clearEditorDirty());
}

async function applyCloudAck(opts: {
  dispatch: ReturnType<typeof useDispatch>;
  projectId: string;
  contentHash: string;
  pushedDoc: unknown;
  ack?: CloudAck;
  projectName?: string;
}): Promise<void> {
  const nextThumb = ackThumbnail(opts.ack?.thumbnailUrl, opts.ack?.revision ?? Date.now());
  if (nextThumb) {
    opts.dispatch(
      setTemplateThumbnail({
        id: opts.projectId,
        thumbnail: nextThumb,
        custom: false,
      })
    );
  }
  const ed = store.getState().editor as {
    templates?: { id: string; name?: string }[];
  };
  const tplName =
    opts.projectName ||
    ed.templates?.find((t) => t.id === opts.projectId)?.name ||
    'Untitled';
  const listPatch: Parameters<typeof patchProjectSummaryInListCache>[1] = {
    name: tplName,
    updatedAt: Date.now(),
  };
  if (nextThumb) listPatch.thumbnailUrl = nextThumb;
  if (opts.ack?.revision != null) listPatch.revision = opts.ack.revision;
  patchProjectSummaryInListCache(opts.projectId, listPatch);
  await markProjectDraftSynced(
    opts.projectId,
    opts.contentHash,
    opts.ack?.revision ?? null
  );
  clearDirtyIfSameDoc(opts.dispatch, opts.pushedDoc);
}

export function asCloudRevision(value: unknown): number | null {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 1) return null;
  return Math.floor(n);
}

function isDraftAlreadyAcked(
  draft: { syncedAt?: number | null; contentHash?: string; name?: string } | null | undefined,
  contentHash: string,
  name: string
): boolean {
  return Boolean(
    draft?.syncedAt &&
      draft.contentHash === contentHash &&
      String(draft.name || '') === name
  );
}

function fullPutReason(
  baseDoc: unknown | null,
  baseRevision: number | null,
  preferFull: boolean | undefined
): string {
  if (!baseDoc) return 'missing_baseDocument';
  if (baseRevision == null) return 'missing_baseRevision';
  if (preferFull) return 'preferFull';
  return 'fallback';
}

function ackFromProject(project: {
  revision?: unknown;
  thumbnailUrl?: string | string[] | null;
} | null | undefined): CloudAck | null {
  const revision = asCloudRevision(project?.revision);
  if (revision == null) return null;
  return {
    revision,
    thumbnailUrl: project?.thumbnailUrl ?? null,
  };
}

/** Placeholder until a real conflict dialog lands — keeps EditorPage mount valid. */
export function ProjectRevisionConflictDialog() {
  return null;
}

/** Push one owned project to the API (no-op when logged out). */
export async function pushProjectToCloud(payload: {
  id: string;
  name: string;
  document: unknown;
  thumb?: ThumbUpload;
  baseRevision?: number | null;
}): Promise<CloudWriteResult> {
  if (!getToken()) return { status: 'failed' };
  if (!payload.id || !payload.document) return { status: 'failed' };
  const base = asCloudRevision(payload.baseRevision);
  const data: Parameters<typeof upsertProjectApi>[0] = {
    id: payload.id,
    name: payload.name || 'Untitled',
    document: payload.document as Record<string, unknown>,
    thumbnailCustom: false,
  };
  if (payload.thumb) applyThumbUpload(data, payload.thumb);
  if (base != null) data.baseRevision = base;
  // First cloud write — attach preferred team org when set in Account → Organization.
  if (base == null) {
    try {
      const orgId = localStorage.getItem('recombyn.preferredOrgId')?.trim();
      if (orgId) data.orgId = orgId;
    } catch {
      /* ignore */
    }
  }

  const outcome = await tryCloudApi(() =>
    upsertProjectApi(data, base != null ? { 'If-Match': `"${base}"` } : undefined)
  );
  if (outcome.status !== 'ok') return outcome;
  const ack = ackFromProject(outcome.data?.project);
  if (!ack) return { status: 'failed' };
  return { status: 'ok', ack };
}

/** Incremental node patch — requires a known baseRevision. */
export async function patchProjectToCloud(payload: {
  id: string;
  name: string;
  baseRevision: number;
  patch: NonNullable<ReturnType<typeof buildProjectDocumentPatch>>['patch'];
  thumb?: ThumbUpload;
}): Promise<CloudWriteResult> {
  if (!getToken()) return { status: 'failed' };
  if (!payload.id || !(payload.baseRevision >= 1)) return { status: 'failed' };
  const base = Math.max(1, Math.floor(Number(payload.baseRevision)));
  const data: Parameters<typeof patchProjectApi>[1] = {
    baseRevision: base,
    name: payload.name || 'Untitled',
    thumbnailCustom: false,
  };
  if (payload.thumb) applyThumbUpload(data, payload.thumb);
  if (payload.patch.upsertNodes) {
    data.upsertNodes = payload.patch.upsertNodes as Record<string, unknown>;
  }
  if (payload.patch.removeNodeIds) data.removeNodeIds = payload.patch.removeNodeIds;
  if (payload.patch.pageChildren) data.pageChildren = payload.patch.pageChildren;
  if (payload.patch.frames) data.frames = payload.patch.frames;
  if (payload.patch.activeFrameId !== undefined) {
    data.activeFrameId = payload.patch.activeFrameId;
  }
  if (payload.patch.canvas) data.canvas = payload.patch.canvas;

  const outcome = await tryCloudApi(() =>
    patchProjectApi(payload.id, data, { 'If-Match': `"${base}"` })
  );
  if (outcome.status !== 'ok') return outcome;
  const ack = ackFromProject(outcome.data?.project);
  if (!ack) return { status: 'failed' };
  return { status: 'ok', ack };
}

export async function removeProjectFromCloud(id: string): Promise<void> {
  if (!id) return;
  await deleteProjectDraft(id);
  if (!getToken()) return;
  // Local draft already gone — cloud miss is fine.
  await tryCloudApi(() => deleteProjectApi(id));
}

/** Batch remove owned projects from the API (no-op when logged out). */
export async function removeProjectsFromCloud(ids: string[]): Promise<void> {
  const list = [
    ...new Set((ids || []).map((id) => String(id || '').trim()).filter(Boolean)),
  ];
  if (!list.length) return;
  await deleteProjectDrafts(list);
  if (!getToken()) return;
  await deleteProjectsApi(list);
}

/** Ask the open editor to flush the project to the cloud immediately. */
export function requestProjectFlush() {
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent(FLUSH_NOW_EVENT));
  }
  void flushCurrentProjectNow();
}

/** Rename an owned project on the API (home grid / offline-safe local first). */
export async function renameProjectOnCloud(id: string, name: string): Promise<void> {
  const projectId = String(id || '').trim();
  const nextName = String(name || '').trim() || 'Untitled';
  if (!projectId) return;

  const draft = await getProjectDraft(projectId);
  if (draft?.document) {
    await putProjectDraft({
      projectId,
      name: nextName,
      document: draft.document,
      updatedAt: Date.now(),
      keepSyncedAt: true,
      keepCloudRevision: true,
      keepBaseDocument: true,
    });
  }

  if (!getToken()) return;

  const rev = asCloudRevision(draft?.cloudRevision);
  if (rev != null && draft?.document) {
    const patched = await patchProjectToCloud({
      id: projectId,
      name: nextName,
      baseRevision: rev,
      patch: {},
    });
    if (patched.status === 'ok') {
      await markProjectDraftSynced(
        projectId,
        draft.contentHash,
        patched.ack.revision
      );
      return;
    }
  }

  const fetched = await tryCloudApi(() => fetchProject(projectId));
  if (fetched.status !== 'ok') return;
  const proj = fetched.data.project;
  if (!proj?.document) return;
  const existingUrls = normalizeProjectThumbnailUrls(proj.thumbnailUrl);
  const pushed = await pushProjectToCloud({
    id: projectId,
    name: nextName,
    document: proj.document,
    thumb: existingUrls.length ? { thumbnailUrls: existingUrls } : undefined,
    baseRevision: asCloudRevision(proj.revision),
  });
  if (pushed.status !== 'ok') return;
  await putProjectDraft({
    projectId,
    name: nextName,
    document: proj.document,
    updatedAt: Date.now(),
    syncedAt: Date.now(),
    cloudRevision: asCloudRevision(pushed.ack.revision ?? proj.revision),
    baseDocument: proj.document,
  });
}

/** Prefer incremental PATCH; fall back to full PUT. Callers judge `status`. */
export async function syncOwnedDocumentToCloud(opts: {
  id: string;
  name: string;
  document: unknown;
  baseRevision: number | null;
  baseDoc: unknown | null;
}): Promise<CloudWriteResult> {
  const { id, name, document, baseRevision, baseDoc } = opts;
  const delta =
    baseDoc && baseRevision != null
      ? buildProjectDocumentPatch(baseDoc, document)
      : null;

  if (delta && !delta.preferFull && baseRevision != null) {
    const patched = await patchProjectToCloud({
      id,
      name,
      baseRevision,
      patch: delta.patch,
    });
    if (patched.status !== 'failed') return patched;
    if (import.meta.env.DEV) {
      console.warn('[project-sync] PATCH failed → full PUT');
    }
    return pushProjectToCloud({ id, name, document, baseRevision });
  }

  if (!delta && baseDoc && baseRevision != null) {
    // Document unchanged — still PATCH so renames reach the server (empty delta alone skips).
    const patched = await patchProjectToCloud({
      id,
      name,
      baseRevision,
      patch: {},
    });
    if (patched.status !== 'failed') return patched;
    return pushProjectToCloud({ id, name, document, baseRevision });
  }

  return pushProjectToCloud({ id, name, document, baseRevision });
}

async function handleFlushConflict(opts: {
  projectId: string;
  name: string;
  pushedDoc: unknown;
  conflict: ProjectRevisionConflictError;
}): Promise<void> {
  const serverRev = asCloudRevision(opts.conflict.revision);
  if (serverRev == null) return;
  // Keep the local canvas. Only refresh If-Match — GET+importDocument realigns
  // frameless boolean results to (0,0) and looks like the page jumped.
  await putProjectDraft({
    projectId: opts.projectId,
    name: opts.name,
    document: opts.pushedDoc,
    updatedAt: Date.now(),
    syncedAt: null,
    cloudRevision: serverRev,
    keepBaseDocument: true,
  });
}

const MANUAL_SAVE_TOAST: Partial<
  Record<FlushProjectResult, { level: 'success' | 'error' | 'warning'; key: string }>
> = {
  saved: { level: 'success', key: 'editor.projectSavedOk' },
  local: { level: 'success', key: 'editor.projectSavedLocal' },
  unchanged: { level: 'success', key: 'editor.projectSavedUpToDate' },
  failed: { level: 'error', key: 'editor.projectSaveFailed' },
  conflict: { level: 'warning', key: 'editor.revisionConflictTitle' },
};

function notifyManualSaveResult(result: FlushProjectResult, t: (key: string) => string): void {
  const spec = MANUAL_SAVE_TOAST[result];
  if (!spec) return;
  const text = t(spec.key);
  if (spec.level === 'error') message.error(text);
  else if (spec.level === 'warning') message.warning(text);
  else message.success(text);
}

/** Editor: debounce local draft + cloud upsert while editing. */
export function useProjectCloudSync() {
  const dispatch = useDispatch();
  const { t } = useTranslation();
  const dirty = useSelector((s: any) => Boolean(s.editor.dirty));
  const document = useSelector((s: any) => s.editor.document);
  const currentId = useSelector((s: any) => s.editor.currentId as string | null);
  const template = useSelector((s: any) =>
    s.editor.templates.find((t: any) => t.id === s.editor.currentId)
  );
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const manualSaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const flushingRef = useRef(false);
  /** Delete/edit while a flush is in-flight — run again after current finishes. */
  const pendingFlushRef = useRef(false);
  /** Consecutive cloud write failures for the current document hash. */
  const cloudFailCountRef = useRef(0);
  const cloudFailHashRef = useRef<string | null>(null);
  const dirtyRef = useRef(dirty);
  dirtyRef.current = dirty;

  const scheduleFlush = useCallback((delayMs: number) => {
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      timerRef.current = null;
      void flushCurrentProjectNow();
    }, delayMs);
  }, []);

  const flush = useCallback(async (opts?: FlushProjectOptions): Promise<FlushProjectResult> => {
    // Read Redux directly — requestProjectFlush may fire before this hook re-renders.
    const force = Boolean(opts?.force);
    const ed = store.getState().editor as {
      dirty: boolean;
      document: unknown;
      currentId: string | null;
      templates: any[];
    };
    const id = ed.currentId;
    const tpl = ed.templates.find((t) => t.id === id);
    if ((!ed.dirty && !force) || !ed.document || !id || !tpl) return 'skipped';
    if (id.startsWith('share_') || !isOwnedTemplate(tpl)) return 'skipped';
    if (flushingRef.current) {
      pendingFlushRef.current = true;
      return 'skipped';
    }
    flushingRef.current = true;
    let cloudAttempted = false;
    let cloudOk = false;
    let pauseAutoRetry = false;

    try {
      dispatch(persistCurrent({ keepDirty: true }));
      const pushedDoc = (store.getState().editor as { document: unknown }).document;
      const name = String(tpl.name || 'Untitled');
      const draft = await putProjectDraft({
        projectId: id,
        name,
        document: pushedDoc,
        updatedAt: Date.now(),
        keepSyncedAt: true,
        keepCloudRevision: true,
        keepBaseDocument: true,
      });
      const contentHash = draft?.contentHash || hashDocument(pushedDoc);

      // New edits unlock a previously paused failure streak.
      if (cloudFailHashRef.current && cloudFailHashRef.current !== contentHash) {
        cloudFailCountRef.current = 0;
        cloudFailHashRef.current = null;
      }

      if (!force && isDraftAlreadyAcked(draft, contentHash, name)) {
        clearDirtyIfSameDoc(dispatch, pushedDoc);
        return 'unchanged';
      }
      if (!getToken()) {
        clearDirtyIfSameDoc(dispatch, pushedDoc);
        return 'local';
      }
      if (isCollabCloudPersistOwned() && !force) {
        clearDirtyIfSameDoc(dispatch, pushedDoc);
        return 'skipped';
      }

      // Same doc already failed the backoff ladder — wait for edits or force save.
      if (
        !force &&
        shouldPauseCloudAutoRetry(cloudFailCountRef.current) &&
        cloudFailHashRef.current === contentHash
      ) {
        pauseAutoRetry = true;
        return 'failed';
      }

      cloudAttempted = true;
      const written = await syncOwnedDocumentToCloud({
        id,
        name,
        document: pushedDoc,
        baseRevision: asCloudRevision(draft?.cloudRevision),
        baseDoc: draft?.baseDocument ?? null,
      });
      if (written.status === 'ok') {
        cloudOk = true;
        cloudFailCountRef.current = 0;
        cloudFailHashRef.current = null;
        await applyCloudAck({
          dispatch,
          projectId: id,
          contentHash,
          pushedDoc,
          ack: written.ack,
          projectName: name,
        });
        return 'saved';
      }
      if (written.status === 'conflict') {
        cloudFailCountRef.current = 0;
        cloudFailHashRef.current = null;
        await handleFlushConflict({
          projectId: id,
          name,
          pushedDoc,
          conflict: written.conflict,
        });
        return 'conflict';
      }
      cloudFailCountRef.current += 1;
      cloudFailHashRef.current = contentHash;
      if (shouldPauseCloudAutoRetry(cloudFailCountRef.current)) {
        pauseAutoRetry = true;
      }
      if (import.meta.env.DEV) {
        console.warn('[project-sync] cloud write failed', {
          id,
          fails: cloudFailCountRef.current,
          paused: pauseAutoRetry,
        });
      }
      return 'failed';
    } catch {
      return 'failed';
    } finally {
      flushingRef.current = false;
      const still = store.getState().editor as { dirty: boolean; currentId: string | null };
      const queued = pendingFlushRef.current;
      pendingFlushRef.current = false;
      // No `return` in finally — eslint no-unsafe-finally.
      if (still.currentId === id) {
        if (queued) {
          scheduleFlush(0);
        } else if (still.dirty && !pauseAutoRetry) {
          if (cloudAttempted && !cloudOk && cloudFailCountRef.current > 0) {
            scheduleFlush(cloudFailRetryDelayMs(cloudFailCountRef.current));
          } else {
            scheduleFlush(DEBOUNCE_MS);
          }
        }
      }
    }
  }, [dispatch, scheduleFlush]);

  flushRunner = flush;

  useEffect(() => {
    if (!dirty || !document || !currentId || !template) return;
    if (String(currentId).startsWith('share_')) return;
    if (!isOwnedTemplate(template)) return;
    scheduleFlush(DEBOUNCE_MS);
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [dirty, document, currentId, template, scheduleFlush]);

  // Clear debounce timers only — requestProjectFlush owns the single flush enqueue.
  useEffect(() => {
    const onFlushNow = () => {
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = null;
      if (manualSaveTimerRef.current) clearTimeout(manualSaveTimerRef.current);
      manualSaveTimerRef.current = null;
    };
    window.addEventListener(FLUSH_NOW_EVENT, onFlushNow);
    return () => window.removeEventListener(FLUSH_NOW_EVENT, onFlushNow);
  }, []);

  // Ctrl/⌘+S — manual save (debounced so key-repeat / rapid presses don't spam).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey) || e.altKey || e.shiftKey) return;
      if (e.key.toLowerCase() !== 's') return;
      e.preventDefault();
      if (manualSaveTimerRef.current) clearTimeout(manualSaveTimerRef.current);
      manualSaveTimerRef.current = setTimeout(() => {
        manualSaveTimerRef.current = null;
        if (timerRef.current) clearTimeout(timerRef.current);
        timerRef.current = null;
        void flushCurrentProjectNow({ force: true }).then((result) => {
          notifyManualSaveResult(result, t);
        });
      }, MANUAL_SAVE_DEBOUNCE_MS);
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
      if (manualSaveTimerRef.current) clearTimeout(manualSaveTimerRef.current);
      manualSaveTimerRef.current = null;
    };
  }, [t]);

  // Leave / hide: force doc + cover once (not every debounce). Unmount same.
  useEffect(() => {
    const onHide = () => {
      if (!dirtyRef.current) return;
      void flushCurrentProjectNow({ force: true });
    };
    const onVisibility = () => {
      if (window.document.visibilityState === 'hidden') onHide();
    };
    window.addEventListener('pagehide', onHide);
    window.document.addEventListener('visibilitychange', onVisibility);
    return () => {
      window.removeEventListener('pagehide', onHide);
      window.document.removeEventListener('visibilitychange', onVisibility);
      void (async () => {
        try {
          await flushCurrentProjectNow({ force: true });
        } finally {
          await invalidateProjectsListCache();
          await refetchProjectsListCache();
        }
      })();
    };
  }, []);
}

/** Placeholder until a real conflict dialog lands — keeps EditorPage mount valid. */
export async function applyProjectRevisionConflictChoice(_opts: {
  dispatch: (action: unknown) => unknown;
  projectId: string;
  name: string;
  localDocument?: unknown;
  mode?: 'solo' | 'collab';
  thumb?: ThumbUpload;
}): Promise<'adopted' | 'failed'> {
  return 'failed';
}

