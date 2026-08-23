/**
 * Shared canvas → Agent composer attach helpers (mark regions, 添加到 Chat, Add from canvas).
 * Attachments are committed immediately so canvas and composer stay in sync.
 */
import { rcbSceneToScreen, type RcbCamera } from '@/components/rcb';
import {
  getInfiniteSvgPaintCamera,
  nodeLeftTop,
} from '@/components/rcb/scene/paint/sceneToSvg';
import type { SceneDocument } from '@/components/rcb/sceneNode';
type Point = { x: number; y: number };

/** Last pointer / selection origin for the next attach → chat fly (client / fixed). */
let pendingFlyOrigin: Point | null = null;
/** Which composer should receive the chip (`agent` | `node:<id>`). */
let pendingFlyLandId: string | null = null;

export function noteCanvasFlyOrigin(x: number, y: number) {
  if (!Number.isFinite(x) || !Number.isFinite(y)) return;
  pendingFlyOrigin = { x, y };
}

export function takeCanvasFlyOrigin(): Point | null {
  const p = pendingFlyOrigin;
  pendingFlyOrigin = null;
  return p;
}

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

function pointFromEl(el: HTMLElement | null): Point | null {
  if (!el) return null;
  const r = el.getBoundingClientRect();
  if (!(r.width > 8 && r.height > 8)) return null;
  return { x: r.left + Math.min(72, r.width * 0.28), y: r.top + r.height * 0.45 };
}

/**
 * Landing point for a fly chip.
 * Prefer the composer that started pick (`data-fly-land`), never the first random
 * `[data-agent-composer]` (generator cards also use that attribute).
 */
export function resolveChatFlyTarget(opts?: { landId?: string | null }): Point {
  const landId = String(opts?.landId ?? pendingFlyLandId ?? '').trim();
  if (landId) {
    const scoped = globalThis.document.querySelector(
      `[data-fly-land="${landId.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"]`
    ) as HTMLElement | null;
    const pt = pointFromEl(scoped);
    if (pt) return pt;
  }
  const agentLand = pointFromEl(
    globalThis.document.querySelector('[data-fly-land="agent"]') as HTMLElement | null
  );
  if (agentLand) return agentLand;

  const dock =
    (globalThis.document.querySelector('[data-tour="editor-agent"]') as HTMLElement | null) ||
    (globalThis.document.querySelector('aside[data-tour]') as HTMLElement | null);
  if (dock) {
    const composer = dock.querySelector(
      '[data-fly-land], [data-agent-composer-root], [data-agent-composer]'
    ) as HTMLElement | null;
    const pt = pointFromEl(composer) || pointFromEl(dock);
    if (pt) {
      if (!composer && dock) {
        const r = dock.getBoundingClientRect();
        return { x: r.left + r.width * 0.35, y: r.bottom - 96 };
      }
      return pt;
    }
  }
  return {
    x: Math.max(120, window.innerWidth - 220),
    y: Math.max(120, window.innerHeight * 0.62),
  };
}

/** Stage-local → `position:fixed` client coords. */
function stageLocalToClient(local: Point): Point {
  const stage =
    (globalThis.document.querySelector('[data-rcb-canvas]') as HTMLElement | null) ||
    (globalThis.document.querySelector('[data-rcb-overlay]') as HTMLElement | null);
  if (!stage) return local;
  const r = stage.getBoundingClientRect();
  return { x: local.x + r.left, y: local.y + r.top };
}

function sceneBoxCenterClient(
  document: SceneDocument,
  nodeId: string,
  camera: RcbCamera
): Point | null {
  const node = document?.deltaSetLike?.[nodeId];
  if (!node) return null;
  const { left, top } = nodeLeftTop(document, node);
  const w = Math.max(1, Number(node.width) || 1);
  const h = Math.max(1, Number(node.height) || 1);
  const local = rcbSceneToScreen(camera, left + w / 2, top + h / 2);
  return stageLocalToClient(local);
}

/** Best-effort **client** origin for an attach payload (node / multi / frame). */
export function resolveAttachPayloadFlyOrigin(opts: {
  document: SceneDocument;
  payload: string | string[];
  camera: RcbCamera;
}): Point | null {
  const { document: doc, payload, camera } = opts;
  if (Array.isArray(payload)) {
    const pts = payload
      .map((id) => sceneBoxCenterClient(doc, String(id), camera))
      .filter(Boolean) as Point[];
    if (!pts.length) return null;
    return {
      x: pts.reduce((s, p) => s + p.x, 0) / pts.length,
      y: pts.reduce((s, p) => s + p.y, 0) / pts.length,
    };
  }
  const raw = String(payload || '');
  if (raw.startsWith('frame:')) {
    const frameId = raw.slice('frame:'.length);
    const frames = Array.isArray(doc?.frames) ? doc.frames : [];
    const frame = frames.find((f: { id?: string }) => f?.id === frameId);
    if (!frame) return null;
    const x = Number(frame.x) || 0;
    const y = Number(frame.y) || 0;
    const w = Math.max(1, Number(frame.width) || 1);
    const h = Math.max(1, Number(frame.height) || 1);
    const local = rcbSceneToScreen(camera, x + w / 2, y + h / 2);
    return stageLocalToClient(local);
  }
  return sceneBoxCenterClient(doc, raw, camera);
}

export type PlayFlyChipToChatOpts = {
  from: Point;
  to?: Point;
  /** Prefer this composer (`agent` | `node:<id>`); consumes pending land if omitted. */
  landId?: string | null;
  label?: string;
  thumbUrl?: string;
  /** Called immediately so the real chip appears in the composer. */
  onLand?: () => void | Promise<void>;
};

/** Short label for the flying chip. */
export function resolveAttachFlyLabel(
  document: SceneDocument | null | undefined,
  payload: string | string[]
): string {
  if (Array.isArray(payload)) {
    if (payload.length > 1) return `${payload.length} items`;
    payload = payload[0] || '';
  }
  const raw = String(payload || '');
  if (raw.startsWith('frame:')) {
    const frameId = raw.slice('frame:'.length);
    const frames = Array.isArray(document?.frames) ? document!.frames : [];
    const frame = frames.find((f: { id?: string; name?: string }) => f?.id === frameId);
    return String(frame?.name || 'Frame').trim() || 'Frame';
  }
  const node = document?.deltaSetLike?.[raw];
  const name = String(node?.name || node?.attrs?.name || '').trim();
  if (name) return name.length > 18 ? `${name.slice(0, 17)}…` : name;
  if (node?.key) return String(node.key);
  return 'Chat';
}

/** Add to the composer immediately. The former fly-in animation was removed. */
export async function playFlyChipToChat(opts: PlayFlyChipToChatOpts): Promise<void> {
  takeCanvasFlyLand();
  try {
    await opts.onLand?.();
  } catch {
    /* ignore */
  }
}

/**
 * Origin for the next fly chip (client / fixed coords).
 * Prefer attached node / frame center; else noted canvas pointer; else near land.
 */
export function resolveNextFlyOrigin(opts: {
  document?: SceneDocument | null;
  payload?: string | string[] | null;
  camera?: RcbCamera | null;
}): Point {
  const noted = takeCanvasFlyOrigin();
  const camera = opts.camera ?? getInfiniteSvgPaintCamera();
  if (opts.document && opts.payload != null && camera) {
    const fromPayload = resolveAttachPayloadFlyOrigin({
      document: opts.document,
      payload: opts.payload,
      camera,
    });
    if (fromPayload) return fromPayload;
  }
  if (noted) return noted;

  const land = resolveChatFlyTarget({ landId: null });
  return { x: land.x - 120, y: land.y + 40 };
}
