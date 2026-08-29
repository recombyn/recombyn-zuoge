import { useMemo, type CSSProperties, type ReactNode, memo } from 'react';
import { createPortal } from 'react-dom';
import { useHtmlMediaMount } from '@/components/editor/nodes/useHtmlMediaMount';
import { isNodeStructurallyHiddenInDocument, isTextFrameNode } from '@/components/rcb/scene/document/nodeCapabilities';
import { TEXT_FRAME_PADDING, TEXT_FRAME_RADIUS } from '@/components/rcb/scene/document/sceneEffects';
import { resolveGenPlateFill } from '@/components/rcb/scene/document/nodeFactories';
import { radiiFromAttrs } from '@/components/rcb/scene/document/sceneRadii';
import {
  parseNodeText,
  parseNodeTextStyle,
  toFabricFontFamily,
} from '@/components/rcb/scene/document/sceneText';
import type { SceneDocument } from '@/components/rcb/sceneNode';

/**
 * Scrollable text inside a fixed FO plate (same mount path as video/lottie).
 * Dual-tone like audio, inverted for readability: outer `--audio-wave-track` + inner `--gen-empty`.
 *
 * Padding lives on the inner content — not the overflow scroller — so the
 * scrollbar stays flush to the track edge.
 */
function TextFrameOverlay({
  document,
  hiddenNodeId = null,
  selectedNodeIds = [],
}: {
  document: SceneDocument;
  /** Hide while inline editor owns the same node. */
  hiddenNodeId?: string | null;
  selectedNodeIds?: readonly string[];
}): ReactNode {
  const ids = useMemo(() => {
    const children: string[] = document?.deltaSetLike?.ROOT?.children || [];
    return children.filter((id) => {
      const node = document?.deltaSetLike?.[id];
      return isTextFrameNode(node) && !isNodeStructurallyHiddenInDocument(document, node);
    });
  }, [document]);
  const selected = useMemo(() => new Set(selectedNodeIds.filter(Boolean)), [selectedNodeIds]);

  if (!ids.length) return null;

  return (
    <>
      {ids.map((nodeId) => {
        if (hiddenNodeId && hiddenNodeId === nodeId) return null;
        return (
          <TextFramePlate
            key={nodeId}
            nodeId={nodeId}
            document={document}
            interactive={selected.has(nodeId)}
          />
        );
      })}
    </>
  );
}

function TextFramePlate({
  nodeId,
  document,
  interactive,
}: {
  nodeId: string;
  document: SceneDocument;
  interactive: boolean;
}): ReactNode {
  const mount = useHtmlMediaMount(nodeId);
  const node = document?.deltaSetLike?.[nodeId];
  if (!mount || !node || !isTextFrameNode(node)) return null;

  const style = parseNodeTextStyle(node.attrs || {});
  const plain = parseNodeText(node.attrs || {}) || '';
  const fontSize = Math.max(1, Number(style.fontSize) || 14);
  const lineH = Math.max(0.8, Number(style.lineHeight) || 1.4);
  const fillOpacity = Math.max(0, Math.min(100, Number(style.fillOpacity) || 100)) / 100;
  const radii = radiiFromAttrs(node.attrs || {});
  const rTl = radii.tl > 0 ? radii.tl : TEXT_FRAME_RADIUS;
  const rTr = radii.tr > 0 ? radii.tr : TEXT_FRAME_RADIUS;
  const rBr = radii.br > 0 ? radii.br : TEXT_FRAME_RADIUS;
  const rBl = radii.bl > 0 ? radii.bl : TEXT_FRAME_RADIUS;
  const trackR = Math.max(0, Math.min(rTl, rTr, rBr, rBl) - 4);

  const plateFill = resolveGenPlateFill(node.attrs?.['fill-color']);
  /** Default dual-tone: darker rim, lighter content well (swapped vs audio). */
  const outerBg = plateFill === 'var(--gen-empty)' ? 'var(--audio-wave-track)' : plateFill;
  const innerBg = 'var(--gen-empty)';

  const plateStyle: CSSProperties = {
    width: '100%',
    height: '100%',
    boxSizing: 'border-box',
    margin: 0,
    padding: 20,
    display: 'flex',
    flexDirection: 'column',
    overflow: 'hidden',
    pointerEvents: interactive ? 'auto' : 'none',
    background: outerBg,
    borderRadius: `${rTl}px ${rTr}px ${rBr}px ${rBl}px`,
    boxShadow: 'inset 0 0 0 1px var(--line)',
  };

  const trackStyle: CSSProperties = {
    flex: 1,
    minHeight: 0,
    width: '100%',
    boxSizing: 'border-box',
    margin: 0,
    padding: 0,
    overflow: 'auto',
    WebkitOverflowScrolling: 'touch',
    background: innerBg,
    borderRadius: trackR,
  };

  const contentStyle: CSSProperties = {
    boxSizing: 'border-box',
    margin: 0,
    padding: TEXT_FRAME_PADDING,
    minHeight: '100%',
    fontSize,
    lineHeight: lineH,
    fontFamily: `"${toFabricFontFamily(style.fontFamily)}", sans-serif`,
    fontWeight: style.fontWeight as CSSProperties['fontWeight'],
    fontStyle: style.fontStyle as CSSProperties['fontStyle'],
    textDecoration: (style.textDecoration as string) || 'none',
    color: style.fill || '#333333',
    opacity: fillOpacity,
    textAlign: (style.textAlign as CSSProperties['textAlign']) || 'left',
    letterSpacing: style.letterSpacing ? `${Number(style.letterSpacing)}px` : undefined,
    whiteSpace: 'pre-wrap',
    wordBreak: 'break-word',
  };

  return createPortal(
    <div
      data-text-frame-overlay={nodeId}
      style={plateStyle}
      onPointerDown={(e) => {
        if (!interactive) return;
        e.stopPropagation();
      }}
    >
      <div
        data-text-frame-scroll=""
        style={trackStyle}
        onWheel={(e) => {
          // Ctrl/meta+wheel → let RcbCanvas (passive:false) prevent browser zoom + zoom canvas.
          if (e.ctrlKey || e.metaKey) return;
          if (!interactive) return;
          e.stopPropagation();
          e.nativeEvent.stopImmediatePropagation();
        }}
      >
        <div style={contentStyle}>{plain || '\u00a0'}</div>
      </div>
    </div>,
    mount
  );
}

export default memo(TextFrameOverlay);
