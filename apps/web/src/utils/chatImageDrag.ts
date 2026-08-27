import { parseLottieAnimationData } from '@/components/rcb/scene/document/nodeFactories';

/** Custom MIME for dragging agent chat gallery images onto the canvas. */
export const CHAT_IMAGE_DRAG_MIME = 'application/x-recombyn-chat-image';

/** Hosted library assets (image / video / audio) from the Assets dock. */
export const MEDIA_ASSET_DRAG_MIME = 'application/x-recombyn-media-asset';

/** Placeholder src when Lottie JSON is only in memory (list API inline). */
export const LOTTIE_INLINE_DRAG_SRC = 'lottie:inline';

function lottieDragAnimationData(
  animationData: unknown
): Record<string, unknown> | null {
  return parseLottieAnimationData(animationData);
}

function mediaAssetDragHasPayload(payload: MediaAssetDragPayload): boolean {
  const src = String(payload.src || '').trim();
  const uploadKey = String(payload.uploadKey || '').trim();
  const kind = payload.kind;
  if (kind !== 'image' && kind !== 'video' && kind !== 'audio' && kind !== 'lottie') {
    return false;
  }
  if (src || uploadKey) return true;
  return kind === 'lottie' && Boolean(lottieDragAnimationData(payload.animationData));
}

export type MediaAssetDragPayload = {
  kind: 'image' | 'video' | 'audio' | 'lottie';
  src: string;
  uploadKey?: string | null;
  width?: number | null;
  height?: number | null;
  prompt?: string | null;
  name?: string | null;
  duration?: number | null;
  /** Inlined Bodymovin from list API — canvas drop must not refetch .json. */
  animationData?: Record<string, unknown> | null;
};

/**
 * In-memory drag payload — DataTransfer cannot hold large ``data:`` URLs
 * (browser silently drops custom MIME / truncates), which made Assets→canvas
 * drags fall through to the stage as a click.
 */
let pendingMediaAssetDrag: MediaAssetDragPayload | null = null;

function dataTransferHasType(dt: DataTransfer, mime: string): boolean {
  if (dt.types?.includes?.(mime)) return true;
  // Some browsers only expose types as a DOMStringList without includes.
  try {
    for (let i = 0; i < dt.types.length; i += 1) {
      if (dt.types[i] === mime) return true;
    }
  } catch {
    /* ignore */
  }
  return false;
}

/** Slim src for DataTransfer — never embed multi-MB base64. */
function slimDragSrc(payload: MediaAssetDragPayload): string {
  const src = String(payload.src || '').trim();
  const key = String(payload.uploadKey || '').trim();
  if (src.startsWith('data:') || src.startsWith('blob:')) {
    return key ? `/api/v1/uploads/files/${key}` : '';
  }
  return src;
}

export function setChatImageDragData(dt: DataTransfer, src: string): void {
  const url = String(src || '').trim();
  if (!url) return;
  dt.setData(CHAT_IMAGE_DRAG_MIME, url);
  if (!url.startsWith('data:') && !url.startsWith('blob:')) {
    dt.setData('text/uri-list', url);
    dt.setData('text/plain', url);
  } else {
    // Huge data URLs blow DataTransfer limits — MIME marker is enough for same-tab drop
    // if a caller also keeps an in-memory URL; otherwise plain marker.
    dt.setData('text/plain', 'image');
  }
  dt.effectAllowed = 'copy';
}

export function readChatImageDragUrl(dt: DataTransfer | null | undefined): string | null {
  if (!dt) return null;
  const fromMime = String(dt.getData(CHAT_IMAGE_DRAG_MIME) || '').trim();
  if (fromMime && fromMime !== 'image' && !fromMime.startsWith('data:')) return fromMime;
  if (fromMime.startsWith('data:') || fromMime.startsWith('blob:') || fromMime.startsWith('http')) {
    return fromMime;
  }
  const uri = String(dt.getData('text/uri-list') || '')
    .split(/\r?\n/)
    .map((l) => l.trim())
    .find((l) => l && !l.startsWith('#'));
  if (uri && (/^https?:\/\//i.test(uri) || uri.startsWith('data:') || uri.startsWith('blob:'))) {
    return uri;
  }
  const plain = String(dt.getData('text/plain') || '').trim();
  if (plain && (/^https?:\/\//i.test(plain) || plain.startsWith('data:') || plain.startsWith('blob:'))) {
    return plain;
  }
  return null;
}

export function dataTransferHasChatImage(dt: DataTransfer | null | undefined): boolean {
  if (!dt) return false;
  return dataTransferHasType(dt, CHAT_IMAGE_DRAG_MIME);
}

export function setMediaAssetDragData(
  dt: DataTransfer,
  payload: MediaAssetDragPayload
): void {
  const src = String(payload.src || '').trim();
  const uploadKey = String(payload.uploadKey || '').trim();
  const kind = payload.kind;
  if (!mediaAssetDragHasPayload({ ...payload, src, uploadKey, kind })) {
    return;
  }

  const lottieData = kind === 'lottie' ? lottieDragAnimationData(payload.animationData) : null;
  const resolvedSrc =
    src ||
    (uploadKey ? `/api/v1/uploads/files/${encodeURIComponent(uploadKey)}` : '') ||
    (lottieData ? LOTTIE_INLINE_DRAG_SRC : '');
  pendingMediaAssetDrag = {
    kind,
    src: resolvedSrc,
    uploadKey: uploadKey || undefined,
    width: payload.width || undefined,
    height: payload.height || undefined,
    prompt: payload.prompt || undefined,
    name: payload.name || undefined,
    duration: payload.duration || undefined,
    ...(lottieData ? { animationData: lottieData } : {}),
  };

  const slimSrc = slimDragSrc(pendingMediaAssetDrag);
  dt.setData(
    MEDIA_ASSET_DRAG_MIME,
    JSON.stringify({
      kind,
      src: slimSrc || (lottieData ? LOTTIE_INLINE_DRAG_SRC : 'pending'),
      uploadKey: pendingMediaAssetDrag.uploadKey,
      width: pendingMediaAssetDrag.width,
      height: pendingMediaAssetDrag.height,
      prompt: pendingMediaAssetDrag.prompt,
      name: pendingMediaAssetDrag.name,
      duration: pendingMediaAssetDrag.duration,
    })
  );
  if (slimSrc && !slimSrc.startsWith('data:')) {
    dt.setData('text/uri-list', slimSrc);
    dt.setData('text/plain', slimSrc);
  } else {
    dt.setData('text/plain', kind);
  }
  dt.effectAllowed = 'copy';
}

export function clearMediaAssetDragData(): void {
  pendingMediaAssetDrag = null;
}

/**
 * `dragend` can fire before the drop handler has consumed the in-memory payload.
 * Keep it available for one event loop handoff so same-tab drops are reliable.
 */
export function scheduleClearMediaAssetDragData(delayMs = 300): number {
  return window.setTimeout(() => clearMediaAssetDragData(), delayMs);
}

export function readMediaAssetDragPayload(
  dt: DataTransfer | null | undefined
): MediaAssetDragPayload | null {
  if (pendingMediaAssetDrag) {
    return pendingMediaAssetDrag;
  }
  if (!dt) return null;
  const raw = String(dt.getData(MEDIA_ASSET_DRAG_MIME) || '').trim();
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as MediaAssetDragPayload;
    const src = String(parsed?.src || '').trim();
    const kind = String(parsed?.kind || '').trim();
    if (
      !src ||
      (kind !== 'image' && kind !== 'video' && kind !== 'audio' && kind !== 'lottie')
    ) {
      return null;
    }
    if (src === 'pending' || src === LOTTIE_INLINE_DRAG_SRC) {
      return null;
    }
    return {
      kind,
      src,
      uploadKey: parsed.uploadKey,
      width: parsed.width,
      height: parsed.height,
      prompt: parsed.prompt,
      name: parsed.name,
      duration: parsed.duration,
    };
  } catch {
    return null;
  }
}

export function dataTransferHasMediaAsset(dt: DataTransfer | null | undefined): boolean {
  if (!dt) return false;
  if (pendingMediaAssetDrag) return true;
  return dataTransferHasType(dt, MEDIA_ASSET_DRAG_MIME);
}
