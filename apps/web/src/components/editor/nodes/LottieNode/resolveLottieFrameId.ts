import { nodeIdsBoundToFrames } from '@/components/rcb/scene/document/sceneClipboard';

/** Resolve parent Lottie 合成台 frame id for a scene node, if any. */
export function resolveLottieFrameId(document: any, node: any): string | null {
  const fid = String(node?.attrs?.frameId || '').trim();
  if (!fid || !document) return null;
  const frames = Array.isArray(document.frames) ? document.frames : [];
  const fr = frames.find((f: any) => String(f?.id) === fid);
  return fr?.kind === 'lottie' ? fid : null;
}

/** First Lottie media node bound to a 合成台 frame. */
export function findFrameLottieMediaId(document: any, frameId: string): string | null {
  if (!document || !frameId) return null;
  const bound = nodeIdsBoundToFrames(document, [frameId]);
  for (const id of bound) {
    if (document.deltaSetLike?.[id]?.key === 'lottie') return id;
  }
  return null;
}
