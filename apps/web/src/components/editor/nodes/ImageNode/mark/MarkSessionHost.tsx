import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
  memo,
} from 'react';
import { createPortal } from 'react-dom';
import { useDispatch, useSelector } from 'react-redux';
import { useTranslation } from 'react-i18next';
import { HiOutlinePlus } from 'react-icons/hi2';
import { nanoid } from 'nanoid';
import { message } from '@/components/base';
import { rcbSceneToScreen, useRcbCamera } from '@/components/rcb';
import { nodeLeftTop } from '@/components/rcb/scene/paint/sceneToSvg';
import {
  closeImageToolPanel,
  enqueueAgentContexts,
  enqueueQuickEditMarkContexts,
  markPanelSink,
  openImageToolPanel,
  type ImageToolPanelState,
  type PendingMarkContextChip,
} from '@/store/modules/editor';
import { getHttpErrorMessage } from '@/service/client';
import {
  processImageTool,
  useImageToolCapabilities,
  type ImageDecomposeLayer,
} from '@/service/imageTools';
import { imageSrcToFile } from '@/utils/uploadImage';
import MarkRegionOverlay, {
  type MarkRect,
  type MarkRegion,
} from './MarkRegionOverlay';
import type { SceneDocument, SceneNodeInput } from '@/components/rcb/sceneNode';

type SceneBox = { left: number; top: number; width: number; height: number };

function nodeBox(
  document: SceneDocument,
  node: SceneNodeInput
): SceneBox | null {
  if (!node) return null;
  const { left, top } = nodeLeftTop(document, node);
  return {
    left,
    top,
    width: Math.max(1, Number(node.width) || 1),
    height: Math.max(1, Number(node.height) || 1),
  };
}

function regionLabel(layer: ImageDecomposeLayer, index: number): string {
  const name = String(layer.name || '').trim();
  if (layer.type === 'text') {
    const text = String(layer.text || '').trim();
    if (text) return `${index} "${text.slice(0, 24)}"`;
    return `${index} 文字`;
  }
  if (name && name !== '区域' && name !== '文字' && name !== '主体') {
    return `${index} ${name}`;
  }
  return `${index} 区域`;
}

/** Chip label in Agent composer — `[1] 区域` / `[1] 中秋团圆`. */
function markComposerChipLabel(region: MarkRegion): string {
  if (region.kind === 'text') {
    const quoted = region.label?.match(/"([^"]+)"/)?.[1];
    const text = quoted || region.label?.replace(/^\d+\s*/, '').trim();
    if (text && text !== '文字') return `[${region.index}] ${text}`;
  }
  return `[${region.index}] 区域`;
}

/** Map API source-pixel layers → image-local mark regions. */
function layersToRegions(
  layers: ImageDecomposeLayer[],
  naturalW: number,
  naturalH: number,
  nodeW: number,
  nodeH: number
): MarkRegion[] {
  const sx = nodeW / Math.max(1, naturalW);
  const sy = nodeH / Math.max(1, naturalH);
  const out: MarkRegion[] = [];
  for (const layer of layers) {
    if (layer.type !== 'image' && layer.type !== 'text') continue;
    const x = Number(layer.x) || 0;
    const y = Number(layer.y) || 0;
    const w = Math.max(1, Number(layer.width) || 1);
    const h = Math.max(1, Number(layer.height) || 1);
    const rw = w * sx;
    const rh = h * sy;
    // Skip full-canvas subject masks only — keep OCR text boxes even when large.
    if (
      layer.type !== 'text' &&
      rw >= nodeW * 0.96 &&
      rh >= nodeH * 0.96
    ) {
      continue;
    }
    const index = out.length + 1;
    out.push({
      id: nanoid(8),
      index,
      x: x * sx,
      y: y * sy,
      w: w * sx,
      h: h * sy,
      kind: layer.type,
      label: regionLabel(layer, index),
      selected: false,
    });
  }
  return out;
}

async function loadImageForCrop(
  src: string,
  uploadKey?: string | null
): Promise<{ img: HTMLImageElement; revoke: () => void }> {
  const file = await imageSrcToFile(src, 'mark-crop.png', { uploadKey });
  const blobUrl = URL.createObjectURL(file);
  const img = await new Promise<HTMLImageElement>((resolve, reject) => {
    const el = new Image();
    el.onload = () => resolve(el);
    el.onerror = () => {
      URL.revokeObjectURL(blobUrl);
      reject(new Error('image load failed'));
    };
    el.src = blobUrl;
  });
  return { img, revoke: () => URL.revokeObjectURL(blobUrl) };
}

/** Crop image-local mark rect → PNG data URL (natural pixels). */
async function cropMarkRegionDataUrl(
  src: string,
  nodeW: number,
  nodeH: number,
  rect: MarkRect,
  uploadKey?: string | null
): Promise<string> {
  const { img, revoke } = await loadImageForCrop(src, uploadKey);
  try {
    const nw = Math.max(1, img.naturalWidth || img.width || 1);
    const nh = Math.max(1, img.naturalHeight || img.height || 1);
    const sx = (rect.x / Math.max(1, nodeW)) * nw;
    const sy = (rect.y / Math.max(1, nodeH)) * nh;
    const sw = Math.max(1, (rect.w / Math.max(1, nodeW)) * nw);
    const sh = Math.max(1, (rect.h / Math.max(1, nodeH)) * nh);
    const canvas = globalThis.document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(sw));
    canvas.height = Math.max(1, Math.round(sh));
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('canvas unsupported');
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(img, sx, sy, sw, sh, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL('image/png');
  } finally {
    revoke();
  }
}

function buildMarkChipPayload(
  nodeId: string,
  region: MarkRegion,
  nodeW: number,
  nodeH: number
): string {
  const nx = (region.x / nodeW).toFixed(3);
  const ny = (region.y / nodeH).toFixed(3);
  const nw = (region.w / nodeW).toFixed(3);
  const nh = (region.h / nodeH).toFixed(3);
  const tag = region.kind === 'text' ? 'text' : 'subject';
  return [
    '[Marked image region — edit this area on the referenced image]',
    `node_id: ${nodeId}`,
    `region: #${region.index}(${tag}@${nx},${ny},${nw}x${nh})`,
    `label: ${region.label || `区域 ${region.index}`}`,
  ].join('\n');
}

/**
 * Mark session: region detect + manual box select.
 * Toolbar mark → AgentDock; quick-edit mark → floating composer.
 */
function MarkSessionHost({ document }: { document: SceneDocument }): ReactNode {
  const dispatch = useDispatch();
  const { t } = useTranslation();
  const camera = useRcbCamera();
  const { data: imageToolCaps } = useImageToolCapabilities();
  const ilpEnabled = imageToolCaps?.ilp?.enabled === true;
  const panel = useSelector(
    (s: any) => s.editor.imageToolPanel as ImageToolPanelState | null
  );
  const active = panel?.kind === 'mark' ? panel.nodeId : null;
  const markSink = markPanelSink(panel);
  const node = active ? document?.deltaSetLike?.[active] : null;
  const box = useMemo(
    () => (active && node ? nodeBox(document, node) : null),
    [document, active, node]
  );
  const src = String(node?.attrs?.src || '').trim();
  const uploadKey =
    String(node?.attrs?.uploadKey || node?.attrs?.key || '').trim() || null;

  const [regions, setRegions] = useState<MarkRegion[]>([]);
  const [draft, setDraft] = useState<MarkRect | null>(null);
  const [detecting, setDetecting] = useState(false);
  const [promptText, setPromptText] = useState('');
  const [activeRegionId, setActiveRegionId] = useState<string | null>(null);
  const [hoverRegionId, setHoverRegionId] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const detectGenRef = useRef(0);
  const inflightRef = useRef<Set<string>>(new Set());

  const close = () => {
    if (markSink === 'quickEdit' && active) {
      dispatch(openImageToolPanel({ nodeId: active, kind: 'quickEdit' }));
      return;
    }
    dispatch(closeImageToolPanel());
  };

  useEffect(() => {
    if (!active) {
      setPromptText('');
      setHoverRegionId(null);
      setActiveRegionId(null);
    }
  }, [active]);

  useEffect(() => {
    if (!active) return;
    if (!node || node.key !== 'image') close();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, node?.key]);

  useEffect(() => {
    if (!active) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        close();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active]);

  useEffect(() => {
    if (!active || !src || !box) return;
    setRegions([]);
    setDraft(null);
    if (!ilpEnabled) {
      setDetecting(false);
      message.warning(t('editor.imageToolbar.markNeedsIntelligence'));
      return;
    }
    const gen = ++detectGenRef.current;
    setDetecting(true);
    abortRef.current?.abort();
    const ac = new AbortController();
    abortRef.current = ac;

    async function runDetect() {
      try {
        const res = await processImageTool(
          { kind: 'detectRegions', image: src },
          { signal: ac.signal }
        );
        if (gen !== detectGenRef.current) return;
        const nw = Math.max(1, Number(res.width) || box!.width);
        const nh = Math.max(1, Number(res.height) || box!.height);
        const next = layersToRegions(
          res.layers || [],
          nw,
          nh,
          box!.width,
          box!.height
        ).map((r, i) => ({
          ...r,
          index: i + 1,
          selected: i === 0,
        }));
        setRegions(next);
        if (next[0]) {
          setActiveRegionId(next[0].id);
        }
        if (!next.length) {
          message.info(t('editor.imageToolbar.markNoRegions'));
        }
      } catch (err: unknown) {
        if (ac.signal.aborted || gen !== detectGenRef.current) return;
        const msg = getHttpErrorMessage(err, '');
        if (msg && !/unsupported kind|detectRegions/i.test(msg)) {
          console.warn('[mark] detect failed', msg);
          message.error(t('editor.imageToolbar.markDetectFailed'));
        }
      } finally {
        if (gen === detectGenRef.current) setDetecting(false);
      }
    }
    void runDetect();

    return () => {
      ac.abort();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, src, ilpEnabled]);

  useEffect(() => {
    return () => {
      abortRef.current?.abort();
    };
  }, []);

  const renumber = (list: MarkRegion[]): MarkRegion[] =>
    list.map((r, i) => ({
      ...r,
      index: i + 1,
      label:
        r.kind === 'manual'
          ? `${i + 1} 区域`
          : r.label?.replace(/^\d+\s*/, `${i + 1} `) || `${i + 1} 区域`,
    }));

  const enqueueRegionMark = async (
    region: MarkRegion,
    opts?: { appendText?: string }
  ) => {
    if (!active || !box || !src) return;
    if (!opts?.appendText && inflightRef.current.has(region.id)) return;
    if (!opts?.appendText) inflightRef.current.add(region.id);

    const tail = String(opts?.appendText || '').trim();
    const thumbEarly = await cropMarkRegionDataUrl(
      src,
      box.width,
      box.height,
      region,
      uploadKey
    ).catch(() => undefined);

    const chip: PendingMarkContextChip = {
      key: `mark:${active}:${region.id}:${Date.now()}`,
      label: markComposerChipLabel(region),
      kind: 'image',
      payload: buildMarkChipPayload(active, region, box.width, box.height),
      ...(tail ? { appendText: ` ${tail}` } : {}),
      ...(thumbEarly ? { dataUrl: thumbEarly, thumbUrl: thumbEarly } : {}),
    };

    if (markSink === 'quickEdit') {
      dispatch(enqueueQuickEditMarkContexts([chip]));
    } else {
      dispatch(enqueueAgentContexts([chip]));
    }
    if (!opts?.appendText) inflightRef.current.delete(region.id);
  };

  const onCommitDraft = (rect: MarkRect) => {
    const nextRegion: MarkRegion = {
      id: nanoid(8),
      index: regions.length + 1,
      ...rect,
      kind: 'manual',
      label: `${regions.length + 1} 区域`,
      selected: true,
    };
    setRegions((prev) => {
      const cleared = prev.map((r) => ({ ...r, selected: false }));
      return renumber([...cleared, nextRegion]);
    });
    setActiveRegionId(nextRegion.id);
    enqueueRegionMark(nextRegion);
  };

  const onSelectRegion = (id: string, _additive: boolean) => {
    const hit = regions.find((r) => r.id === id);
    setActiveRegionId(id);
    setRegions((prev) => prev.map((r) => ({ ...r, selected: r.id === id })));
    if (hit) enqueueRegionMark(hit);
  };

  const promptRegion =
    regions.find((r) => r.id === (hoverRegionId ?? activeRegionId)) || null;
  const promptStyle = useMemo(() => {
    if (!box || !promptRegion) return null;
    const center = rcbSceneToScreen(
      camera,
      box.left + promptRegion.x + promptRegion.w / 2,
      box.top + promptRegion.y
    );
    return {
      position: 'fixed' as const,
      left: center.x,
      top: Math.max(72, center.y - 52),
      transform: 'translate(-50%, -100%)',
      zIndex: 9998,
    };
  }, [box, promptRegion, camera]);

  if (!active || !box || !node) return null;

  return (
    <>
      <MarkRegionOverlay
        imageBox={box}
        regions={regions}
        draft={draft}
        detecting={detecting}
        onDraftChange={setDraft}
        onCommitDraft={onCommitDraft}
        onSelectRegion={onSelectRegion}
        onHoverRegion={setHoverRegionId}
      />
      {promptStyle && promptRegion
        ? createPortal(
            <div
              data-mark-prompt
              data-image-tool-panel
              className="pointer-events-auto flex min-w-[min(92vw,360px)] max-w-[min(92vw,420px)] items-center gap-2 rounded-2xl border border-[var(--line)] bg-white/95 px-3 py-2 shadow-[0_12px_40px_rgba(15,23,42,0.16)] backdrop-blur-sm"
              style={promptStyle}
              onPointerDown={(e) => e.stopPropagation()}
            >
              <button
                type="button"
                className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-[var(--muted)] hover:bg-[var(--surface-2)]"
                aria-label={t('editor.imageToolbar.markAddRef')}
              >
                <HiOutlinePlus className="h-4 w-4" />
              </button>
              <span className="inline-flex h-6 shrink-0 items-center rounded-md bg-sky-50 px-1.5 text-[12px] font-semibold text-sky-700 ring-1 ring-sky-200">
                {markComposerChipLabel(promptRegion)}
              </span>
              <input
                type="text"
                value={promptText}
                onChange={(e) => setPromptText(e.target.value)}
                placeholder={t('editor.imageToolbar.markPromptPh')}
                className="min-w-0 flex-1 border-0 bg-transparent text-[13px] text-[var(--ink)] outline-none placeholder:text-[var(--muted)]"
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.nativeEvent.isComposing) {
                    e.preventDefault();
                    const text = promptText.trim();
                    void enqueueRegionMark(promptRegion, { appendText: text });
                    if (text) setPromptText('');
                  }
                }}
              />
            </div>,
            globalThis.document.body
          )
        : null}
    </>
  );
}

export default memo(MarkSessionHost);
