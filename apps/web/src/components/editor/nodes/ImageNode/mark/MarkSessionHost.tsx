import { useEffect, useMemo, useRef, useState, type ReactNode, memo } from 'react';
import { createPortal } from 'react-dom';
import { useDispatch, useSelector } from 'react-redux';
import { useTranslation } from 'react-i18next';
import { nanoid } from 'nanoid';
import { message } from '@/components/base';
import { useRcbCamera } from '@/components/rcb';
import {
  closeImageToolPanel,
  markPanelSink,
  openImageToolPanel,
  type ImageToolPanelState,
  type ImageMarkPin,
} from '@/store/modules/editor';
import { getHttpErrorMessage } from '@/service/client';
import {
  processImageTool,
  useImageToolCapabilities,
  type ImageDecomposeLayer,
} from '@/service/imageTools';
import MarkRegionOverlay, { type MarkRect, type MarkRegion } from './MarkRegionOverlay';
import MarkPromptBar from './MarkPromptBar';
import { commitMarkRegion, stageMarkRegion } from './markCommit';
import { markComposerChipLabel, nextMarkRegionIndex } from './markChipUtils';
import { markPinsForNode } from './markPinStore';
import { markPromptFixedStyle, nodeSceneBox } from './markGeometry';
import type { SceneDocument } from '@/components/rcb/sceneNode';
import store from '@/store';

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

function layersToRegions(
  layers: ImageDecomposeLayer[],
  naturalW: number,
  naturalH: number,
  nodeW: number,
  nodeH: number,
  startIndex = 0
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
    if (layer.type !== 'text' && rw >= nodeW * 0.96 && rh >= nodeH * 0.96) continue;
    const index = startIndex + out.length + 1;
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

function MarkSessionHost({
  document,
  hidden = false,
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
    (s: any) => s.editor.imageToolPanel as ImageToolPanelState | null
  );
  const imageMarkPins = useSelector(
    (s: any) => (s.editor.imageMarkPins || {}) as Record<string, ImageMarkPin | ImageMarkPin[]>
  );
  const active = panel?.kind === 'mark' ? panel.nodeId : null;
  const markSink = markPanelSink(panel);
  const node = active ? document?.deltaSetLike?.[active] : null;
  const box = useMemo(
    () => (active && node ? nodeSceneBox(document, node) : null),
    [document, active, node]
  );
  const src = String(node?.attrs?.src || '').trim();

  const [regions, setRegions] = useState<MarkRegion[]>([]);
  const regionsRef = useRef(regions);
  regionsRef.current = regions;
  const [draft, setDraft] = useState<MarkRect | null>(null);
  const [detecting, setDetecting] = useState(false);
  const [promptText, setPromptText] = useState('');
  const [activeRegionId, setActiveRegionId] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const detectGenRef = useRef(0);

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
      if (e.key !== 'Escape') return;
      e.preventDefault();
      close();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active]);

  useEffect(() => {
    if (!active || !src || !box) return;
    setRegions([]);
    setDraft(null);
    setDetecting(false);
    if (!ilpEnabled) {
      message.warning(t('editor.imageToolbar.markNeedsIntelligence'));
      return;
    }
    // Quick-edit mark: manual box only — skip slow auto-detect that blocks the canvas.
    if (markSink === 'quickEdit') {
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
        const pins = active ? markPinsForNode(imageMarkPins, active) : [];
        const startIndex = pins.reduce((m, p) => Math.max(m, Number(p.index) || 0), 0);
        const next = layersToRegions(res.layers || [], nw, nh, box!.width, box!.height, startIndex).map(
          (r, i) => ({ ...r, index: startIndex + i + 1, selected: i === 0 })
        );
        setRegions(next);
        if (next[0]) setActiveRegionId(next[0].id);
        if (!next.length) message.warning(t('editor.imageToolbar.markNoRegions'));
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
      if (gen === detectGenRef.current) setDetecting(false);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, src, ilpEnabled, markSink]);

  useEffect(() => () => abortRef.current?.abort(), []);

  const promptRegion = regions.find((r) => r.id === activeRegionId) || null;
  const promptStyle = useMemo(() => {
    if (!box || !promptRegion) return null;
    return markPromptFixedStyle(camera, box, promptRegion);
  }, [box, promptRegion, camera]);

  if (!active || !box || !node || hidden) return null;

  const onCommitDraft = (rect: MarkRect) => {
    if (!active || !box) return;
    const id = nanoid(8);
    const pins = markPinsForNode(
      (store.getState() as any).editor?.imageMarkPins || {},
      active
    );
    const nextIndex = nextMarkRegionIndex(pins, regionsRef.current);
    const nextRegion: MarkRegion = {
      id,
      index: nextIndex,
      ...rect,
      kind: 'manual',
      label: `${nextIndex} 区域`,
      selected: true,
    };

    if (markSink === 'quickEdit') {
      stageMarkRegion(dispatch, {
        nodeId: active,
        region: nextRegion,
        box,
        sink: 'quickEdit',
      });
      return;
    }

    setActiveRegionId(id);
    setRegions((prev) => [...prev.map((r) => ({ ...r, selected: false })), nextRegion]);
  };

  const onSelectRegion = (id: string) => {
    setActiveRegionId(id);
    setRegions((prev) => prev.map((r) => ({ ...r, selected: r.id === id })));
  };

  const onSubmitPrompt = (text: string) => {
    if (!active || !box || !promptRegion) return;
    commitMarkRegion(dispatch, {
      nodeId: active,
      region: promptRegion,
      box,
      text,
      sink: markSink,
    });
    setRegions((prev) => prev.filter((r) => r.id !== promptRegion.id));
    setPromptText('');
    setActiveRegionId(null);
  };

  return (
    <>
      <MarkRegionOverlay
        imageBox={box}
        regions={regions}
        draft={draft}
        activeRegionId={activeRegionId}
        detecting={detecting}
        onDraftChange={setDraft}
        onCommitDraft={onCommitDraft}
        onSelectRegion={onSelectRegion}
      />
      {markSink !== 'quickEdit' && promptStyle && promptRegion
        ? createPortal(
            <MarkPromptBar
              style={promptStyle}
              chipLabel={markComposerChipLabel(promptRegion)}
              value={promptText}
              onChange={setPromptText}
              onSubmit={onSubmitPrompt}
            />,
            globalThis.document.body
          )
        : null}
    </>
  );
}

export default memo(MarkSessionHost);
