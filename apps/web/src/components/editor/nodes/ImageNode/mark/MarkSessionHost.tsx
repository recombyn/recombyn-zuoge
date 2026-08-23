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
import { commitMarkRegion } from './markCommit';
import { markComposerChipLabel, nextMarkRegionIndex } from './markChipUtils';
import { markPinsForNode } from './markPinStore';
import { markPromptFixedStyle, listCanvasImageNodes, nodeSceneBox } from './markGeometry';
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
  const isQuickEditMark = panel?.kind === 'mark' && panel?.markSink === 'quickEdit';
  const sessionNodeId = isQuickEditMark ? panel.nodeId : null;
  const agentMarkNodeId = panel?.kind === 'mark' && !isQuickEditMark ? panel.nodeId : null;
  const markSink = markPanelSink(panel);
  const agentNode = agentMarkNodeId ? document?.deltaSetLike?.[agentMarkNodeId] : null;
  const agentBox = useMemo(
    () => (agentMarkNodeId && agentNode ? nodeSceneBox(document, agentNode) : null),
    [document, agentMarkNodeId, agentNode]
  );
  const agentSrc = String(agentNode?.attrs?.src || '').trim();
  const quickEditTargets = useMemo(
    () => (isQuickEditMark && !hidden ? listCanvasImageNodes(document) : []),
    [document, isQuickEditMark, hidden]
  );

  const [regions, setRegions] = useState<MarkRegion[]>([]);
  const regionsRef = useRef(regions);
  regionsRef.current = regions;
  const [draft, setDraft] = useState<MarkRect | null>(null);
  const [draftByNode, setDraftByNode] = useState<Record<string, MarkRect | null>>({});
  const [regionsByNode, setRegionsByNode] = useState<Record<string, MarkRegion[]>>({});
  const [activePrompt, setActivePrompt] = useState<{ nodeId: string; regionId: string } | null>(
    null
  );
  const [detecting, setDetecting] = useState(false);
  const [promptText, setPromptText] = useState('');
  const [activeRegionId, setActiveRegionId] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const detectGenRef = useRef(0);

  const cancelDetect = () => {
    detectGenRef.current += 1;
    abortRef.current?.abort();
    abortRef.current = null;
    setDetecting(false);
  };

  const close = () => {
    cancelDetect();
    if (markSink === 'quickEdit' && panel?.nodeId) {
      dispatch(openImageToolPanel({ nodeId: panel.nodeId, kind: 'quickEdit' }));
      return;
    }
    dispatch(closeImageToolPanel());
  };

  useEffect(() => {
    if (!agentMarkNodeId && !isQuickEditMark) {
      setPromptText('');
      setActiveRegionId(null);
      setDraftByNode({});
      setRegionsByNode({});
      setActivePrompt(null);
    }
  }, [agentMarkNodeId, isQuickEditMark]);

  useEffect(() => {
    if (!agentMarkNodeId) return;
    if (!agentNode || agentNode.key !== 'image') close();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [agentMarkNodeId, agentNode?.key]);

  useEffect(() => {
    const active = agentMarkNodeId || isQuickEditMark;
    if (!active) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.preventDefault();
      if (activePrompt) {
        setActivePrompt(null);
        setPromptText('');
        return;
      }
      if (activeRegionId) {
        setActiveRegionId(null);
        setPromptText('');
        return;
      }
      close();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [agentMarkNodeId, isQuickEditMark, panel?.nodeId, activePrompt, activeRegionId]);

  useEffect(() => {
    if (!agentMarkNodeId || !agentSrc || !agentBox) return;
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
    const detectTimeout = window.setTimeout(() => {
      if (gen !== detectGenRef.current) return;
      ac.abort();
      setDetecting(false);
      message.warning(t('editor.imageToolbar.markDetectTimeout'));
    }, 15_000);

    async function runDetect() {
      try {
        const res = await processImageTool(
          { kind: 'detectRegions', image: agentSrc },
          { signal: ac.signal }
        );
        if (gen !== detectGenRef.current) return;
        const nw = Math.max(1, Number(res.width) || agentBox!.width);
        const nh = Math.max(1, Number(res.height) || agentBox!.height);
        const pins = agentMarkNodeId ? markPinsForNode(imageMarkPins, agentMarkNodeId) : [];
        const startIndex = pins.reduce((m, p) => Math.max(m, Number(p.index) || 0), 0);
        const next = layersToRegions(res.layers || [], nw, nh, agentBox!.width, agentBox!.height, startIndex).map(
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
      window.clearTimeout(detectTimeout);
      ac.abort();
      if (gen === detectGenRef.current) setDetecting(false);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [agentMarkNodeId, agentSrc, ilpEnabled, markSink]);

  useEffect(() => () => abortRef.current?.abort(), []);

  const promptRegion = regions.find((r) => r.id === activeRegionId) || null;
  const agentPromptStyle = useMemo(() => {
    if (!agentBox || !promptRegion) return null;
    return markPromptFixedStyle(camera, agentBox, promptRegion);
  }, [agentBox, promptRegion, camera]);

  const activeQuickEditPrompt = useMemo(() => {
    if (!activePrompt || !isQuickEditMark) return null;
    const target = quickEditTargets.find((item) => item.nodeId === activePrompt.nodeId);
    if (!target) return null;
    const region = (regionsByNode[activePrompt.nodeId] || []).find(
      (r) => r.id === activePrompt.regionId
    );
    if (!region) return null;
    return { nodeId: activePrompt.nodeId, box: target.box, region };
  }, [activePrompt, isQuickEditMark, quickEditTargets, regionsByNode]);

  const quickEditPromptStyle = useMemo(() => {
    if (!activeQuickEditPrompt) return null;
    return markPromptFixedStyle(
      camera,
      activeQuickEditPrompt.box,
      activeQuickEditPrompt.region
    );
  }, [activeQuickEditPrompt, camera]);

  if (hidden) return null;

  const onQuickEditCommit = (targetNodeId: string, targetBox: NonNullable<typeof agentBox>, rect: MarkRect) => {
    if (!sessionNodeId) return;
    const id = nanoid(8);
    const pins = markPinsForNode(
      (store.getState() as any).editor?.imageMarkPins || {},
      targetNodeId
    );
    const pendingRegions = regionsByNode[targetNodeId] || [];
    const nextIndex = nextMarkRegionIndex(pins, pendingRegions);
    const nextRegion: MarkRegion = {
      id,
      index: nextIndex,
      ...rect,
      kind: 'manual',
      label: `${nextIndex} 区域`,
      selected: true,
    };
    setRegionsByNode((prev) => ({
      ...prev,
      [targetNodeId]: [
        ...(prev[targetNodeId] || []).map((r) => ({ ...r, selected: false })),
        nextRegion,
      ],
    }));
    setActivePrompt({ nodeId: targetNodeId, regionId: id });
    setPromptText('');
    setDraftByNode((prev) => ({ ...prev, [targetNodeId]: null }));
  };

  const onSubmitQuickEditPrompt = (text: string) => {
    if (!sessionNodeId || !activeQuickEditPrompt) return;
    const { nodeId: targetNodeId, box: targetBox, region } = activeQuickEditPrompt;
    commitMarkRegion(dispatch, {
      nodeId: targetNodeId,
      sessionNodeId,
      region,
      box: targetBox,
      text,
      sink: 'quickEdit',
    });
    setRegionsByNode((prev) => {
      const next = { ...prev };
      const list = (next[targetNodeId] || []).filter((r) => r.id !== region.id);
      if (list.length) next[targetNodeId] = list;
      else delete next[targetNodeId];
      return next;
    });
    setActivePrompt(null);
    setPromptText('');
  };

  if (isQuickEditMark && sessionNodeId && quickEditTargets.length) {
    return (
      <>
        {quickEditTargets.map(({ nodeId, box: targetBox, node: targetNode }) => {
          const processing = String(targetNode?.attrs?.processStatus || '') === 'running';
          const processLabel = String(targetNode?.attrs?.processLabel || '').trim();
          const blocked = processing
            ? {
                message:
                  processLabel || t('editor.imageToolbar.markBlockedProcessing'),
              }
            : null;
          return (
          <MarkRegionOverlay
            key={nodeId}
            imageBox={targetBox}
            regions={regionsByNode[nodeId] ?? []}
            draft={draftByNode[nodeId] ?? null}
            activeRegionId={
              activePrompt?.nodeId === nodeId ? activePrompt.regionId : null
            }
            blocked={blocked}
            onDraftChange={(next) =>
              setDraftByNode((prev) => ({ ...prev, [nodeId]: next }))
            }
            onCommitDraft={(rect) => onQuickEditCommit(nodeId, targetBox, rect)}
            onSelectRegion={(id) => {
              setActivePrompt({ nodeId, regionId: id });
              setPromptText('');
            }}
          />
          );
        })}
        {quickEditPromptStyle && activeQuickEditPrompt
          ? createPortal(
              <MarkPromptBar
                style={quickEditPromptStyle}
                chipLabel={markComposerChipLabel(activeQuickEditPrompt.region)}
                value={promptText}
                onChange={setPromptText}
                onSubmit={onSubmitQuickEditPrompt}
                onCancel={() => {
                  setActivePrompt(null);
                  setPromptText('');
                }}
              />,
              globalThis.document.body
            )
          : null}
      </>
    );
  }

  if (!agentMarkNodeId || !agentBox || !agentNode) return null;

  const onCommitDraft = (rect: MarkRect) => {
    if (!agentMarkNodeId || !agentBox) return;
    const id = nanoid(8);
    const pins = markPinsForNode(
      (store.getState() as any).editor?.imageMarkPins || {},
      agentMarkNodeId
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

    setActiveRegionId(id);
    setRegions((prev) => [...prev.map((r) => ({ ...r, selected: false })), nextRegion]);
  };

  const onSelectRegion = (id: string) => {
    setActiveRegionId(id);
    setRegions((prev) => prev.map((r) => ({ ...r, selected: r.id === id })));
  };

  const onSubmitPrompt = (text: string) => {
    if (!agentMarkNodeId || !agentBox || !promptRegion) return;
    commitMarkRegion(dispatch, {
      nodeId: agentMarkNodeId,
      sessionNodeId: panel?.nodeId,
      region: promptRegion,
      box: agentBox,
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
        imageBox={agentBox}
        regions={regions}
        draft={draft}
        activeRegionId={activeRegionId}
        blocked={
          detecting
            ? {
                message: t('editor.imageToolbar.markDetecting'),
                onCancel: close,
              }
            : null
        }
        onDraftChange={setDraft}
        onCommitDraft={onCommitDraft}
        onSelectRegion={onSelectRegion}
      />
      {agentPromptStyle && promptRegion
        ? createPortal(
            <MarkPromptBar
              style={agentPromptStyle}
              chipLabel={markComposerChipLabel(promptRegion)}
              value={promptText}
              onChange={setPromptText}
              onSubmit={onSubmitPrompt}
              onCancel={close}
            />,
            globalThis.document.body
          )
        : null}
    </>
  );
}

export default memo(MarkSessionHost);
