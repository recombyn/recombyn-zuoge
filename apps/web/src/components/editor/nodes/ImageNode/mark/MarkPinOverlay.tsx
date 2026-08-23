import { useEffect, useMemo, useState, type CSSProperties, type ReactNode, memo } from 'react';
import { createPortal } from 'react-dom';
import { useDispatch } from 'react-redux';
import { RcbOverlayPortal, useRcbCamera, rcbSceneToScreen } from '@/components/rcb';
import type { ImageMarkPin } from '@/store/modules/editor';
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
  const z = Math.max(0.05, camera.zoom || 1);
  const [expanded, setExpanded] = useState(false);
  const [promptText, setPromptText] = useState('');

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
  const chrome = markRegionChrome({ pinned: !expanded, expanded, badgeOnly: !expanded });
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
    commitMarkRegion(dispatch, {
      nodeId,
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
      {expanded
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
