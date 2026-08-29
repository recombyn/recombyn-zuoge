/**
 * Precomp edit: center the lot plate once; restore camera on exit.
 * Isolation paint is owned by animationPrecompEditFocus module.
 */
import { memo, useEffect, useLayoutEffect, useRef } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import type { SceneDocument } from '@/components/rcb/sceneNode';
import { nodeLeftTop } from '@/components/rcb/scene/paint/sceneToSvg';
import {
  linkedLotNodeIdFromAsset,
  resolvePrecompAsset,
} from '@/components/editor/nodes/AnimationNode/animationPrecompEditModel';
import {
  setLottiePrecompEditFocus,
} from '@/components/editor/nodes/AnimationNode/animationPrecompEditFocus';
import {
  popSessionCamera,
  pushSessionCamera,
  type SessionCameraBandInsets,
  type SessionCameraBounds,
  type SessionCameraFitOpts,
} from '@/utils/sessionCamera';
import { exitLottiePrecompEdit } from '@/store/modules/editor';

const DOCK_FALLBACK_H = 240;
const BOTTOM_BAND_GAP = 40;
const TOP_BAND_INSET = 40;
const MAX_ZOOM = 1.6;
const PADDING = 72;
const BAND_ANCHOR_Y = 0.38;

function readBottomBandInset(stageEl: HTMLElement | null): number {
  if (!stageEl) return DOCK_FALLBACK_H + BOTTOM_BAND_GAP;
  const stageRect = stageEl.getBoundingClientRect();
  let chromeTop = stageRect.bottom;
  for (const sel of ['[data-tour="editor-tools"]', '[data-lottie-timeline-dock]']) {
    const el = window.document.querySelector(sel) as HTMLElement | null;
    if (!el) continue;
    const top = el.getBoundingClientRect().top;
    if (Number.isFinite(top) && top < chromeTop) chromeTop = top;
  }
  const inset = Math.round(stageRect.bottom - chromeTop);
  return Math.max(DOCK_FALLBACK_H, inset) + BOTTOM_BAND_GAP;
}

function fitOpts(
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
    padding: PADDING,
    maxZoom: MAX_ZOOM,
    bandInsets,
    bandAnchorY: BAND_ANCHOR_Y,
  };
}

function boundsForPrecompEdit(
  document: SceneDocument | null | undefined,
  hostNodeId: string,
  assetId: string
): SessionCameraBounds | null {
  if (!document) return null;
  const lotId = linkedLotNodeIdFromAsset(assetId);
  if (lotId) {
    const node = document.deltaSetLike?.[lotId];
    if (node) {
      const { left, top } = nodeLeftTop(document, node);
      return {
        x: left,
        y: top,
        width: Math.max(1, Number(node.width) || 1),
        height: Math.max(1, Number(node.height) || 1),
      };
    }
  }
  const host = document.deltaSetLike?.[hostNodeId];
  if (!host) return null;
  const { left, top } = nodeLeftTop(document, host);
  const resolved = resolvePrecompAsset(host.attrs?.animationData, assetId);
  const aw = resolved?.w || Math.max(1, Number(host.width) || 1);
  const ah = resolved?.h || Math.max(1, Number(host.height) || 1);
  const hw = Math.max(1, Number(host.width) || aw);
  const hh = Math.max(1, Number(host.height) || ah);
  const scale = Math.min(hw / aw, hh / ah);
  const contentW = aw * scale;
  const contentH = ah * scale;
  return {
    x: left + (hw - contentW) / 2,
    y: top + (hh - contentH) / 2,
    width: contentW,
    height: contentH,
  };
}

function AnimationPrecompEditFocusHost({
  document,
  stageEl = null,
  bandLeftPx = 0,
  bandRightPx = 0,
}: {
  document: SceneDocument | null;
  stageEl?: HTMLElement | null;
  bandLeftPx?: number;
  bandRightPx?: number;
}) {
  const edit = useSelector(
    (s: any) =>
      s.editor.lottiePrecompEdit as null | {
        hostNodeId: string;
        assetId: string;
        selectedLayerInd: number | null;
      }
  );
  const dispatch = useDispatch();
  const active = Boolean(edit?.hostNodeId && edit?.assetId);
  const hostNodeId = edit?.hostNodeId || '';
  const assetId = edit?.assetId || '';
  const lotNodeId = linkedLotNodeIdFromAsset(assetId);
  const pushedRef = useRef(false);
  const fittedKeyRef = useRef('');
  const stageElRef = useRef(stageEl);
  stageElRef.current = stageEl;

  useLayoutEffect(() => {
    setLottiePrecompEditFocus({
      active,
      lotNodeId: active ? lotNodeId : null,
    });
    return () => {
      if (active) setLottiePrecompEditFocus({ active: false });
    };
  }, [active, lotNodeId]);

  useEffect(() => {
    if (!active) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) {
        return;
      }
      e.preventDefault();
      dispatch(exitLottiePrecompEdit());
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [active, dispatch]);

  useEffect(() => {
    if (!active) {
      if (pushedRef.current) {
        popSessionCamera();
        pushedRef.current = false;
      }
      fittedKeyRef.current = '';
      return;
    }

    const key = `${hostNodeId}:${assetId}`;
    if (fittedKeyRef.current === key && pushedRef.current) return;

    let cancelled = false;
    let tries = 0;
    const apply = () => {
      if (cancelled) return;
      const bounds = boundsForPrecompEdit(document, hostNodeId, assetId);
      if (!bounds) {
        if (tries++ < 16) window.requestAnimationFrame(apply);
        return;
      }
      if (pushedRef.current && fittedKeyRef.current === key) return;
      if (!pushedRef.current) {
        pushSessionCamera(bounds, fitOpts(stageElRef.current, bandLeftPx, bandRightPx));
        pushedRef.current = true;
      }
      fittedKeyRef.current = key;
    };
    window.requestAnimationFrame(apply);
    return () => {
      cancelled = true;
    };
  }, [active, assetId, bandLeftPx, bandRightPx, document, hostNodeId]);

  useEffect(
    () => () => {
      setLottiePrecompEditFocus({ active: false });
      if (pushedRef.current) {
        popSessionCamera();
        pushedRef.current = false;
      }
    },
    []
  );

  return null;
}

export default memo(AnimationPrecompEditFocusHost);
