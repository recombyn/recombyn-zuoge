import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type DragEvent,
  type ReactNode,
  memo,
} from 'react';
import { useDispatch, useSelector } from 'react-redux';
import { useTranslation } from 'react-i18next';
import { message } from '@/components/base';
import {
  RcbOverlayPortal,
  rcbCameraCssZoom,
  rcbSceneToScreen,
  useRcbCamera,
} from '@/components/rcb';
import { nodeLeftTop } from '@/components/rcb/scene/paint/sceneToSvg';
import { useImageToolCapabilities } from '@/service/imageTools';
import { isMockupEnabled, mockupErrorMessage } from '@/service/mockupTools';
import { uploadImageFromSrcWithLocalFallback } from '@/utils/uploadImage';
import { cn } from '@/utils/classnames';
import { patchDocumentNode } from '@/store/modules/editor';
import type { SceneDocument, SceneNodeInput } from '@/components/rcb/sceneNode';
import { renderMockup } from './mockupTools';
import MockupDesignLayer from './MockupDesignLayer';
import { isMockupNodeActive } from './mockupAttrs';
import {
  autoFitMockupPlacement,
  composeMockupDesignSheet,
  defaultMockupPlacement,
  loadImageNaturalSize,
  parseMockupPlacement,
  type MockupPlacement,
} from './mockupPlacement';
import {
  readChatImageDragUrl,
  readMediaAssetDragPayload,
  dataTransferHasChatImage,
  dataTransferHasMediaAsset,
} from '@/utils/chatImageDrag';

const DEFAULT_TEMPLATE_ID = 'demo-cylinder';
const DEFAULT_TEMPLATE_WIDTH = 720;
const DEFAULT_TEMPLATE_HEIGHT = 960;

function nodeBox(document: SceneDocument, node: SceneNodeInput) {
  if (!node) return null;
  const { left, top } = nodeLeftTop(document, node);
  return {
    left,
    top,
    width: Math.max(1, Number(node.width) || 1),
    height: Math.max(1, Number(node.height) || 1),
  };
}

function isImageFile(file: File): boolean {
  if (file.type.startsWith('image/')) return true;
  return /\.(png|jpe?g|webp|gif|bmp|svg)$/i.test(file.name || '');
}

function readImageFile(file: File, onLoad: (dataUrl: string) => void) {
  if (!isImageFile(file)) return;
  const reader = new FileReader();
  reader.onload = () => {
    const url = String(reader.result || '').trim();
    if (url) onLoad(url);
  };
  reader.readAsDataURL(file);
}

function pointInScreenRect(
  clientX: number,
  clientY: number,
  left: number,
  top: number,
  width: number,
  height: number
) {
  return clientX >= left && clientX <= left + width && clientY >= top && clientY <= top + height;
}

/** Passive mockup overlay: attr-driven, no session mode, drag-to-place + live warp preview. */
function MockupSessionHost({ document }: { document: SceneDocument }): ReactNode {
  const dispatch = useDispatch();
  const { t } = useTranslation();
  const camera = useRcbCamera();
  const { data: imageToolCaps } = useImageToolCapabilities();
  const mockupIntelEnabled = isMockupEnabled(imageToolCaps);

  const selectedNodeId = useSelector((s: any) => s.editor.selectedNodeId as string | null);
  const node = selectedNodeId ? document?.deltaSetLike?.[selectedNodeId] : null;
  const active =
    mockupIntelEnabled && node?.key === 'image' && isMockupNodeActive(node?.attrs || {});
  const nodeId = active ? selectedNodeId! : '';
  const box = useMemo(
    () => (active && node ? nodeBox(document, node) : null),
    [active, document, node]
  );

  const template = useMemo(() => {
    const tpl = imageToolCaps?.mockup?.templates?.find((item) => item.id === DEFAULT_TEMPLATE_ID);
    return {
      id: tpl?.id || DEFAULT_TEMPLATE_ID,
      name: tpl?.name || t('editor.imageToolbar.mockupTemplateDefault'),
      width: tpl?.width || DEFAULT_TEMPLATE_WIDTH,
      height: tpl?.height || DEFAULT_TEMPLATE_HEIGHT,
    };
  }, [imageToolCaps?.mockup?.templates, t]);

  const [baseSrc, setBaseSrc] = useState<string | null>(null);
  const [designSrc, setDesignSrc] = useState<string | null>(null);
  const [placement, setPlacement] = useState<MockupPlacement>(() => defaultMockupPlacement());
  const [designSelected, setDesignSelected] = useState(false);
  const [previewSrc, setPreviewSrc] = useState<string | null>(null);
  const [previewBusy, setPreviewBusy] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const previewSeqRef = useRef(0);
  const placementRef = useRef(placement);
  const applySeqRef = useRef(0);
  placementRef.current = placement;

  useEffect(() => {
    if (!active || !nodeId) return;
    const root = globalThis.document;
    const hidden = new Set<Element>();
    const hideSceneNode = () => {
      root.querySelectorAll(`[data-scene-node-id="${nodeId}"]`).forEach((el) => {
        if (el instanceof HTMLElement || el instanceof SVGElement) {
          (el as HTMLElement).style.opacity = '0';
          hidden.add(el);
        }
      });
    };
    hideSceneNode();
    const raf = window.requestAnimationFrame(hideSceneNode);
    return () => {
      window.cancelAnimationFrame(raf);
      hidden.forEach((el) => {
        if (el instanceof HTMLElement || el instanceof SVGElement) {
          (el as HTMLElement).style.opacity = '';
        }
      });
    };
  }, [active, nodeId, camera]);

  useEffect(() => {
    if (!active || !nodeId) {
      setBaseSrc(null);
      setDesignSrc(null);
      setPlacement(defaultMockupPlacement());
      setDesignSelected(false);
      setPreviewSrc(null);
      setPreviewBusy(false);
      setDragOver(false);
      return;
    }
    const savedDesign = String(node?.attrs?.mockupDesignSrc || '').trim();
    const savedPlacement = parseMockupPlacement(
      typeof node?.attrs?.mockupPlacement === 'string'
        ? (() => {
            try {
              return JSON.parse(node!.attrs!.mockupPlacement as string);
            } catch {
              return null;
            }
          })()
        : node?.attrs?.mockupPlacement
    );
    if (savedDesign) {
      setDesignSrc(savedDesign);
      setPlacement(savedPlacement || defaultMockupPlacement());
    } else {
      setDesignSrc(null);
      setPlacement(defaultMockupPlacement());
    }
    setDesignSelected(false);
  }, [active, nodeId, node?.attrs?.mockupDesignSrc, node?.attrs?.mockupPlacement]);

  useEffect(() => {
    if (!active || !nodeId) return;
    const src =
      String(node?.attrs?.mockupBaseSrc || node?.attrs?.src || '').trim();
    setBaseSrc(src || null);
  }, [active, nodeId, node?.attrs?.src, node?.attrs?.mockupBaseSrc]);

  const persistPlacement = useCallback(
    (nextPlacement: MockupPlacement, nextDesign: string) => {
      dispatch(
        patchDocumentNode({
          nodeId,
          patch: {
            attrs: {
              mockupDesignSrc: nextDesign,
              mockupPlacement: JSON.stringify(nextPlacement),
              mockupTemplateId: template.id,
            },
          },
          skipHostReload: true,
        })
      );
    },
    [dispatch, nodeId, template.id]
  );

  const assignDesignSrc = useCallback(
    async (src: string, autoSelect = true) => {
      const url = String(src || '').trim();
      if (!url) return;
      try {
        const { width, height } = await loadImageNaturalSize(url);
        const fit = autoFitMockupPlacement(width, height);
        setDesignSrc(url);
        setPlacement(fit);
        setDesignSelected(autoSelect);
        setPreviewSrc(null);
        persistPlacement(fit, url);
      } catch (err) {
        console.warn('[mockup] design load', err);
        message.error(t('editor.imageToolbar.mockupFailed'));
      }
    },
    [persistPlacement, t]
  );

  useEffect(() => {
    if (!active || !nodeId) return;
    if (!selectedNodeId || selectedNodeId === nodeId) return;
    const other = document?.deltaSetLike?.[selectedNodeId];
    if (other?.key !== 'image') return;
    const src = String(other?.attrs?.src || '').trim();
    if (!src) return;
    void assignDesignSrc(src, true);
  }, [active, nodeId, selectedNodeId, document, assignDesignSrc]);

  useEffect(() => {
    if (!active || !designSrc) {
      setPreviewSrc(null);
      setPreviewBusy(false);
      return;
    }
    const seq = ++previewSeqRef.current;
    setPreviewBusy(true);
    const timer = window.setTimeout(() => {
      void (async () => {
        try {
          const sheet = await composeMockupDesignSheet(
            designSrc,
            placementRef.current,
            template.width,
            template.height
          );
          const result = await renderMockup(sheet, template.id);
          if (previewSeqRef.current !== seq) return;
          setPreviewSrc(String(result.image || '').trim() || null);
        } catch (err) {
          if (previewSeqRef.current !== seq) return;
          console.warn('[mockup] preview', err);
          setPreviewSrc(null);
        } finally {
          if (previewSeqRef.current === seq) setPreviewBusy(false);
        }
      })();
    }, designSelected ? 420 : 280);
    return () => window.clearTimeout(timer);
  }, [
    active,
    designSrc,
    placement,
    template.id,
    template.width,
    template.height,
    designSelected,
  ]);

  // Auto-bake warped preview when idle (not dragging placement).
  useEffect(() => {
    if (!active || !nodeId || !designSrc || !previewSrc || designSelected) return;
    const seq = ++applySeqRef.current;
    const timer = window.setTimeout(() => {
      void (async () => {
        try {
          const uploaded = await uploadImageFromSrcWithLocalFallback(previewSrc, 'mockup.png');
          if (applySeqRef.current !== seq) return;
          dispatch(
            patchDocumentNode({
              nodeId,
              patch: {
                attrs: {
                  src: uploaded.url || previewSrc,
                  mockupTemplateId: template.id,
                  mockupDesignSrc: designSrc,
                  mockupPlacement: JSON.stringify(placementRef.current),
                  mockupEnabled: 'true',
                },
              },
              skipHostReload: true,
            })
          );
        } catch (err) {
          console.warn('[mockup] auto apply', err);
        }
      })();
    }, 600);
    return () => window.clearTimeout(timer);
  }, [active, nodeId, designSrc, previewSrc, designSelected, template.id, dispatch]);

  useEffect(() => {
    if (!active) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      if (designSelected) {
        e.preventDefault();
        setDesignSelected(false);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [active, designSelected]);

  const resolveDropSrc = useCallback((dt: DataTransfer | null): string | null => {
    const asset = readMediaAssetDragPayload(dt);
    if (asset?.kind === 'image' && asset.src) return asset.src;
    const chatUrl = readChatImageDragUrl(dt);
    if (chatUrl) return chatUrl;
    return null;
  }, []);

  const onFiles = useCallback(
    (files: FileList | null) => {
      const file = files?.[0];
      if (!file) return;
      readImageFile(file, (url) => void assignDesignSrc(url, true));
    },
    [assignDesignSrc]
  );

  const screenRect = useMemo(() => {
    if (!box) return null;
    const z = Math.max(0.05, rcbCameraCssZoom(camera));
    const origin = rcbSceneToScreen(camera, box.left, box.top);
    return {
      left: origin.x,
      top: origin.y,
      width: box.width * z,
      height: box.height * z,
    };
  }, [box, camera]);

  useEffect(() => {
    if (!active || !screenRect) return;
    const hasAsset = (dt: DataTransfer | null) => {
      const hasFile = Array.from(dt?.types || []).includes('Files');
      return dataTransferHasMediaAsset(dt) || dataTransferHasChatImage(dt) || hasFile;
    };
    const onDragOver = (e: DragEvent) => {
      if (!hasAsset(e.dataTransfer)) return;
      const r = screenRect;
      if (!pointInScreenRect(e.clientX, e.clientY, r.left, r.top, r.width, r.height)) {
        setDragOver(false);
        return;
      }
      e.preventDefault();
      if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy';
      setDragOver(true);
    };
    const onDragLeave = () => setDragOver(false);
    const onDrop = (e: DragEvent) => {
      const r = screenRect;
      setDragOver(false);
      if (!pointInScreenRect(e.clientX, e.clientY, r.left, r.top, r.width, r.height)) return;
      e.preventDefault();
      const droppedUrl = resolveDropSrc(e.dataTransfer);
      if (droppedUrl) {
        void assignDesignSrc(droppedUrl, true);
        return;
      }
      onFiles(e.dataTransfer?.files || null);
    };
    window.addEventListener('dragover', onDragOver);
    window.addEventListener('dragleave', onDragLeave);
    window.addEventListener('drop', onDrop);
    return () => {
      window.removeEventListener('dragover', onDragOver);
      window.removeEventListener('dragleave', onDragLeave);
      window.removeEventListener('drop', onDrop);
    };
  }, [active, screenRect, resolveDropSrc, onFiles, assignDesignSrc]);

  const onPlacementChange = useCallback(
    (next: MockupPlacement) => {
      setPlacement(next);
      if (designSrc) persistPlacement(next, designSrc);
    },
    [designSrc, persistPlacement]
  );

  if (!active || !nodeId || !box || !screenRect) return null;

  const z = Math.max(0.05, rcbCameraCssZoom(camera));
  const origin = rcbSceneToScreen(camera, box.left, box.top);
  const stageW = box.width * z;
  const stageH = box.height * z;
  const showWarped = Boolean(previewSrc) && !designSelected;
  const ghostHitOnly = showWarped && Boolean(designSrc);

  return (
    <RcbOverlayPortal>
      <div data-mockup-session className="pointer-events-none absolute inset-0 z-[36]">
        <div
          className={cn(
            'pointer-events-none absolute overflow-hidden rounded-sm',
            dragOver && 'ring-2 ring-[var(--accent)] ring-offset-1'
          )}
          style={{
            left: origin.x,
            top: origin.y,
            width: stageW,
            height: stageH,
          }}
        >
          {showWarped ? (
            <img
              src={previewSrc!}
              alt=""
              className="absolute inset-0 h-full w-full object-contain"
              draggable={false}
            />
          ) : baseSrc ? (
            <img
              src={baseSrc}
              alt=""
              className="absolute inset-0 h-full w-full object-contain bg-[var(--surface-2)]"
              draggable={false}
            />
          ) : (
            <div className="absolute inset-0 bg-[var(--surface-2)]" />
          )}

          {previewBusy ? (
            <div className="pointer-events-none absolute inset-x-0 top-0 flex justify-center px-2 pt-1">
              <span className="inline-block w-max max-w-[calc(100%-16px)] truncate whitespace-nowrap text-[11px] font-medium text-white drop-shadow">
                {t('editor.imageToolbar.mockupPreviewLoading')}
              </span>
            </div>
          ) : null}

          {!previewBusy && designSrc && !previewSrc && !designSelected ? (
            <div className="pointer-events-none absolute inset-x-0 top-6 flex justify-center px-2">
              <span className="inline-block w-max max-w-[calc(100%-16px)] truncate whitespace-nowrap text-[11px] font-medium text-white drop-shadow">
                {t('editor.imageToolbar.mockupPreviewFailed')}
              </span>
            </div>
          ) : null}

          {!designSrc && !previewBusy ? (
            <div className="pointer-events-none absolute inset-x-0 bottom-3 flex justify-center px-3">
              <span className="inline-block w-max max-w-full truncate whitespace-nowrap rounded-md bg-black/45 px-2.5 py-1 text-[11px] font-medium text-white">
                {t('editor.imageToolbar.mockupDropHint')}
              </span>
            </div>
          ) : null}

          {designSrc ? (
            <MockupDesignLayer
              imageBox={box}
              designSrc={designSrc}
              placement={placement}
              selected={designSelected}
              onSelect={() => setDesignSelected(true)}
              onPlacementChange={onPlacementChange}
              templateW={template.width}
              templateH={template.height}
              ghostHitOnly={ghostHitOnly}
            />
          ) : null}
        </div>
      </div>
    </RcbOverlayPortal>
  );
}

export default memo(MockupSessionHost);
