import { useEffect, useMemo, useRef, useState, type ReactNode, memo } from 'react';
import { createPortal } from 'react-dom';
import { useDispatch, useSelector } from 'react-redux';
import { useTranslation } from 'react-i18next';
import { nanoid } from 'nanoid';
import { message } from '@/components/base';
import { useRcbCamera } from '@/components/rcb';
import { useImageToolCapabilities } from '@/service/imageTools';
import {
  closeImageToolPanel,
  isMultiImageMarkPanel,
  markPanelSink,
  type ImageToolPanelState,
} from '@/store/modules/editor';
import MarkRegionOverlay, { type MarkRect, type MarkRegion } from './MarkRegionOverlay';
import MarkPromptBar from './MarkPromptBar';
import { commitMarkRegion } from './markCommit';
import { markComposerChipLabel, nextMarkRegionIndex } from './markChipUtils';
import { markPinsForNode } from './markPinStore';
import { markPromptFixedStyle, listMarkSessionTargets, nodeSceneBox } from './markGeometry';
import { dismissMarkToolSession } from './markSessionCleanup';
import type { SceneDocument } from '@/components/rcb/sceneNode';
import store from '@/store';

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
  const isMultiImageMark = isMultiImageMarkPanel(panel);
  const sessionNodeId = isMultiImageMark ? panel!.nodeId : null;
  const agentMarkNodeId = panel?.kind === 'mark' && !isMultiImageMark ? panel.nodeId : null;
  const multiMarkSink = isMultiImageMark ? markPanelSink(panel) : null;
  const agentNode = agentMarkNodeId ? document?.deltaSetLike?.[agentMarkNodeId] : null;
  const agentBox = useMemo(
    () => (agentMarkNodeId && agentNode ? nodeSceneBox(document, agentNode) : null),
    [document, agentMarkNodeId, agentNode]
  );
  const quickEditTargets = useMemo(
    () => (isMultiImageMark && !hidden ? listMarkSessionTargets(document) : []),
    [document, isMultiImageMark, hidden]
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
  const [promptText, setPromptText] = useState('');
  const [activeRegionId, setActiveRegionId] = useState<string | null>(null);

  const resetLocalSession = () => {
    setRegions([]);
    setDraft(null);
    setDraftByNode({});
    setRegionsByNode({});
    setActivePrompt(null);
    setActiveRegionId(null);
    setPromptText('');
  };

  const removeQuickEditRegion = (nodeId: string, regionId: string) => {
    setRegionsByNode((prev) => {
      const next = { ...prev };
      const list = (next[nodeId] || []).filter((r) => r.id !== regionId);
      if (list.length) next[nodeId] = list;
      else delete next[nodeId];
      return next;
    });
  };

  const close = () => {
    resetLocalSession();
    if (!panel?.nodeId) {
      dispatch(closeImageToolPanel());
      return;
    }
    dismissMarkToolSession(dispatch, document, panel, panel.nodeId);
  };

  useEffect(() => {
    if (!agentMarkNodeId && !isMultiImageMark) {
      resetLocalSession();
    }
  }, [agentMarkNodeId, isMultiImageMark]);

  useEffect(() => {
    if (!agentMarkNodeId) return;
    if (!agentNode || agentNode.key !== 'image') close();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [agentMarkNodeId, agentNode?.key]);

  useEffect(() => {
    const active = agentMarkNodeId || isMultiImageMark;
    if (!active) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
        e.preventDefault();
      if (activePrompt) {
        removeQuickEditRegion(activePrompt.nodeId, activePrompt.regionId);
        setActivePrompt(null);
        setPromptText('');
        return;
      }
      if (activeRegionId) {
        setRegions((prev) => prev.filter((r) => r.id !== activeRegionId));
        setActiveRegionId(null);
        setPromptText('');
        return;
      }
      close();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [agentMarkNodeId, isMultiImageMark, panel?.nodeId, activePrompt, activeRegionId]);

  useEffect(() => {
    if (!agentMarkNodeId || !agentBox) return;
    setRegions([]);
    setDraft(null);
    if (!ilpEnabled) {
      message.warning(t('editor.imageToolbar.markNeedsIntelligence'));
    }
  }, [agentMarkNodeId, agentBox, ilpEnabled, t]);

  const promptRegion = regions.find((r) => r.id === activeRegionId) || null;
  const agentPromptStyle = useMemo(() => {
    if (!agentBox || !promptRegion) return null;
    return markPromptFixedStyle(camera, agentBox, promptRegion);
  }, [agentBox, promptRegion, camera]);

  const activeQuickEditPrompt = useMemo(() => {
    if (!activePrompt || !isMultiImageMark) return null;
    const target = quickEditTargets.find((item) => item.nodeId === activePrompt.nodeId);
    if (!target) return null;
    const region = (regionsByNode[activePrompt.nodeId] || []).find(
      (r) => r.id === activePrompt.regionId
    );
    if (!region) return null;
    return { nodeId: activePrompt.nodeId, box: target.box, region };
  }, [activePrompt, isMultiImageMark, quickEditTargets, regionsByNode]);

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

  const onSubmitMultiImagePrompt = (text: string) => {
    if (!sessionNodeId || !activeQuickEditPrompt || !multiMarkSink) return;
    const { nodeId: targetNodeId, box: targetBox, region } = activeQuickEditPrompt;
    commitMarkRegion(dispatch, {
      nodeId: targetNodeId,
      sessionNodeId,
      region,
      box: targetBox,
      text,
      sink: multiMarkSink,
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

  if (isMultiImageMark && sessionNodeId && quickEditTargets.length) {
    return (
      <>
        {quickEditTargets.map(({ nodeId, box: targetBox, blocked }) => (
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
            onSoftBlankClick={close}
          />
        ))}
        {quickEditPromptStyle && activeQuickEditPrompt
          ? createPortal(
              <MarkPromptBar
                style={quickEditPromptStyle}
                chipLabel={markComposerChipLabel(activeQuickEditPrompt.region)}
                value={promptText}
                onChange={setPromptText}
                onSubmit={onSubmitMultiImagePrompt}
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
      sink: markPanelSink(panel),
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
        onDraftChange={setDraft}
        onCommitDraft={onCommitDraft}
        onSelectRegion={onSelectRegion}
        onSoftBlankClick={close}
      />
      {agentPromptStyle && promptRegion
        ? createPortal(
            <MarkPromptBar
              style={agentPromptStyle}
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
