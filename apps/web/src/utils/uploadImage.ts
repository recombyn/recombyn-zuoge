/**
 * Upload helpers shared across editor / home (preview, COS key resolve).
 * HTTP endpoints live in `@/service/upload`.
 */

import {
  deleteUploadedFile as deleteUploadedFileApi,
  uploadUserFile,
  type UploadedFileItem,
} from '@/service/upload';
import { getHttpErrorMessage } from '@/service/client';
import { resolveApiUrl } from '@/utils/apiBase';
import { getToken } from '@/utils/token';

export class UploadTooLargeError extends Error {
  readonly maxMb: number;

  constructor(maxMb: number) {
    super(`upload_too_large:${maxMb}`);
    this.name = 'UploadTooLargeError';
    this.maxMb = maxMb;
  }
}

/** In-flight canvas placeholder uploads — delete node → abort. */
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

/** Map upload errors (413 / size cap) to user-facing copy. */
export function formatUploadErrorMessage(
  err: unknown,
  t: (key: string, opts?: Record<string, unknown>) => string,
  fallback: string
): string {
  if (err instanceof UploadTooLargeError) {
    return t('editor.tools.uploadTooLarge', {
      max: err.maxMb,
      defaultValue: `文件过大（最大 ${err.maxMb}MB）`,
    });
  }
  return getHttpErrorMessage(err, fallback);
}

/** Upload a single image/video/audio file and return its public/display URL. */
export async function uploadImageFile(
  file: File,
  opts?: {
    signal?: AbortSignal;
    onProgress?: (pct: number) => void;
    jobId?: string;
    nodeId?: string;
    /** Soft-compress before upload (default true). */
    compress?: boolean;
  }
): Promise<UploadedFileItem> {
  let toUpload = file;
  if (opts?.compress !== false) {
    try {
      toUpload = await prepareMediaFileForUpload(file, { signal: opts?.signal });
    } catch (err) {
      if (isUploadAbortError(err)) throw err;
      toUpload = file;
    }
  }
  if (opts?.signal?.aborted) throw new DOMException('Aborted', 'AbortError');
  return uploadUserFile(toUpload, opts);
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
 * Soft-compress media for canvas / composer upload. Never rejects oversized picks.
 * Image → JPEG ladder; video/audio → ffmpeg when over soft budget; other → passthrough.
 */
export async function prepareMediaFileForUpload(
  file: File,
  opts?: { signal?: AbortSignal }
): Promise<File> {
  if (opts?.signal?.aborted) throw new DOMException('Aborted', 'AbortError');
  const mime = String(file.type || '').toLowerCase();
  try {
    if (mime.startsWith('image/')) {
      return await compressImageFileForVision(file, { signal: opts?.signal });
    }
    if (mime.startsWith('video/')) {
      const { compressVideoFileForUpload } = await import('@/utils/audioExporter');
      return await compressVideoFileForUpload(file, { signal: opts?.signal });
    }
    if (mime.startsWith('audio/') || /\.(mp3|wav|ogg|m4a|aac|flac)$/i.test(file.name || '')) {
      const { compressAudioFileForUpload } = await import('@/utils/audioExporter');
      return await compressAudioFileForUpload(file, { signal: opts?.signal });
    }
  } catch (err) {
    if (isUploadAbortError(err)) throw err;
    return file;
  }
  return file;
}

/**
 * Composer attach: compress once, upload, keep original local preview for chips.
 */
export async function uploadComposerAttachment(
  file: File,
  opts?: { previewDataUrl?: string; signal?: AbortSignal; compress?: boolean }
): Promise<{
  uploadKey: string;
  url: string;
  imageRef: string;
  previewDataUrl: string;
  name: string;
}> {
  const previewDataUrl =
    String(opts?.previewDataUrl || '').trim() || createFilePreviewUrl(file);
  const uploaded = await uploadImageFile(file, {
    signal: opts?.signal,
    compress: opts?.compress !== false,
  });
  const url = String(uploaded.url || '').trim();
  const uploadKey = String(uploaded.key || '').trim();
  if (!uploadKey) throw new Error('upload returned no key');
  const imageRef = isPublicMediaUrl(url) ? url : previewDataUrl;
  return {
    uploadKey,
    url,
    imageRef,
    previewDataUrl,
    name: String(uploaded.name || file.name || 'image'),
  };
}

export function isPublicMediaUrl(url: string): boolean {
  const u = String(url || '').trim();
  return u.startsWith('http://') || u.startsWith('https://');
}

/** Vision attach: long-edge cap. Soft size target — never reject oversized picks. */
export const VISION_ATTACH_MAX_EDGE = 2048;
/** Soft wire/model budget (~5MB). Oversize files are recompressed, not blocked. */
export const VISION_ATTACH_TARGET_BYTES = 5 * 1024 * 1024;
/** JPEG quality ladder — stop at first result ≤ target, else keep lowest. */
export const VISION_ATTACH_QUALITY_LADDER = [0.82, 0.7, 0.55] as const;

/**
 * Downscale + quality ladder for image attachments / canvas uploads.
 * Opaque photos → JPEG; PNG/WebP (alpha) → WebP without white fill. GIF/SVG pass through.
 */
export async function compressImageFileForVision(
  file: File,
  opts?: { maxEdge?: number; targetBytes?: number; signal?: AbortSignal }
): Promise<File> {
  const mime = String(file.type || '').toLowerCase();
  if (!mime.startsWith('image/')) return file;
  if (mime.includes('svg') || mime.includes('gif')) return file;
  if (opts?.signal?.aborted) throw new DOMException('Aborted', 'AbortError');

  const maxEdge = Math.max(256, opts?.maxEdge ?? VISION_ATTACH_MAX_EDGE);
  const targetBytes = Math.max(256 * 1024, opts?.targetBytes ?? VISION_ATTACH_TARGET_BYTES);
  const keepAlpha = mime.includes('png') || mime.includes('webp');
  const outMime = keepAlpha ? 'image/webp' : 'image/jpeg';
  const outExt = keepAlpha ? 'webp' : 'jpg';

  let bitmap: ImageBitmap | HTMLImageElement;
  let closeBitmap = false;
  try {
    bitmap = await createImageBitmap(file);
    closeBitmap = true;
  } catch {
    const objectUrl = URL.createObjectURL(file);
    try {
      bitmap = await new Promise<HTMLImageElement>((resolve, reject) => {
        const img = new Image();
        img.onload = () => resolve(img);
        img.onerror = () => reject(new Error('image decode failed'));
        img.src = objectUrl;
      });
    } finally {
      URL.revokeObjectURL(objectUrl);
    }
  }

  try {
    const w = Math.max(1, 'width' in bitmap ? bitmap.width : 1);
    const h = Math.max(1, 'height' in bitmap ? bitmap.height : 1);
    const edge = Math.max(w, h);
    if (edge <= maxEdge && file.size <= targetBytes) {
      return file;
    }

    const scale = Math.min(1, maxEdge / edge);
    const outW = Math.max(1, Math.round(w * scale));
    const outH = Math.max(1, Math.round(h * scale));
    const canvas = document.createElement('canvas');
    canvas.width = outW;
    canvas.height = outH;
    const ctx = canvas.getContext('2d');
    if (!ctx) return file;
    if (!keepAlpha) {
      ctx.fillStyle = '#fff';
      ctx.fillRect(0, 0, outW, outH);
    }
    ctx.drawImage(bitmap as CanvasImageSource, 0, 0, outW, outH);

    const base = String(file.name || 'image').replace(/\.[^.]+$/, '') || 'image';
    let best: Blob | null = null;
    for (let i = 0; i < VISION_ATTACH_QUALITY_LADDER.length; i += 1) {
      if (opts?.signal?.aborted) throw new DOMException('Aborted', 'AbortError');
      const q = VISION_ATTACH_QUALITY_LADDER[i]!;
      const blob = await new Promise<Blob | null>((resolve) => {
        canvas.toBlob((b) => resolve(b), outMime, q);
      });
      if (!blob || blob.size <= 0) continue;
      best = blob;
      if (blob.size <= targetBytes) break;
    }
    if (!best) return file;
    if (best.size >= file.size * 0.95) return file;

    return new File([best], `${base}.${outExt}`, { type: outMime, lastModified: Date.now() });
  } finally {
    if (closeBitmap && 'close' in bitmap && typeof bitmap.close === 'function') {
      try {
        bitmap.close();
      } catch {
        /* ignore */
      }
    }
  }
}

const VIDEO_EXT_RE = /\.(mp4|webm|mov|m4v)(\?|#|$)/i;

export function isBlobPreviewUrl(url: string | null | undefined): boolean {
  return String(url || '').trim().startsWith('blob:');
}

export function isLocalStillPreviewUrl(url: string | null | undefined): boolean {
  const s = String(url || '').trim();
  return s.startsWith('data:image/') || s.startsWith('blob:');
}

/** Still JPEG/PNG chip thumb while `mediaPreview` is the playable video blob/https src. */
export function isSeparateStillPosterUrl(poster: string, mediaPreview: string): boolean {
  const p = String(poster || '').trim();
  const m = String(mediaPreview || '').trim();
  return Boolean(p && p !== m && isLocalStillPreviewUrl(p));
}

function pickComposerChipThumb(local: string, still: string, server: string): string {
  if (isSeparateStillPosterUrl(still, local)) return still;
  if (isPublicMediaUrl(still) && !VIDEO_EXT_RE.test(still)) return still;
  if (isLocalStillPreviewUrl(local)) return local;
  return server || local;
}

/**
 * After upload: `dataUrl` → public server URL for API/vision.
 * Chip `thumbUrl` keeps the local blob (or video poster) — never full-res http.
 */
export async function resolveComposerMediaAfterUpload(opts: {
  serverUrl: string;
  localPreview: string;
  stillPreview?: string;
  signal?: AbortSignal;
  /** Release blob previews no longer used as chip thumb (default true). */
  revokeLocalPreview?: boolean;
}): Promise<{ dataUrl: string; thumbUrl: string }> {
  const server = String(opts.serverUrl || '').trim();
  const local = String(opts.localPreview || '').trim();
  const still = String(opts.stillPreview || '').trim();
  const chipThumb = pickComposerChipThumb(local, still, server);

  const releaseUnused = () => {
    if (opts.revokeLocalPreview === false) return;
    if (local && local !== chipThumb) revokeFilePreviewUrl(local);
    if (still && still !== chipThumb && still !== local) revokeFilePreviewUrl(still);
  };

  if (!isPublicMediaUrl(server)) {
    return { dataUrl: local || server, thumbUrl: chipThumb };
  }

  // Local chip thumb → swap dataUrl immediately. Http-only thumb → wait for decode.
  if (!isLocalStillPreviewUrl(chipThumb)) {
    const ready = await waitForImageReady(server, { signal: opts.signal });
    if (!ready) return { dataUrl: server, thumbUrl: chipThumb || server };
  }
  releaseUnused();
  return { dataUrl: server, thumbUrl: chipThumb || server };
}

/** Upload + resolve chip URLs (shared by Agent / Home / generator composers). */
export async function finishComposerAttachmentUpload(
  file: File,
  preview: string,
  thumb?: string
): Promise<{
  uploadKey: string;
  url: string;
  dataUrl: string;
  thumbUrl: string;
  name: string;
}> {
  const mime = String(file.type || '').toLowerCase();
  const name = String(file.name || '');
  const isJsonLike =
    mime === 'application/json' ||
    mime === 'text/json' ||
    mime === 'text/plain' ||
    /\.(json|lot)$/i.test(name);
  // JSON/Lottie: no image compress / decode wait — server stores the text file as-is.
  const uploaded = await uploadComposerAttachment(file, {
    previewDataUrl: preview,
    compress: !isJsonLike,
  });
  if (isJsonLike) {
    revokeFilePreviewUrl(preview);
    return {
      uploadKey: uploaded.uploadKey,
      url: uploaded.url,
      dataUrl: uploaded.url || String(uploaded.previewDataUrl || preview).trim(),
      thumbUrl: '',
      name: uploaded.name,
    };
  }
  const still =
    thumb && isSeparateStillPosterUrl(thumb, preview) ? thumb : undefined;
  const { dataUrl, thumbUrl } = await resolveComposerMediaAfterUpload({
    serverUrl: uploaded.url,
    localPreview: String(uploaded.previewDataUrl || preview).trim(),
    stillPreview: still,
  });
  return {
    uploadKey: uploaded.uploadKey,
    url: uploaded.url,
    dataUrl,
    thumbUrl,
    name: uploaded.name,
  };
}

/** Instant local preview — File in memory, no base64. Caller must revoke when done. */
export function createFilePreviewUrl(file: File): string {
  return URL.createObjectURL(file);
}

export function revokeFilePreviewUrl(url: string | null | undefined): void {
  const s = String(url || '').trim();
  if (!s.startsWith('blob:')) return;
  try {
    URL.revokeObjectURL(s);
  } catch {
    /* ignore */
  }
}

export function revokeComposerPreviewUrls(c: {
  dataUrl?: string | null;
  thumbUrl?: string | null;
}): void {
  revokeFilePreviewUrl(c.dataUrl);
  revokeFilePreviewUrl(c.thumbUrl);
}

/** Revoke a canvas placeholder node's local blob src (no-op for http/data URLs). */
export function revokeNodePreviewSrc(
  document: { deltaSetLike?: Record<string, { attrs?: Record<string, unknown> } | undefined> } | null | undefined,
  nodeId: string | null | undefined
): void {
  const id = String(nodeId || '').trim();
  if (!id || !document?.deltaSetLike?.[id]) return;
  revokeFilePreviewUrl(String(document.deltaSetLike[id]?.attrs?.src || ''));
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
 * Returns false if load failed or aborted — caller should keep the local preview.
 */
export function waitForImageReady(
  src: string,
  opts?: { signal?: AbortSignal }
): Promise<boolean> {
  const url = String(src || '').trim();
  if (!url) return Promise.resolve(false);
  // Already local — nothing to wait for.
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
            /* decode optional — still treat as loaded */
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

/** Display whatever URL the API/item already gave — no rewrite. */
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
    nodeId?: string;
    jobId?: string;
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
    nodeId: opts?.nodeId,
    // Processed/server URLs (cutout, upscale, etc.) — never re-JPEG / strip alpha.
    compress: false,
  });
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
