import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode, memo } from 'react';
import { createPortal } from 'react-dom';
import { useDispatch, useSelector } from 'react-redux';
import { useTranslation } from 'react-i18next';
import { message } from '@/components/base';
import { useRcbCamera } from '@/components/rcb';
import { nodeLeftTop } from '@/components/rcb/scene/paint/sceneToSvg';
import {
  closeImageToolPanel,
  patchDocumentNode,
} from '@/store/modules/editor';
import { uploadImageFromSrcWithLocalFallback } from '@/utils/uploadImage';
import { getHttpErrorMessage } from '@/service/client';
import { useImageToolCapabilities } from '@/service/imageTools';
import { defaultBrushSize } from '../toolPanels/maskBrushUtils';
import LayerMaskBrushBar from './LayerMaskBrushBar';
import LayerMaskOverlay, {
  DEFAULT_LAYER_MASK_BRUSH,
  type LayerMaskOverlayHandle,
} from './LayerMaskOverlay';
import {
  readMaskKey,
  readMaskSrc,
  isMaskEnabled,
} from './layerMaskAttrs';
import type { LayerMaskBrushSettings, MaskPaintColor } from './layerMaskBrush';
import type { SceneDocument, SceneNodeInput } from '@/components/rcb/sceneNode';

function nodeSceneBox(document: SceneDocument, node: SceneNodeInput) {
  if (!node) return null;
  const { left, top } = nodeLeftTop(document, node);
  return {
    left,
    top,
    width: Math.max(1, Number(node.width) || 1),
    height: Math.max(1, Number(node.height) || 1),
  };
}

function LayerMaskSessionHost({
  document,
  hidden,
}: {
  document: SceneDocument;
  hidden?: boolean;
}): ReactNode {
  const dispatch = useDispatch();
  const { t } = useTranslation();
  const camera = useRcbCamera();
  const { data: imageToolCaps } = useImageToolCapabilities();
  const ilpEnabled = imageToolCaps?.ilp?.enabled === true;
  const panel = useSelector(
    (s: any) => s.editor.imageToolPanel as null | { nodeId: string; kind: string }
  );
  const open = panel?.kind === 'layerMask' && !hidden;
  const nodeId = open ? panel!.nodeId : '';
  const node = open ? document?.deltaSetLike?.[nodeId] : null;
  const box = open && node ? nodeSceneBox(document, node) : null;

  const overlayRef = useRef<LayerMaskOverlayHandle>(null);
  const [brush, setBrush] = useState<LayerMaskBrushSettings>(DEFAULT_LAYER_MASK_BRUSH);
  const [paintColor, setPaintColor] = useState<MaskPaintColor>('black');
  const [maskPreviewOnly, setMaskPreviewOnly] = useState(false);
  const [maskEnabled, setMaskEnabled] = useState(true);
  const [busy, setBusy] = useState(false);

  const attrs = (node?.attrs || {}) as Record<string, unknown>;
  const maskSrc = readMaskSrc(attrs);
  const maskKey = readMaskKey(attrs);

  useEffect(() => {
    if (!open || !box) return;
    setBrush((prev) => ({ ...prev, size: defaultBrushSize(box) }));
    setMaskEnabled(isMaskEnabled(attrs));
    setMaskPreviewOnly(false);
    setPaintColor('black');
  }, [open, nodeId]);

  const exit = useCallback(() => {
    dispatch(closeImageToolPanel());
  }, [dispatch]);

  const confirm = useCallback(async () => {
    if (!nodeId || !node) return;
    if (!ilpEnabled) {
      message.warning(t('editor.imageToolbar.maskNeedsIntelligence'));
      return;
    }
    const dirty = overlayRef.current?.hasStrokes() ?? false;
    if (!dirty && maskSrc) {
      dispatch(
        patchDocumentNode({
          nodeId,
          patch: {
            attrs: {
              maskEnabled: maskEnabled ? 'true' : 'false',
            },
          },
        })
      );
      exit();
      return;
    }
    setBusy(true);
    try {
      const exported = await overlayRef.current?.exportMask();
      if (!exported) {
        dispatch(
          patchDocumentNode({
            nodeId,
            patch: {
              attrs: {
                maskSrc: '',
                maskKey: '',
                maskEnabled: 'false',
              },
            },
          })
        );
        message.success(t('editor.imageToolbar.maskCleared'));
        exit();
        return;
      }
      const uploaded = await uploadImageFromSrcWithLocalFallback(exported, 'layer-mask.png');
      dispatch(
        patchDocumentNode({
          nodeId,
          patch: {
            attrs: {
              maskSrc: uploaded.url,
              ...(uploaded.key ? { maskKey: uploaded.key } : {}),
              maskEnabled: maskEnabled ? 'true' : 'false',
            },
          },
        })
      );
      message.success(t('editor.imageToolbar.maskSaved'));
      exit();
    } catch (err: unknown) {
      message.error(getHttpErrorMessage(err, t('editor.imageToolbar.maskFailed')));
    } finally {
      setBusy(false);
    }
  }, [dispatch, exit, ilpEnabled, maskEnabled, maskSrc, node, nodeId, t]);

  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (
        target instanceof HTMLInputElement ||
        target instanceof HTMLTextAreaElement ||
        target?.isContentEditable
      ) {
        return;
      }
      if (e.key === '[') {
        e.preventDefault();
        setBrush((b) => ({ ...b, size: Math.max(8, b.size - 4) }));
        return;
      }
      if (e.key === ']') {
        e.preventDefault();
        setBrush((b) => ({ ...b, size: Math.min(280, b.size + 4) }));
        return;
      }
      if (e.key === 'd' || e.key === 'D') {
        e.preventDefault();
        setPaintColor('white');
        overlayRef.current?.setPaintColor('white');
        return;
      }
      if (e.key === 'x' || e.key === 'X') {
        e.preventDefault();
        setPaintColor((c) => {
          const next = c === 'white' ? 'black' : 'white';
          overlayRef.current?.setPaintColor(next);
          return next;
        });
        return;
      }
      if (e.key === '\\') {
        e.preventDefault();
        setMaskPreviewOnly((v) => !v);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  const bar = useMemo(() => {
    if (!open || !box) return null;
    return (
      <LayerMaskBrushBar
        brush={brush}
        paintColor={paintColor}
        maskEnabled={maskEnabled}
        maskPreviewOnly={maskPreviewOnly}
        onBrushChange={(patch) => setBrush((b) => ({ ...b, ...patch }))}
        onPaintColorChange={(color) => {
          setPaintColor(color);
          overlayRef.current?.setPaintColor(color);
        }}
        onToggleMaskEnabled={() => setMaskEnabled((v) => !v)}
        onToggleMaskPreview={() => setMaskPreviewOnly((v) => !v)}
        onInvert={() => overlayRef.current?.invertMask()}
        onClear={() => overlayRef.current?.clear()}
        onConfirm={() => void confirm()}
        onExit={exit}
        busy={busy}
      />
    );
  }, [
    box,
    brush,
    busy,
    confirm,
    exit,
    maskEnabled,
    maskPreviewOnly,
    open,
    paintColor,
  ]);

  if (!open || !box || !node) return null;

  const portalRoot = typeof globalThis.document !== 'undefined' ? globalThis.document.body : null;

  return (
    <>
      <LayerMaskOverlay
        ref={overlayRef}
        imageBox={box}
        brush={brush}
        maskSrc={maskSrc || undefined}
        maskKey={maskKey}
        maskPreviewOnly={maskPreviewOnly}
      />
      {portalRoot && bar
        ? createPortal(
            <div
              className="pointer-events-none fixed inset-x-0 top-3 z-[60] flex justify-center px-3"
              data-layer-mask-toolbar
            >
              <div className="pointer-events-auto">{bar}</div>
            </div>,
            portalRoot
          )
        : null}
    </>
  );
}

export default memo(LayerMaskSessionHost);
