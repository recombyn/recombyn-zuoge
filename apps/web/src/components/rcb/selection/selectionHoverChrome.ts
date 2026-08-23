import type { SceneDocument } from '@/components/rcb/sceneNode';
import type { SceneBox } from './alignGuides';
import {
  clearSelectionChromeCursor,
  cursorForResize,
  pickChromeHandleAtClient,
  pickOverlayHandleAtClient,
  type ChromeHandlePick,
  type ChromeHandlePickOpts,
} from './SelectionChrome';
import { cursorForRotate } from './rotateCornerCursor';
import { resolvePaintedControlChrome } from './selectionLogic';

const ROTATE_CORNER_ICON_DEG = {
  nw: 0,
  ne: 90,
  se: 180,
  sw: 270,
} as const;

/** Floating UI that may overlap selection chrome — still allow handle cursors. */
export const SELECTION_HOVER_UI_SELECTOR = [
  '[data-ctx-menu]',
  '[data-sel-toolbar]',
  '[data-export-panel]',
  '[data-frame-toolbar]',
  '[data-image-tool-panel]',
  '[data-image-variants]',
  '[data-image-quick-edit]',
  '[data-lottie-edit-composer]',
  '[data-video-quick-edit]',
  '[data-audio-quick-edit]',
  '[data-shape-style-panel]',
  '[data-gradient-handles]',
  '[data-mesh-handles]',
  '[data-fill-image-handles]',
  '[data-dev-props]',
  '[data-video-playback-bar]',
  '[data-video-trim-toolbar]',
  '[data-audio-playback-bar]',
  '[data-audio-trim-toolbar]',
  '[data-audio-speed-toolbar]',
  '[data-radius-handle]',
  '[data-star-handle]',
  '[data-poly-handle]',
  '[data-circle-handle]',
  '[data-rcb-hit-zone]',
  '[data-mockup-session]',
  '[data-mockup-toolbar]',
  '[data-upscale-toolbar]',
  '[data-mark-overlay]',
  '[data-mark-prompt]',
].join(',');

export function isSelectionHoverUiTarget(target: EventTarget | null): boolean {
  return Boolean(
    target instanceof HTMLElement && target.closest(SELECTION_HOVER_UI_SELECTOR)
  );
}

export type PaintedChromeHoverInput = {
  hitEl: HTMLElement;
  clientX: number;
  clientY: number;
  target: EventTarget | null;
  scene: { x: number; y: number };
  sceneDoc: SceneDocument | null;
  liveUnion: SceneBox | null;
  liveOrigins: Array<{ nodeId: string; box: SceneBox }> | null;
  liveAngle: number;
  pickOpts: ChromeHandlePickOpts & { suppressChrome?: boolean; showHandles?: boolean };
  setEndpointHover: (handle: 'w' | 'e' | null) => void;
  includeOverlayKnobs?: boolean;
};

function cursorForChromePick(pick: ChromeHandlePick, angle: number): string {
  if (pick.kind === 'endpoint') return 'default';
  if (pick.kind === 'resize') return cursorForResize(pick.handle, angle);
  return cursorForRotate(ROTATE_CORNER_ICON_DEG[pick.corner], angle);
}

/**
 * Paint + pick selection chrome under the pointer; apply cursor / endpoint hover.
 * Returns true when a chrome or overlay-knob cursor was applied.
 */
export function applyPaintedChromeHover(input: PaintedChromeHoverInput): boolean {
  const {
    hitEl,
    clientX,
    clientY,
    target,
    scene,
    sceneDoc,
    liveUnion,
    liveOrigins,
    liveAngle,
    pickOpts,
    setEndpointHover,
    includeOverlayKnobs = true,
  } = input;

  if (
    pickOpts.suppressChrome ||
    !pickOpts.showHandles ||
    !liveUnion ||
    !liveOrigins?.length
  ) {
    clearSelectionChromeCursor(hitEl);
    return false;
  }

  const painted = resolvePaintedControlChrome(
    sceneDoc,
    liveOrigins,
    liveUnion,
    liveAngle || 0
  );
  const pick = pickChromeHandleAtClient(clientX, clientY, target, {
    ...pickOpts,
    box: painted.box,
    angle: painted.angle,
    scene,
  });

  if (pick?.kind === 'endpoint') {
    setEndpointHover(pick.handle);
    hitEl.style.cursor = 'default';
    return true;
  }

  if (pick?.kind === 'resize' || pick?.kind === 'rotate') {
    setEndpointHover(null);
    hitEl.style.cursor = cursorForChromePick(pick, painted.angle);
    return true;
  }

  if (includeOverlayKnobs) {
    const knob = pickOverlayHandleAtClient(clientX, clientY, target, scene);
    if (knob?.kind === 'radius' || knob?.kind === 'shape') {
      setEndpointHover(null);
      hitEl.style.cursor = 'pointer';
      return true;
    }
  }

  clearSelectionChromeCursor(hitEl);
  return false;
}
