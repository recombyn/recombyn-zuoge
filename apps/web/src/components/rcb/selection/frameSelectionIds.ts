/** Synthetic selection ids for artboard frames (marquee / multi-select). */
export const FRAME_SEL_PREFIX = '__frame__:';

export function frameSelId(frameId: string) {
  return `${FRAME_SEL_PREFIX}${frameId}`;
}

export function parseFrameSelId(selId: string): string | null {
  const s = String(selId || '');
  if (!s.startsWith(FRAME_SEL_PREFIX)) return null;
  const id = s.slice(FRAME_SEL_PREFIX.length);
  return id || null;
}
