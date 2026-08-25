import { useMemo, type CSSProperties, type ReactNode, memo } from 'react';
import { createPortal } from 'react-dom';
import { useHtmlMediaMount } from '@/components/editor/nodes/useHtmlMediaMount';
import { isNodeHidden, isTextFrameNode } from '@/components/rcb/scene/document/nodeCapabilities';
import {
  parseNodeText,
  parseNodeTextStyle,
  toFabricFontFamily,
} from '@/components/rcb/scene/document/sceneText';
import type { SceneDocument } from '@/components/rcb/sceneNode';

/**
 * Scrollable text inside a fixed FO plate (same mount path as video/lottie).
 * When selected, pointer-events enable wheel scroll; otherwise clicks hit the canvas.
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
      return isTextFrameNode(node) && !isNodeHidden(node);
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

  const bodyStyle: CSSProperties = {
    width: '100%',
    height: '100%',
    overflow: 'auto',
    boxSizing: 'border-box',
    margin: 0,
    padding: 0,
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
    WebkitOverflowScrolling: 'touch',
    pointerEvents: interactive ? 'auto' : 'none',
  };

  return createPortal(
    <div
      data-text-frame-overlay={nodeId}
      style={bodyStyle}
      onPointerDown={(e) => {
        if (!interactive) return;
        e.stopPropagation();
      }}
      onWheel={(e) => {
        if (!interactive) return;
        e.stopPropagation();
      }}
    >
      {plain || '\u00a0'}
    </div>,
    mount
  );
}

export default memo(TextFrameOverlay);
