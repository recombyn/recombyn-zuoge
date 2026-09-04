/**
 * Runtime pause/scrub still for video idle SoA/atlas paint.
 * Prefer this over attrs.poster so demotion keeps the paused frame without
 * rewriting document poster (which flashes under the live decoder).
 */
const videoIdlePaintFrames = new Map<string, { url: string; at: number }>();

export function setVideoIdlePaintFrame(nodeId: string, url: string, at: number): void {
  const id = String(nodeId || '').trim();
  const next = String(url || '').trim();
  if (!id || !next) return;
  videoIdlePaintFrames.set(id, { url: next, at: Number(at) || 0 });
}

export function getVideoIdlePaintFrame(nodeId: string): string | null {
  const id = String(nodeId || '').trim();
  if (!id) return null;
  const url = String(videoIdlePaintFrames.get(id)?.url || '').trim();
  return url || null;
}

export function getVideoIdlePaintFrameAt(nodeId: string): number | null {
  const id = String(nodeId || '').trim();
  if (!id) return null;
  const entry = videoIdlePaintFrames.get(id);
  return entry ? entry.at : null;
}

export function clearVideoIdlePaintFrame(nodeId: string): void {
  videoIdlePaintFrames.delete(String(nodeId || '').trim());
}

/** Test helper — empty the registry. */
export function clearAllVideoIdlePaintFrames(): void {
  videoIdlePaintFrames.clear();
}
