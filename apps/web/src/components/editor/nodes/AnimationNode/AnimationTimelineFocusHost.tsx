/**
 * Timeline focus: center the 动画工作台 once in the free band above the
 * floating tools + timeline (and between side docks). Restore camera on close.
 * Do not re-fit while the user moves/resizes the board.
 */
import { memo, useEffect, useLayoutEffect, useRef } from 'react';
import { useSelector } from 'react-redux';
import type { SceneDocument } from '@/components/rcb/sceneNode';
import { nodeLeftTop } from '@/components/rcb/scene/paint/sceneToSvg';
import { resolveAnimationFrameId } from '@/components/editor/nodes/AnimationNode/resolveAnimationFrameId';
import {
  popSessionCamera,
  pushSessionCamera,
  type SessionCameraBandInsets,
  type SessionCameraBounds,
  type SessionCameraFitOpts,
} from '@/utils/sessionCamera';
import {
  setAnimationWorkbenchTimelineFocus,
} from '@/components/editor/nodes/AnimationNode/animationWorkbenchFocus';

/** Fallback when the dock has not painted yet (~default dock height). */
const TIMELINE_DOCK_FALLBACK_H = 240;
/** Air between workbench and the floating tool strip. */
const BOTTOM_BAND_GAP = 40;
/** Top chrome — keep light so the board can sit higher. */
const TOP_BAND_INSET = 40;
const TIMELINE_FOCUS_MAX_ZOOM = 1.4;
const TIMELINE_FOCUS_PADDING = 64;
/** Sit in the upper half of the free band (0 = top, 1 = bottom). */
const TIMELINE_FOCUS_BAND_ANCHOR_Y = 0.38;

function boundsForWorkbench(
  document: SceneDocument | null | undefined,
  nodeId: string
): SessionCameraBounds | null {
  if (!document || !nodeId) return null;
  const node = document.deltaSetLike?.[nodeId];
  const frameId = resolveAnimationFrameId(document, node);
  if (frameId) {
    const frame = (Array.isArray(document.frames) ? document.frames : []).find(
      (f: { id?: string }) => String(f?.id) === frameId
    );
    if (frame) {
      return {
        x: Number(frame.x) || 0,
        y: Number(frame.y) || 0,
        width: Math.max(1, Number(frame.width) || 1),
        height: Math.max(1, Number(frame.height) || 1),
      };
    }
  }
  if (!node) return null;
  const { left, top } = nodeLeftTop(document, node);
  return {
    x: left,
    y: top,
    width: Math.max(1, Number(node.width) || 1),
    height: Math.max(1, Number(node.height) || 1),
  };
}

/**
 * Distance from stage bottom to the top of timeline/tools chrome.
 * Prefer live DOM so we don't center into the area covered by the dock.
 */
function readBottomBandInset(stageEl: HTMLElement | null): number {
  if (!stageEl) return TIMELINE_DOCK_FALLBACK_H + BOTTOM_BAND_GAP;
  const stageRect = stageEl.getBoundingClientRect();
  let chromeTop = stageRect.bottom;
  for (const sel of ['[data-tour="editor-tools"]', '[data-lottie-timeline-dock]']) {
    const el = window.document.querySelector(sel) as HTMLElement | null;
    if (!el) continue;
    const top = el.getBoundingClientRect().top;
    if (Number.isFinite(top) && top < chromeTop) chromeTop = top;
  }
  const inset = Math.round(stageRect.bottom - chromeTop);
  return Math.max(TIMELINE_DOCK_FALLBACK_H, inset) + BOTTOM_BAND_GAP;
}

function toolsAreLiftedAboveDock(): boolean {
  const tools = window.document.querySelector(
    '[data-tour="editor-tools"]'
  ) as HTMLElement | null;
  const dock = window.document.querySelector(
    '[data-lottie-timeline-dock]'
  ) as HTMLElement | null;
  if (!tools || !dock) return false;
  // Tools must sit clearly above the dock (not still at bottom:16 under it).
  return tools.getBoundingClientRect().bottom <= dock.getBoundingClientRect().top + 2;
}

function fitOptsForWorkbench(
  stageEl: HTMLElement | null,
  bandLeftPx: number,
  bandRightPx: number
): SessionCameraFitOpts {
  const bandInsets: SessionCameraBandInsets = {
    top: TOP_BAND_INSET,
    right: Math.max(0, bandRightPx),
    bottom: readBottomBandInset(stageEl),
    left: Math.max(0, bandLeftPx),
  };
  return {
    padding: TIMELINE_FOCUS_PADDING,
    maxZoom: TIMELINE_FOCUS_MAX_ZOOM,
    bandInsets,
    bandAnchorY: TIMELINE_FOCUS_BAND_ANCHOR_Y,
  };
}

function AnimationTimelineFocusHost({
  document,
  stageEl = null,
  bandLeftPx = 0,
  bandRightPx = 0,
}: {
  document: SceneDocument | null;
  stageEl?: HTMLElement | null;
  /** Left layers/assets dock width (stage overlay). */
  bandLeftPx?: number;
  /** Right agent/inspect dock width (stage overlay). */
  bandRightPx?: number;
}) {
  const timelineNodeId = useSelector((s: any) =>
    String(s.editor.lottieTimelinePanel?.nodeId || '')
  );
  const open = Boolean(timelineNodeId);
  const pushedRef = useRef(false);
  /** Only re-center when the timeline target node changes — not on board drag. */
  const fittedForNodeRef = useRef('');
  const stageElRef = useRef(stageEl);
  stageElRef.current = stageEl;

  const focusFrameId =
    open && document
      ? resolveAnimationFrameId(document, document.deltaSetLike?.[timelineNodeId])
      : null;

  useLayoutEffect(() => {
    setAnimationWorkbenchTimelineFocus(focusFrameId);
    return () => {
      if (!focusFrameId) setAnimationWorkbenchTimelineFocus(null);
    };
  }, [focusFrameId]);

  useEffect(() => {
    if (!open) {
      if (pushedRef.current) {
        popSessionCamera();
        pushedRef.current = false;
      }
      fittedForNodeRef.current = '';
      return;
    }

    if (fittedForNodeRef.current === timelineNodeId && pushedRef.current) {
      return;
    }

    let cancelled = false;
    let tries = 0;

    const apply = () => {
      if (cancelled) return;
      const bounds = boundsForWorkbench(document, timelineNodeId);
      if (!bounds) {
        if (tries++ < 16) window.requestAnimationFrame(apply);
        return;
      }

      // Wait until dock exists and bottom tools have lifted above it.
      if (tries < 24) {
        const dock = window.document.querySelector('[data-lottie-timeline-dock]');
        if (!dock || !toolsAreLiftedAboveDock()) {
          tries += 1;
          window.requestAnimationFrame(apply);
          return;
        }
      }

      if (pushedRef.current && fittedForNodeRef.current === timelineNodeId) return;

      if (!pushedRef.current) {
        pushSessionCamera(
          bounds,
          fitOptsForWorkbench(stageElRef.current, bandLeftPx, bandRightPx)
        );
        pushedRef.current = true;
      }
      fittedForNodeRef.current = timelineNodeId;
    };

    window.requestAnimationFrame(apply);
    return () => {
      cancelled = true;
    };
  }, [bandLeftPx, bandRightPx, document, open, timelineNodeId]);

  useEffect(
    () => () => {
      setAnimationWorkbenchTimelineFocus(null);
      if (pushedRef.current) {
        popSessionCamera();
        pushedRef.current = false;
      }
    },
    []
  );

  return null;
}

export default memo(AnimationTimelineFocusHost);
