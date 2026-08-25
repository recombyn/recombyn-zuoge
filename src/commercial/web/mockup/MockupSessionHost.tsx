import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
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
import { liveShapeGeomBox } from '@/components/rcb/selection/HostPathChrome';
import { useImageToolCapabilities } from '@/service/imageTools';
import { isMockupEnabled, mockupErrorMessage } from '@/service/mockupTools';
import { uploadImageFromSrcWithLocalFallback } from '@/utils/uploadImage';
import { cn } from '@/utils/classnames';
import {
  patchDocumentNode,
  removeDocumentNodes,
  setSelectedNodeId,
} from '@/store/modules/editor';
import type { SceneDocument, SceneNodeInput } from '@/components/rcb/sceneNode';
import MockupDesignLayer from './MockupDesignLayer';
import { isMockupNodeActive } from './mockupAttrs';
import { fetchMockupTemplateKit, type MockupTemplateKit } from './mockupKit';
import {
  autoFitMockupPlacement,
  composeMockupDesignSheet,
  defaultMockupPlacement,
  loadImageNaturalSize,
  parseMockupPlacement,
  type MockupPlacement,
} from './mockupPlacement';
import { createMockupUvPreview, type MockupUvPreview } from './mockupUvPreview';
import {
  readChatImageDragUrl,
  readMediaAssetDragPayload,
  dataTransferHasChatImage,
  dataTransferHasMediaAsset,
} from '@/utils/chatImageDrag';

const DEFAULT_TEMPLATE_ID = 'demo-cylinder';
const DEFAULT_TEMPLATE_WIDTH = 720;
const DEFAULT_TEMPLATE_HEIGHT = 960;
const CANVAS_ABSORB_MOVE_PX = 8;
const KIT_SCALE = 0.5;

type SceneBox = { left: number; top: number; width: number; height: number };

function nodeBox(document: SceneDocument, node: SceneNodeInput): SceneBox | null {
  if (!node) return null;
  const { left, top } = nodeLeftTop(document, node);
  return {
    left,
    top,
    width: Math.max(1, Number(node.width) || 1),
    height: Math.max(1, Number(node.height) || 1),
  };
}

function listMockupNodeIds(document: SceneDocument | null | undefined): string[] {
  const ds = document?.deltaSetLike || {};
  return Object.keys(ds).filter((id) => {
    const node = ds[id];
    return node?.key === 'image' && isMockupNodeActive(node.attrs || {});
  });
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

function mockupContainsDesignCenter(host: SceneBox, design: SceneBox): boolean {
  const cx = design.left + design.width / 2;
  const cy = design.top + design.height / 2;
  return (
    cx >= host.left &&
    cx <= host.left + host.width &&
    cy >= host.top &&
    cy <= host.top + host.height
  );
}

function parseSavedPlacement(raw: unknown): MockupPlacement | null {
  if (typeof raw === 'string') {
    try {
      return parseMockupPlacement(JSON.parse(raw));
    } catch {
      return null;
    }
  }
  return parseMockupPlacement(raw);
}

function MockupSessionHost({ document }: { document: SceneDocument }): ReactNode {
  const { data: imageToolCaps } = useImageToolCapabilities();
  const mockupIntelEnabled = isMockupEnabled(imageToolCaps);
  const mockupIds = useMemo(
    () => (mockupIntelEnabled ? listMockupNodeIds(document) : []),
    [document, mockupIntelEnabled]
  );

  if (!mockupIds.length) return null;

  return (
    <>
      {mockupIds.map((nodeId) => (
        <MockupPlate key={nodeId} nodeId={nodeId} document={document} />
      ))}
    </>
  );
}

function MockupPlate({
  nodeId,
  document,
}: {
  nodeId: string;
  document: SceneDocument;
}): ReactNode {
  const dispatch = useDispatch();
  const { t } = useTranslation();
  const camera = useRcbCamera();
  const { data: imageToolCaps } = useImageToolCapabilities();
  const selectedNodeId = useSelector((s: any) => s.editor.selectedNodeId as string | null);
  const node = document?.deltaSetLike?.[nodeId];
  const box = useMemo(() => (node ? nodeBox(document, node) : null), [document, node]);

  const template = useMemo(() => {
    const tpl = imageToolCaps?.mockup?.templates?.find((item) => item.id === DEFAULT_TEMPLATE_ID);
    return {
      id: tpl?.id || DEFAULT_TEMPLATE_ID,
      name: tpl?.name || t('editor.imageToolbar.mockupTemplateDefault'),
      width: tpl?.width || DEFAULT_TEMPLATE_WIDTH,
      height: tpl?.height || DEFAULT_TEMPLATE_HEIGHT,
    };
  }, [imageToolCaps?.mockup?.templates, t]);

  const [kit, setKit] = useState<MockupTemplateKit | null>(null);
  const [designSrc, setDesignSrc] = useState<string | null>(null);
  const [placement, setPlacement] = useState<MockupPlacement>(() => defaultMockupPlacement());
  const [designSelected, setDesignSelected] = useState(false);
  const [livePreviewUrl, setLivePreviewUrl] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [ctxMenu, setCtxMenu] = useState<{ x: number; y: number } | null>(null);

  const placementRef = useRef(placement);
  const designSrcRef = useRef(designSrc);
  const applySeqRef = useRef(0);
  const absorbLockRef = useRef(false);
  const pointerGestureRef = useRef<{ x: number; y: number; moved: boolean } | null>(null);
  const lastAdjustTokenRef = useRef<string>('');
  const previewRef = useRef<MockupUvPreview | null>(null);
  const composeGenRef = useRef(0);
  const liveRafRef = useRef(0);
  const pendingLiveRef = useRef<MockupPlacement | null>(null);
  placementRef.current = placement;
  designSrcRef.current = designSrc;

  const designW = kit?.fullWidth || template.width;
  const designH = kit?.fullHeight || template.height;

  // Load UV kit once per template (surface mapping — not per-drag render).
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const load = async () => {
        const next = await fetchMockupTemplateKit(template.id, KIT_SCALE);
        if (cancelled) return;
        setKit(next);
        if (!previewRef.current) {
          previewRef.current = createMockupUvPreview();
        }
        await previewRef.current.setKit({
          width: next.width,
          height: next.height,
          baseUrl: next.base,
          maskUrl: next.mask,
          uv: next.uv,
        });
        // Never paint kit.base over the user's plate — composite only after design.
        if (designSrcRef.current) {
          setLivePreviewUrl(previewRef.current.toDataURL());
        } else {
          setLivePreviewUrl(null);
        }
      };
      try {
        await load();
      } catch (firstErr) {
        console.warn('[mockup] kit', firstErr);
        try {
          await new Promise((r) => window.setTimeout(r, 600));
          if (cancelled) return;
          await load();
        } catch (err) {
          if (cancelled) return;
          console.warn('[mockup] kit retry', err);
          setKit(null);
          message.error(mockupErrorMessage(err, t('editor.imageToolbar.mockupPreviewFailed')));
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [template.id, t]);

  useEffect(() => {
    return () => {
      previewRef.current?.dispose();
      previewRef.current = null;
    };
  }, []);

  // Hide SVG underlay only while a design composite covers the plate.
  // Never replace the original image with bare kit.base / mask chrome.
  const overlayOwnsPixels = Boolean(designSrc && livePreviewUrl);
  useEffect(() => {
    if (!nodeId || !overlayOwnsPixels) return;
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
  }, [nodeId, camera, overlayOwnsPixels]);

  useEffect(() => {
    const savedDesign = String(node?.attrs?.mockupDesignSrc || '').trim();
    const savedPlacement = parseSavedPlacement(node?.attrs?.mockupPlacement);
    if (savedDesign) {
      setDesignSrc(savedDesign);
      setPlacement(savedPlacement || defaultMockupPlacement());
    } else {
      setDesignSrc(null);
      setPlacement(defaultMockupPlacement());
      // Restore original plate if a previous bake overwrote src.
      const baseSrc = String(node?.attrs?.mockupBaseSrc || '').trim();
      const curSrc = String(node?.attrs?.src || '').trim();
      if (baseSrc && curSrc && baseSrc !== curSrc) {
        dispatch(
          patchDocumentNode({
            nodeId,
            patch: { attrs: { src: baseSrc } },
            skipHostReload: true,
          })
        );
      }
    }
    setDesignSelected(false);
  }, [dispatch, nodeId, node?.attrs?.mockupDesignSrc, node?.attrs?.mockupPlacement, node?.attrs?.mockupBaseSrc, node?.attrs?.src]);

  // Toolbar "样机" again → enter FE adjust (no API).
  useEffect(() => {
    const token = String(node?.attrs?.mockupAdjust || '').trim();
    if (!token || token === lastAdjustTokenRef.current) return;
    lastAdjustTokenRef.current = token;
    if (designSrcRef.current) setDesignSelected(true);
  }, [node?.attrs?.mockupAdjust]);

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

  /** FE-only: compose sheet + WebGL UV remap (no /mockup/render). */
  const refreshLivePreview = useCallback(
    async (nextPlacement: MockupPlacement, nextDesign: string) => {
      const preview = previewRef.current;
      const activeKit = kit;
      if (!preview || !activeKit || !nextDesign) return;
      const gen = ++composeGenRef.current;
      try {
        const sheet = await composeMockupDesignSheet(
          nextDesign,
          nextPlacement,
          activeKit.fullWidth,
          activeKit.fullHeight
        );
        if (composeGenRef.current !== gen) return;
        await preview.setDesignSheet(sheet);
        if (composeGenRef.current !== gen) return;
        setLivePreviewUrl(preview.toDataURL());
      } catch (err) {
        console.warn('[mockup] fe preview', err);
      }
    },
    [kit]
  );

  const printForFit = useMemo(() => {
    const pf = kit?.printFull;
    if (pf && pf.w > 0 && pf.h > 0) {
      return {
        templateW: kit?.fullWidth || template.width,
        templateH: kit?.fullHeight || template.height,
        x: pf.x,
        y: pf.y,
        w: pf.w,
        h: pf.h,
      };
    }
    return undefined;
  }, [kit, template.width, template.height]);

  const assignDesignSrc = useCallback(
    async (src: string, autoSelect = false) => {
      const url = String(src || '').trim();
      if (!url) return;
      try {
        const { width, height } = await loadImageNaturalSize(url);
        const fit = autoFitMockupPlacement(width, height, printForFit);
        setDesignSrc(url);
        setPlacement(fit);
        setDesignSelected(autoSelect);
        persistPlacement(fit, url);
        await refreshLivePreview(fit, url);
      } catch (err) {
        console.warn('[mockup] design load', err);
        message.error(t('editor.imageToolbar.mockupFailed'));
      }
    },
    [persistPlacement, printForFit, refreshLivePreview, t]
  );

  const clearDesign = useCallback(() => {
    setDesignSrc(null);
    setPlacement(defaultMockupPlacement());
    setDesignSelected(false);
    setLivePreviewUrl(null);
    void previewRef.current?.setDesignSheet(null).catch(() => undefined);
    const baseSrc = String(node?.attrs?.mockupBaseSrc || '').trim();
    dispatch(
      patchDocumentNode({
        nodeId,
        patch: {
          attrs: {
            mockupDesignSrc: '',
            mockupPlacement: '',
            mockupTemplateId: template.id,
            ...(baseSrc ? { src: baseSrc } : {}),
          },
        },
        skipHostReload: true,
      })
    );
  }, [dispatch, node?.attrs?.mockupBaseSrc, nodeId, template.id]);

  // Drag-in already auto-fits via assignDesignSrc — no on-canvas autofit button.

  // When kit arrives after design already set, rebuild preview.
  useEffect(() => {
    if (!kit || !designSrc) return;
    void refreshLivePreview(placementRef.current, designSrc);
  }, [kit, designSrc, refreshLivePreview]);

  /** Canvas node drag → drop onto this mockup plate. */
  useEffect(() => {
    if (!box) return;

    const onDown = (e: PointerEvent) => {
      if (e.button !== 0) return;
      pointerGestureRef.current = { x: e.clientX, y: e.clientY, moved: false };
    };
    const onMove = (e: PointerEvent) => {
      const g = pointerGestureRef.current;
      if (!g || g.moved) return;
      if (Math.hypot(e.clientX - g.x, e.clientY - g.y) >= CANVAS_ABSORB_MOVE_PX) {
        g.moved = true;
      }
    };
    const tryAbsorb = () => {
      if (absorbLockRef.current) return;
      const designId = String(selectedNodeId || '').trim();
      if (!designId || designId === nodeId) return;
      const designNode = document?.deltaSetLike?.[designId];
      if (!designNode || designNode.key !== 'image') return;
      if (isMockupNodeActive(designNode.attrs || {})) return;
      const src = String(designNode.attrs?.src || '').trim();
      if (!src) return;
      const design = liveShapeGeomBox(designId) || nodeBox(document, designNode);
      const liveHost = liveShapeGeomBox(nodeId) || (node ? nodeBox(document, node) : null);
      if (!design || !liveHost) return;
      if (!mockupContainsDesignCenter(liveHost, design)) return;

      absorbLockRef.current = true;
      void (async () => {
        try {
          await assignDesignSrc(src, false);
          dispatch(removeDocumentNodes({ nodeIds: [designId] }));
          dispatch(setSelectedNodeId(nodeId));
        } catch (err) {
          console.warn('[mockup] canvas absorb', err);
          message.error(mockupErrorMessage(err, t('editor.imageToolbar.mockupFailed')));
        } finally {
          window.setTimeout(() => {
            absorbLockRef.current = false;
          }, 400);
        }
      })();
    };
    const onUp = () => {
      const gesture = pointerGestureRef.current;
      pointerGestureRef.current = null;
      if (!gesture?.moved) return;
      window.requestAnimationFrame(() => {
        window.requestAnimationFrame(tryAbsorb);
      });
    };

    window.addEventListener('pointerdown', onDown, true);
    window.addEventListener('pointermove', onMove, true);
    window.addEventListener('pointerup', onUp, true);
    return () => {
      window.removeEventListener('pointerdown', onDown, true);
      window.removeEventListener('pointermove', onMove, true);
      window.removeEventListener('pointerup', onUp, true);
    };
  }, [assignDesignSrc, box, dispatch, document, node, nodeId, selectedNodeId, t]);

  // Auto-bake FE composite into node.src when idle (not adjusting).
  useEffect(() => {
    if (!nodeId || !designSrc || !livePreviewUrl || designSelected) return;
    const seq = ++applySeqRef.current;
    const timer = window.setTimeout(() => {
      void (async () => {
        try {
          const uploaded = await uploadImageFromSrcWithLocalFallback(
            livePreviewUrl,
            'mockup.png'
          );
          if (applySeqRef.current !== seq) return;
          dispatch(
            patchDocumentNode({
              nodeId,
              patch: {
                attrs: {
                  src: uploaded.url || livePreviewUrl,
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
  }, [nodeId, designSrc, livePreviewUrl, designSelected, template.id, dispatch]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (ctxMenu) {
          e.preventDefault();
          setCtxMenu(null);
          return;
        }
        if (designSelected) {
          e.preventDefault();
          setDesignSelected(false);
        }
        return;
      }
      if ((e.key === 'Delete' || e.key === 'Backspace') && designSrc) {
        const tag = (e.target as HTMLElement | null)?.tagName || '';
        if (/^(INPUT|TEXTAREA|SELECT)$/i.test(tag) || (e.target as HTMLElement)?.isContentEditable) {
          return;
        }
        // Plate selected (or design handles active) → remove texture, keep mockup image.
        if (selectedNodeId !== nodeId && !designSelected) return;
        e.preventDefault();
        e.stopPropagation();
        setCtxMenu(null);
        clearDesign();
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [clearDesign, ctxMenu, designSelected, designSrc, nodeId, selectedNodeId]);

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
      readImageFile(file, (url) => void assignDesignSrc(url, false));
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

  // Right-click on plate with a texture → 「删除贴图」 (no on-canvas buttons).
  useEffect(() => {
    if (!designSrc || !screenRect) return;
    const onCtx = (e: MouseEvent) => {
      const r = screenRect;
      if (!pointInScreenRect(e.clientX, e.clientY, r.left, r.top, r.width, r.height)) return;
      e.preventDefault();
      e.stopPropagation();
      setCtxMenu({ x: e.clientX, y: e.clientY });
      setDesignSelected(true);
      dispatch(setSelectedNodeId(nodeId));
    };
    window.addEventListener('contextmenu', onCtx, true);
    return () => window.removeEventListener('contextmenu', onCtx, true);
  }, [designSrc, dispatch, nodeId, screenRect]);

  useEffect(() => {
    if (!ctxMenu) return;
    const close = () => setCtxMenu(null);
    window.addEventListener('pointerdown', close, true);
    return () => window.removeEventListener('pointerdown', close, true);
  }, [ctxMenu]);

  useEffect(() => {
    if (!screenRect) return;
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
        void assignDesignSrc(droppedUrl, false);
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
  }, [screenRect, resolveDropSrc, onFiles, assignDesignSrc]);

  const onPlacementChange = useCallback(
    (next: MockupPlacement) => {
      setPlacement(next);
      if (designSrc) {
        persistPlacement(next, designSrc);
        void refreshLivePreview(next, designSrc);
      }
    },
    [designSrc, persistPlacement, refreshLivePreview]
  );

  const onLivePlacementChange = useCallback(
    (next: MockupPlacement) => {
      if (!designSrc) return;
      pendingLiveRef.current = next;
      if (liveRafRef.current) return;
      liveRafRef.current = window.requestAnimationFrame(() => {
        liveRafRef.current = 0;
        const p = pendingLiveRef.current;
        const src = designSrcRef.current;
        if (p && src) void refreshLivePreview(p, src);
      });
    },
    [designSrc, refreshLivePreview]
  );

  if (!node || !box || !screenRect) return null;

  const z = Math.max(0.05, rcbCameraCssZoom(camera));
  const origin = rcbSceneToScreen(camera, box.left, box.top);
  const stageW = box.width * z;
  const stageH = box.height * z;
  const showComposite = Boolean(designSrc && livePreviewUrl);
  // Only cover the original plate when we have a warped composite — never kit.base alone.
  const backdrop = showComposite ? livePreviewUrl : null;

  return (
    <RcbOverlayPortal>
      <div data-mockup-session={nodeId} className="pointer-events-none absolute inset-0 z-[36]">
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
          {backdrop ? (
            <img
              src={backdrop}
              alt=""
              className="absolute inset-0 h-full w-full object-contain"
              draggable={false}
            />
          ) : null}

          {designSrc ? (
            <MockupDesignLayer
              imageBox={box}
              designSrc={designSrc}
              placement={placement}
              selected={designSelected}
              onSelect={() => setDesignSelected(true)}
              onPlacementChange={onPlacementChange}
              onLivePlacementChange={onLivePlacementChange}
              templateW={designW}
              templateH={designH}
              ghostHitOnly={!designSelected && showComposite}
              hideDesignImage={showComposite}
            />
          ) : null}
        </div>

        {ctxMenu ? (
          <div
            className="pointer-events-auto fixed z-[80] min-w-[140px] rounded-md border border-[var(--line)] bg-[var(--surface)] py-1 shadow-lg"
            style={{ left: ctxMenu.x, top: ctxMenu.y }}
            onPointerDown={(e) => e.stopPropagation()}
          >
            <button
              type="button"
              className="flex w-full px-3 py-1.5 text-left text-[12px] text-[var(--ink)] hover:bg-[var(--accent-soft)]"
              onClick={(e) => {
                e.stopPropagation();
                setCtxMenu(null);
                clearDesign();
              }}
            >
              {t('editor.imageToolbar.mockupClearDesign')}
            </button>
          </div>
        ) : null}
      </div>
    </RcbOverlayPortal>
  );
}

export default memo(MockupSessionHost);
