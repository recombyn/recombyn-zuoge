import {
  useCallback,
  useEffect,
  useMemo,
  useId,
  useRef,
  useState,
  type DragEvent,
  type ReactNode,
  memo,
} from 'react';
import { useDispatch, useSelector } from 'react-redux';
import { useTranslation } from 'react-i18next';
import { BiExit } from 'react-icons/bi';
import { TbShirt } from 'react-icons/tb';
import { message } from '@/components/base';
import {
  RcbOverlayPortal,
  rcbCameraCssZoom,
  rcbSceneToScreen,
  rcbScreenPxToScene,
  useRcbCamera,
  useRcbScreenToolbarStyle,
} from '@/components/rcb';
import { nodeLeftTop } from '@/components/rcb/scene/paint/sceneToSvg';
import { useImageToolCapabilities } from '@/service/imageTools';
import { isMockupEnabled, mockupErrorMessage } from '@/service/mockupTools';
import { uploadImageFromSrcWithLocalFallback } from '@/utils/uploadImage';
import { cn } from '@/utils/classnames';
import {
  closeImageToolPanel,
  patchDocumentNode,
} from '@/store/modules/editor';
import type { SceneDocument, SceneNodeInput } from '@/components/rcb/sceneNode';
import { renderMockup } from '@/private/mockup/mockupTools';
import MockupDesignLayer from '@/private/mockup/MockupDesignLayer';
import {
  autoFitMockupPlacement,
  composeMockupDesignSheet,
  defaultMockupPlacement,
  loadImageNaturalSize,
  parseMockupPlacement,
  type MockupPlacement,
} from '@/private/mockup/mockupPlacement';
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

/** Interactive mockup: drag design onto product, adjust placement, live cylindrical preview. */
function MockupSessionHost({ document }: { document: SceneDocument }): ReactNode {
  const dispatch = useDispatch();
  const { t } = useTranslation();
  const camera = useRcbCamera();
  const uploadInputId = useId();
  const { data: imageToolCaps } = useImageToolCapabilities();
  const mockupEnabled = isMockupEnabled(imageToolCaps);

  const panel = useSelector(
    (s: any) => s.editor.imageToolPanel as null | { nodeId: string; kind: string }
  );
  const selectedNodeId = useSelector((s: any) => s.editor.selectedNodeId as string | null);

  const sessionOpen = panel?.kind === 'mockup' && mockupEnabled;
  const nodeId = sessionOpen ? panel!.nodeId : null;
  const node = nodeId ? document?.deltaSetLike?.[nodeId] : null;
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

  const [baseSrc, setBaseSrc] = useState<string | null>(null);
  const [designSrc, setDesignSrc] = useState<string | null>(null);
  const [placement, setPlacement] = useState<MockupPlacement>(() => defaultMockupPlacement());
  const [designSelected, setDesignSelected] = useState(false);
  const [previewSrc, setPreviewSrc] = useState<string | null>(null);
  const [previewBusy, setPreviewBusy] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [rendering, setRendering] = useState(false);
  const previewSeqRef = useRef(0);
  const placementRef = useRef(placement);
  placementRef.current = placement;

  const close = useCallback(() => dispatch(closeImageToolPanel()), [dispatch]);

  useEffect(() => {
    if (panel?.kind === 'mockup' && !mockupEnabled) {
      dispatch(closeImageToolPanel());
    }
  }, [panel?.kind, mockupEnabled, dispatch]);

  useEffect(() => {
    if (!sessionOpen || !nodeId) {
      setBaseSrc(null);
      setDesignSrc(null);
      setPlacement(defaultMockupPlacement());
      setDesignSelected(false);
      setPreviewSrc(null);
      setPreviewBusy(false);
      setDragOver(false);
      setRendering(false);
      return;
    }
    const src = String(node?.attrs?.src || '').trim();
    setBaseSrc(src || null);
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
      setDesignSelected(false);
    } else {
      setDesignSrc(null);
      setPlacement(defaultMockupPlacement());
      setDesignSelected(false);
    }
    setPreviewSrc(null);
  }, [sessionOpen, nodeId, node?.attrs?.src, node?.attrs?.mockupDesignSrc, node?.attrs?.mockupPlacement]);

  const assignDesignSrc = useCallback(async (src: string, autoSelect = true) => {
    const url = String(src || '').trim();
    if (!url) return;
    try {
      const { width, height } = await loadImageNaturalSize(url);
      const fit = autoFitMockupPlacement(width, height);
      setDesignSrc(url);
      setPlacement(fit);
      setDesignSelected(autoSelect);
      setPreviewSrc(null);
    } catch (err) {
      console.warn('[mockup] design load', err);
      message.error(t('editor.imageToolbar.mockupFailed'));
    }
  }, [t]);

  // Another on-canvas image becomes the design source (not the mockup host).
  useEffect(() => {
    if (!sessionOpen || !nodeId) return;
    if (!selectedNodeId || selectedNodeId === nodeId) return;
    const other = document?.deltaSetLike?.[selectedNodeId];
    if (other?.key !== 'image') return;
    const src = String(other?.attrs?.src || '').trim();
    if (!src) return;
    void assignDesignSrc(src, true);
  }, [sessionOpen, nodeId, selectedNodeId, document, assignDesignSrc]);

  // Debounced cylindrical preview whenever placement or design changes.
  useEffect(() => {
    if (!sessionOpen || !designSrc) {
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
  }, [sessionOpen, designSrc, placement, template.id, template.width, template.height, designSelected]);

  useEffect(() => {
    if (!sessionOpen || !nodeId) return;
    if (!node || node.key !== 'image') close();
  }, [sessionOpen, nodeId, node, close]);

  useEffect(() => {
    if (!sessionOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        if (designSelected) {
          setDesignSelected(false);
          return;
        }
        close();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [sessionOpen, designSelected, close]);

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

  const onDragOver = useCallback((e: DragEvent) => {
    const dt = e.dataTransfer;
    const hasFile = Array.from(dt?.types || []).includes('Files');
    const hasAsset =
      dataTransferHasMediaAsset(dt) || dataTransferHasChatImage(dt) || hasFile;
    if (!hasAsset) return;
    e.preventDefault();
    e.stopPropagation();
    if (dt) dt.dropEffect = 'copy';
    setDragOver(true);
  }, []);

  const onDragLeave = useCallback((e: DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragOver(false);
  }, []);

  const onDrop = useCallback(
    (e: DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      setDragOver(false);
      const droppedUrl = resolveDropSrc(e.dataTransfer);
      if (droppedUrl) {
        void assignDesignSrc(droppedUrl, true);
        return;
      }
      onFiles(e.dataTransfer.files);
    },
    [onFiles, resolveDropSrc, assignDesignSrc]
  );

  const onApply = async () => {
    if (!nodeId || !designSrc || rendering) return;
    setRendering(true);
    const hide = message.loading(t('editor.imageToolbar.processingMockup'), 0);
    try {
      let image = previewSrc;
      if (!image) {
        const sheet = await composeMockupDesignSheet(
          designSrc,
          placementRef.current,
          template.width,
          template.height
        );
        const result = await renderMockup(sheet, template.id);
        image = String(result.image || '').trim() || null;
      }
      if (!image) throw new Error(t('editor.imageToolbar.mockupFailed'));
      const uploaded = await uploadImageFromSrcWithLocalFallback(image, 'mockup.png');
      dispatch(
        patchDocumentNode({
          nodeId,
          patch: {
            attrs: {
              src: uploaded.url || image,
              mockupTemplateId: template.id,
              mockupDesignSrc: designSrc,
              mockupPlacement: JSON.stringify(placementRef.current),
            },
          },
        })
      );
      setBaseSrc(uploaded.url || image);
      setDesignSelected(false);
      message.success(t('editor.imageToolbar.mockupDone'));
    } catch (err) {
      console.warn('[mockup]', err);
      const raw = mockupErrorMessage(err, '');
      const msg =
        /failed to fetch|networkerror|load failed/i.test(raw)
          ? t('agent.apiDown')
          : raw || t('editor.imageToolbar.mockupFailed');
      message.error(msg);
    } finally {
      hide();
      setRendering(false);
    }
  };

  const z = Math.max(0.05, rcbCameraCssZoom(camera));
  const toolbarGap = rcbScreenPxToScene(10, z);
  const footerStyle = useRcbScreenToolbarStyle({
    left: box ? box.left + box.width / 2 : 0,
    top: box ? box.top + box.height + toolbarGap : 0,
    anchor: 'top',
  });

  if (!sessionOpen || !nodeId || !box || !node) return null;

  const origin = rcbSceneToScreen(camera, box.left, box.top);
  const stageW = box.width * z;
  const stageH = box.height * z;
  const headerH = 28;
  const dimLabel = `${template.width} × ${template.height}`;
  const adjusting = Boolean(designSrc && designSelected);
  const stageBg = adjusting ? baseSrc : previewSrc || baseSrc;
  const showDropHint = !designSrc;

  return (
    <RcbOverlayPortal>
      <div
        data-mockup-session
        data-image-tool-panel
        className="pointer-events-none absolute inset-0 z-[36]"
      >
        <div
          className="pointer-events-auto absolute flex items-center justify-between gap-3 text-[12px] font-medium text-[var(--accent)]"
          style={{
            left: origin.x,
            top: origin.y - headerH - 4,
            width: stageW,
            height: headerH,
          }}
          data-image-tool-panel
          onPointerDown={(e) => e.stopPropagation()}
        >
          <span className="inline-flex items-center gap-1.5">
            <TbShirt className="h-4 w-4 shrink-0" strokeWidth={2} />
            <span>{t('editor.imageToolbar.mockup')}</span>
          </span>
          <span className="inline-flex items-center gap-2">
            <span className="max-w-[9rem] truncate text-[11px] font-normal" title={template.name}>
              {template.name}
            </span>
            <span className="tabular-nums text-[11px] font-normal text-[var(--muted)]">{dimLabel}</span>
            <button
              type="button"
              aria-label="退出"
              className="inline-flex h-6 w-6 items-center justify-center rounded-md text-[var(--muted)] hover:bg-[var(--accent-soft)] hover:text-[var(--ink)]"
              onClick={close}
            >
              <BiExit className="h-4 w-4" />
            </button>
          </span>
        </div>

        <div
          className="pointer-events-auto absolute overflow-hidden rounded-sm ring-2 ring-[var(--accent)]"
          style={{
            left: origin.x,
            top: origin.y,
            width: stageW,
            height: stageH,
          }}
          data-image-tool-panel
          onPointerDown={(e) => {
            e.stopPropagation();
            if (!designSrc) return;
            const t = e.target as HTMLElement;
            if (!t.closest('[data-mockup-design-layer]')) {
              setDesignSelected(false);
            }
          }}
          onDragOver={onDragOver}
          onDragLeave={onDragLeave}
          onDrop={onDrop}
        >
          {stageBg ? (
            <img
              src={stageBg}
              alt=""
              className="absolute inset-0 h-full w-full object-contain bg-[var(--surface-2)]"
              draggable={false}
              onPointerDown={() => {
                if (designSrc && !designSelected) setDesignSelected(true);
              }}
            />
          ) : (
            <div className="absolute inset-0 bg-[var(--surface-2)]" />
          )}

          {previewBusy ? (
            <div className="pointer-events-none absolute inset-0 flex items-center justify-center bg-black/20 text-[13px] font-medium text-white">
              {t('editor.imageToolbar.mockupPreviewLoading')}
            </div>
          ) : null}

          {designSrc && adjusting ? (
            <MockupDesignLayer
              imageBox={box}
              designSrc={designSrc}
              placement={placement}
              selected={designSelected}
              onSelect={() => setDesignSelected(true)}
              onPlacementChange={setPlacement}
              templateW={template.width}
              templateH={template.height}
            />
          ) : null}

          {!previewBusy && designSrc && !previewSrc && !adjusting ? (
            <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center gap-2 bg-black/35 px-4 text-center text-[13px] font-medium text-white">
              <span>{t('editor.imageToolbar.mockupPreviewFailed')}</span>
            </div>
          ) : null}

          {showDropHint ? (
            <div className="absolute inset-0 flex items-center justify-center bg-black/10">
              <label
                htmlFor={uploadInputId}
                data-image-tool-panel
                className={cn(
                  'pointer-events-auto max-w-[88%] cursor-pointer rounded-full px-4 py-2 text-center text-[13px] font-medium text-white shadow-lg transition',
                  dragOver ? 'scale-[1.02] bg-black/75' : 'bg-black/55 hover:bg-black/65'
                )}
                onPointerDown={(e) => e.stopPropagation()}
                onClick={(e) => e.stopPropagation()}
              >
                {t('editor.imageToolbar.mockupDropHint')}
              </label>
              <input
                id={uploadInputId}
                type="file"
                accept="image/*"
                className="sr-only"
                onChange={(e) => {
                  onFiles(e.target.files);
                  e.target.value = '';
                }}
              />
            </div>
          ) : designSrc ? (
            <div className="pointer-events-none absolute bottom-2 left-1/2 flex -translate-x-1/2 gap-2">
              <button
                type="button"
                className="pointer-events-auto rounded-full bg-black/55 px-3 py-1 text-[11px] font-medium text-white shadow hover:bg-black/65"
                onPointerDown={(e) => e.stopPropagation()}
                onClick={(e) => {
                  e.stopPropagation();
                  setDesignSelected(true);
                }}
              >
                {t('editor.imageToolbar.mockupAdjust')}
              </button>
              <label
                htmlFor={uploadInputId}
                className="pointer-events-auto cursor-pointer rounded-full bg-black/55 px-3 py-1 text-[11px] font-medium text-white shadow hover:bg-black/65"
                onPointerDown={(e) => e.stopPropagation()}
                onClick={(e) => e.stopPropagation()}
              >
                {t('editor.imageToolbar.mockupChangeDesign')}
                <input
                  id={uploadInputId}
                  type="file"
                  accept="image/*"
                  className="sr-only"
                  onChange={(e) => {
                    onFiles(e.target.files);
                    e.target.value = '';
                  }}
                />
              </label>
            </div>
          ) : null}
        </div>

        <div
          data-mockup-toolbar
          data-image-tool-panel
          className="pointer-events-auto absolute z-[37]"
          style={footerStyle}
          onPointerDown={(e) => e.stopPropagation()}
        >
          <button
            type="button"
            disabled={!designSrc || rendering || previewBusy}
            className={cn(
              'inline-flex h-9 min-w-[120px] items-center justify-center rounded-full px-5 text-[13px] font-medium shadow-md transition',
              designSrc && !rendering && !previewBusy
                ? 'bg-white text-[var(--ink)] hover:bg-white/95'
                : 'cursor-not-allowed bg-white/60 text-[var(--muted)]'
            )}
            onClick={() => void onApply()}
          >
            {t('editor.imageToolbar.mockupApply')}
          </button>
        </div>
      </div>
    </RcbOverlayPortal>
  );
}

export default memo(MockupSessionHost);
