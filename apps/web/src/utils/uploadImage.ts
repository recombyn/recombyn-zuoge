/**
 * Upload helpers shared across editor / home (FormData, preview, COS key resolve).
 * HTTP endpoints live in `@/service/upload`.
 */

import {
  deleteUploadedFile as deleteUploadedFileApi,
  type UploadedFileItem,
} from '@/service/upload';
import { uploadFileViaJob, dispatchUploadJobCreated } from '@/service/uploadJobs';
import { resolveApiUrl } from '@/utils/apiBase';
import { getToken } from '@/utils/token';

/** In-flight canvas placeholder uploads 鈥?delete node 鈫?abort. */
const nodeUploadAborts = new Map<string, AbortController>();

/** Start (or replace) an abortable upload tied to a canvas node id. */
export function beginNodeUpload(nodeId: string): AbortSignal {
  const id = String(nodeId || '').trim();
  if (!id) return new AbortController().signal;
  abortNodeUpload(id);
  const ac = new AbortController();
  nodeUploadAborts.set(id, ac);
  return ac.signal;
}

/** Cancel upload for a deleted / dismissed placeholder node. */
export function abortNodeUpload(nodeId: string | null | undefined): void {
  const id = String(nodeId || '').trim();
  if (!id) return;
  const ac = nodeUploadAborts.get(id);
  if (!ac) return;
  nodeUploadAborts.delete(id);
  try {
    ac.abort();
  } catch {
    /* ignore */
  }
}

export function finishNodeUpload(nodeId: string | null | undefined): void {
  const id = String(nodeId || '').trim();
  if (!id) return;
  nodeUploadAborts.delete(id);
}

export function hasActiveNodeUpload(nodeId: string | null | undefined): boolean {
  const id = String(nodeId || '').trim();
  return id ? nodeUploadAborts.has(id) : false;
}

export function isUploadAbortError(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false;
  const e = err as { name?: string; code?: string; message?: string };
  return (
    e.name === 'CanceledError' ||
    e.name === 'AbortError' ||
    e.code === 'ERR_CANCELED' ||
    /abort|cancel/i.test(String(e.message || ''))
  );
}

/** Upload a single image/video and return its public/display URL. */
export async function uploadImageFile(
  file: File,
  opts?: {
    signal?: AbortSignal;
    onJobCreated?: (jobId: string) => void;
    jobId?: string;
    dispatch?: (action: unknown) => unknown;
    nodeId?: string;
  }
): Promise<UploadedFileItem> {
  const nodeId = String(opts?.nodeId || '').trim();
  const onJobCreated =
    opts?.onJobCreated ??
    (opts?.dispatch && nodeId
      ? (jobId: string) => dispatchUploadJobCreated(opts.dispatch!, nodeId, jobId)
      : undefined);

  return uploadFileViaJob(file, {
    signal: opts?.signal,
    jobId: opts?.jobId,
    onJobCreated,
  });
}

/** Delete a previously uploaded object by storage key (no-op when logged out / empty). */
export async function deleteUploadedFile(key: string | null | undefined): Promise<void> {
  const objectKey = String(key || '').trim().replace(/^\/+/, '');
  if (!objectKey || !getToken()) return;
  const path = objectKey
    .split('/')
    .filter(Boolean)
    .map(encodeURIComponent)
    .join('/');
  await deleteUploadedFileApi(path);
}

/**
 * Agent composer attach: upload to server, keep a local preview for thumbnails
 * (local `/api/v1/uploads/files/鈥 URLs need auth and cannot be used in `<img src>`).
 */
export async function uploadComposerAttachment(
  file: File,
  opts?: { previewDataUrl?: string }
): Promise<{
  uploadKey: string;
  url: string;
  imageRef: string;
  previewDataUrl: string;
  name: string;
}> {
  const previewDataUrl =
    String(opts?.previewDataUrl || '').trim() || (await readFileAsDataUrl(file));
  const uploaded = await uploadImageFile(file);
  const url = String(uploaded.url || '').trim();
  const uploadKey = String(uploaded.key || '').trim();
  if (!uploadKey) throw new Error('upload returned no key');
  const imageRef =
    url.startsWith('http://') || url.startsWith('https://') ? url : previewDataUrl;
  return {
    uploadKey,
    url,
    imageRef,
    previewDataUrl,
    name: String(uploaded.name || file.name || 'image'),
  };
}

export function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = String(reader.result || '');
      if (!result) reject(new Error('empty file preview'));
      else resolve(result);
    };
    reader.onerror = () => reject(new Error('failed to read image file'));
    reader.readAsDataURL(file);
  });
}

/**
 * Wait until a remote/local URL is fully loaded + decoded before swapping off a
 * local data:/blob: preview (avoids blank flash right after upload succeeds).
 * Returns false if load failed or aborted 鈥?caller should keep the local preview.
 */
export function waitForImageReady(
  src: string,
  opts?: { signal?: AbortSignal }
): Promise<boolean> {
  const url = String(src || '').trim();
  if (!url) return Promise.resolve(false);
  // Already local 鈥?nothing to wait for.
  if (url.startsWith('data:') || url.startsWith('blob:')) return Promise.resolve(true);

  return new Promise((resolve) => {
    if (opts?.signal?.aborted) {
      resolve(false);
      return;
    }
    const img = new Image();
    let settled = false;
    const finish = (ok: boolean) => {
      if (settled) return;
      settled = true;
      opts?.signal?.removeEventListener('abort', onAbort);
      img.onload = null;
      img.onerror = null;
      resolve(ok);
    };
    const onAbort = () => finish(false);
    opts?.signal?.addEventListener('abort', onAbort, { once: true });
    img.onload = () => {
      if (typeof img.decode === 'function') {
        async function decodeAndFinish() {
          try {
            await img.decode!();
          } catch {
            /* decode optional 鈥?still treat as loaded */
          }
          finish(true);
        }
        decodeAndFinish();
        return;
      }
      finish(true);
    };
    img.onerror = () => finish(false);
    img.src = url;
  });
}

export function isOurStoredImageUrl(src: string): boolean {
  const s = (src || '').trim();
  if (!s || s.startsWith('data:')) return false;
  if (s.startsWith('/api/v1/uploads/')) return true;
  try {
    const u = new URL(s, typeof window !== 'undefined' ? window.location.origin : 'http://local');
    return u.pathname.startsWith('/api/v1/uploads/');
  } catch {
    return false;
  }
}

/** Display whatever URL the API/item already gave 鈥?no rewrite. */
export function toDisplayMediaUrl(src: string, _uploadKey?: string | null): string {
  return String(src || '').trim();
}

export function resolveUploadObjectKey(src: string): string | null {
  const s = (src || '').trim();
  if (!s || s.startsWith('data:') || s.startsWith('blob:')) return null;

  if (/^(assets|uploads|projects|font-tasks)\//.test(s)) {
    return s.split('?')[0] || s;
  }

  const fromPath = (pathname: string): string | null => {
    const apiPrefix = '/api/v1/uploads/files/';
    if (pathname.startsWith(apiPrefix)) {
      const key = decodeURIComponent(pathname.slice(apiPrefix.length)).replace(/^\/+/, '');
      return key || null;
    }
    const marker = '/uploads/';
    const idx = pathname.indexOf(marker);
    if (idx >= 0) {
      const key = decodeURIComponent(pathname.slice(idx + 1)).replace(/^\/+/, '');
      return key.startsWith('uploads/') ? key : null;
    }
    return null;
  };

  try {
    const u = new URL(s, typeof window !== 'undefined' ? window.location.origin : 'http://local');
    return fromPath(u.pathname);
  } catch {
    if (s.startsWith('/')) return fromPath(s.split('?')[0] || s);
    return null;
  }
}

function extForMime(mime: string): string {
  const m = (mime || '').toLowerCase();
  if (m.includes('jpeg') || m.includes('jpg')) return 'jpg';
  if (m.includes('webp')) return 'webp';
  if (m.includes('gif')) return 'gif';
  if (m.includes('svg')) return 'svg';
  if (m.includes('mp4') || m.includes('quicktime')) return 'mp4';
  if (m.includes('webm')) return 'webm';
  if (m.includes('mpeg') || m.includes('mp3')) return 'mp3';
  if (m.includes('wav')) return 'wav';
  if (m.includes('ogg')) return 'ogg';
  if (m.includes('aac') || m.includes('m4a')) return 'm4a';
  return 'png';
}

async function fetchUploadBytesByKey(key: string): Promise<Blob> {
  const path = key
    .split('/')
    .filter(Boolean)
    .map(encodeURIComponent)
    .join('/');
  const absolute = resolveApiUrl(`/api/v1/uploads/files/${path}`);
  const headers: HeadersInit = {};
  const token = getToken();
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(absolute, { headers, mode: 'cors', credentials: 'omit' });
  if (!res.ok) throw new Error(`failed to fetch upload (${res.status})`);
  const blob = await res.blob();
  if (!blob || blob.size < 8) throw new Error('empty upload body');
  return blob;
}

async function fetchUploadBytesByDisplayUrl(src: string): Promise<Blob> {
  const absolute = resolveApiUrl(
    `/api/v1/uploads/content?url=${encodeURIComponent(src)}`
  );
  const headers: HeadersInit = {};
  const token = getToken();
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(absolute, { headers, mode: 'cors', credentials: 'omit' });
  if (!res.ok) throw new Error(`failed to fetch upload content (${res.status})`);
  const blob = await res.blob();
  if (!blob || blob.size < 8) throw new Error('empty upload body');
  return blob;
}

export async function imageSrcToFile(
  src: string,
  filename = 'image.png',
  opts?: { uploadKey?: string | null; fallbackMime?: string }
): Promise<File> {
  const s = (src || '').trim();
  if (!s) throw new Error('empty image src');

  let blob: Blob | null = null;
  if (s.startsWith('data:') || s.startsWith('blob:')) {
    const res = await fetch(s);
    if (!res.ok) throw new Error('failed to read image data');
    blob = await res.blob();
  } else {
    const key = String(opts?.uploadKey || '').trim() || resolveUploadObjectKey(s);
    if (key) {
      blob = await fetchUploadBytesByKey(key);
    } else if (/^https?:\/\//i.test(s)) {
      blob = await fetchUploadBytesByDisplayUrl(s);
    } else {
      const absolute = s.startsWith('/') ? resolveApiUrl(s) : s;
      const headers: HeadersInit = {};
      const token = getToken();
      if (token && (s.startsWith('/api/') || absolute.includes('/api/v1/uploads/'))) {
        headers.Authorization = `Bearer ${token}`;
      }
      const res = await fetch(absolute, { headers, mode: 'cors', credentials: 'omit' });
      if (!res.ok) throw new Error(`failed to fetch image (${res.status})`);
      blob = await res.blob();
    }
  }

  if (!blob || blob.size < 8) throw new Error('empty image body');
  const fallback = String(opts?.fallbackMime || '').trim() || 'image/png';
  const mime = blob.type && blob.type !== 'application/octet-stream' ? blob.type : fallback;
  const ext = extForMime(mime);
  const name = filename.includes('.') ? filename : `${filename}.${ext}`;
  return new File([blob], name, { type: mime });
}

export async function uploadImageFromSrc(
  src: string,
  filename = 'processed.png',
  opts?: {
    signal?: AbortSignal;
    uploadKey?: string | null;
    onJobCreated?: (jobId: string) => void;
    jobId?: string;
    dispatch?: (action: unknown) => unknown;
    nodeId?: string;
  }
): Promise<UploadedFileItem> {
  const s = (src || '').trim();
  if (!s) throw new Error('empty image src');
  if (opts?.signal?.aborted) throw new DOMException('Aborted', 'AbortError');
  if (isOurStoredImageUrl(s) && !opts?.uploadKey) return { url: s };
  const file = await imageSrcToFile(s, filename, { uploadKey: opts?.uploadKey });
  if (opts?.signal?.aborted) throw new DOMException('Aborted', 'AbortError');
  return uploadImageFile(file, {
    signal: opts?.signal,
    jobId: opts?.jobId,
    onJobCreated: opts?.onJobCreated,
    dispatch: opts?.dispatch,
    nodeId: opts?.nodeId,
  });
}

/** @deprecated Use uploadImageFromSrc — local preview fallback removed. */
export async function uploadImageFromSrcWithLocalFallback(
  src: string,
  filename = 'processed.png',
  opts?: { signal?: AbortSignal; uploadKey?: string | null }
): Promise<UploadedFileItem> {
  return uploadImageFromSrc(src, filename, opts);
}

/**
 * COS / CDN display URLs often lack browser CORS — WaveSurfer `fetch` fails.
 * Resolve via authenticated upload pipeline into a same-origin blob: URL.
 * Caller must revoke when done (except passthrough blob:/data:).
 */
export async function resolvePlayableMediaBlobUrl(
  src: string,
  opts?: { uploadKey?: string | null; filename?: string; fallbackMime?: string }
): Promise<{ url: string; revoke: () => void }> {
  const s = String(src || '').trim();
  if (!s) throw new Error('empty media src');
  if (s.startsWith('blob:') || s.startsWith('data:')) {
    return { url: s, revoke: () => undefined };
  }
  const file = await imageSrcToFile(s, opts?.filename || 'media.bin', {
    uploadKey: opts?.uploadKey,
    fallbackMime: opts?.fallbackMime || 'application/octet-stream',
  });
  const url = URL.createObjectURL(file);
  return {
    url,
    revoke: () => {
      try {
        URL.revokeObjectURL(url);
      } catch {
        /* ignore */
      }
    },
  };
}
