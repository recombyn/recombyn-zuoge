import { useEffect, useMemo, useState, type CSSProperties, type ReactNode, memo } from 'react';
import { createPortal } from 'react-dom';
import { useDispatch, useSelector } from '@/store';
import { RcbOverlayPortal, useRcbCamera, rcbSceneToScreen } from '@/components/rcb';
import type { ImageMarkPin, ImageToolPanelState } from '@/store/modules/editor';
import { setHoveredMarkPin } from '@/store/modules/editor';
import type { RootState } from '@/store';
import store from '@/store';
import MarkPromptBar from './MarkPromptBar';
import { commitMarkRegion } from './markCommit';
import { markComposerChipLabel, markPinToRegion } from './markChipUtils';
import { markPromptFixedStyle, type SceneBox } from './markGeometry';
import { markRegionChrome } from './markRegionChrome';

function MarkPinOverlay({
  nodeId,
  pin,
  imageBox,
}: {
  nodeId: string;
  pin: ImageMarkPin;
  imageBox: SceneBox;
}): ReactNode {
  const dispatch = useDispatch();
  const camera = useRcbCamera();
  const hoveredMarkPin = useSelector((s: RootState) => s.editor.hoveredMarkPin);
  const [expanded, setExpanded] = useState(false);
  const [promptText, setPromptText] = useState('');
  const isChipHovered =
    hoveredMarkPin?.nodeId === nodeId && hoveredMarkPin?.pinId === pin.id;
  const showRegionEcho = isChipHovered && !expanded;
  const z = Math.max(0.05, camera.zoom || 1);

  useEffect(() => {
    setExpanded(false);
    setPromptText('');
  }, [pin.id, nodeId]);

  useEffect(() => {
    if (!expanded) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.preventDefault();
      setExpanded(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [expanded]);

  const origin = rcbSceneToScreen(camera, imageBox.left, imageBox.top);
  const stageW = Math.max(1, imageBox.width * z);
  const stageH = Math.max(1, imageBox.height * z);
  const chrome = markRegionChrome({
    pinned: !expanded && !showRegionEcho,
    expanded,
    hovered: showRegionEcho,
    badgeOnly: !expanded && !showRegionEcho,
  });
  const promptStyle = useMemo(
    () => markPromptFixedStyle(camera, imageBox, pin),
    [camera, imageBox, pin]
  );

  const shellStyle: CSSProperties = {
    position: 'absolute',
    left: origin.x,
    top: origin.y,
    width: stageW,
    height: stageH,
    zIndex: 33,
    touchAction: 'none',
  };

  const regionStyle: CSSProperties = {
    position: 'absolute',
    left: pin.x * z,
    top: pin.y * z,
    width: Math.max(1, pin.w * z),
    height: Math.max(1, pin.h * z),
    border: chrome.border,
    boxShadow: chrome.boxShadow,
    boxSizing: 'border-box',
    cursor: chrome.cursor,
  };

  const regionLabel = pin.label || `${pin.index} 区域`;

  const onSubmitPrompt = (text: string) => {
    const panel = (store.getState() as { editor?: { imageToolPanel?: ImageToolPanelState | null } })
      .editor?.imageToolPanel;
    const sessionNodeId =
      pin.sink === 'quickEdit' && panel?.nodeId ? panel.nodeId : undefined;
    commitMarkRegion(dispatch, {
      nodeId,
      sessionNodeId,
      region: markPinToRegion(pin),
      box: imageBox,
      text,
      sink: pin.sink,
    });
    setPromptText('');
    setExpanded(false);
  };

  return (
    <RcbOverlayPortal>
      <div data-mark-pin-overlay className="pointer-events-none absolute" style={shellStyle}>
        <div
          className="pointer-events-auto absolute p-0"
          style={regionStyle}
          role="button"
          tabIndex={0}
          aria-label={regionLabel}
          onPointerDown={(e) => {
            e.stopPropagation();
            e.nativeEvent.stopImmediatePropagation?.();
          }}
          onPointerEnter={() => {
            dispatch(setHoveredMarkPin({ nodeId, pinId: pin.id }));
          }}
          onPointerLeave={(e) => {
            const next = e.relatedTarget;
            if (
              next instanceof Element &&
              next.closest('[data-mark-chip="1"], [data-mark-pin-overlay]')
            ) {
              return;
            }
            dispatch(setHoveredMarkPin(null));
          }}
          onClick={(e) => {
            e.stopPropagation();
            setExpanded((v) => !v);
          }}
          onKeyDown={(e) => {
            if (e.key !== 'Enter' && e.key !== ' ') return;
            e.preventDefault();
            setExpanded((v) => !v);
          }}
        >
          <span
            className="pointer-events-none absolute right-0 top-1/2 flex h-5 min-w-5 -translate-y-1/2 translate-x-1/2 items-center justify-center rounded-md px-1 text-[11px] font-semibold text-white shadow-sm"
            style={{ background: chrome.badgeBg }}
          >
            {pin.index}
          </span>
          {expanded ? (
            <span
              className="pointer-events-none absolute -bottom-6 left-1/2 -translate-x-1/2 whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-medium text-[#1e3a8a] shadow-sm"
              style={{ background: 'rgba(191,219,254,0.95)' }}
            >
              {regionLabel}
            </span>
          ) : null}
        </div>
      </div>
      {expanded && pin.sink === 'agent'
        ? createPortal(
            <MarkPromptBar
              style={promptStyle}
              chipLabel={markComposerChipLabel(pin)}
              value={promptText}
              onChange={setPromptText}
              onSubmit={onSubmitPrompt}
            />,
            globalThis.document.body
          )
        : null}
    </RcbOverlayPortal>
  );
}

export default memo(MarkPinOverlay);
