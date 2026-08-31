/**
 * Shared canvas → Agent composer attach helpers (mark regions, 添加到 Chat, Add from canvas).
 * Attachments are committed immediately so canvas and composer stay in sync.
 * (Former fly-in animation was removed; playFlyChipToChat only lands chips.)
 */

/** Which composer should receive the chip (`agent` | `node:<id>`). */
let pendingFlyLandId: string | null = null;

/** Remember which input the next fly should land in (matches `data-fly-land`). */
export function noteCanvasFlyLand(landId: string) {
  const id = String(landId || '').trim();
  pendingFlyLandId = id || null;
}

export function takeCanvasFlyLand(): string | null {
  const id = pendingFlyLandId;
  pendingFlyLandId = null;
  return id;
}

export type PlayFlyChipToChatOpts = {
  /** Called immediately so the real chip appears in the composer. */
  onLand?: () => void | Promise<void>;
};

/** Apply attach into the composer. Clears pending land target. */
export async function playFlyChipToChat(opts: PlayFlyChipToChatOpts): Promise<void> {
  takeCanvasFlyLand();
  try {
    await opts.onLand?.();
  } catch {
    /* ignore */
  }
}
