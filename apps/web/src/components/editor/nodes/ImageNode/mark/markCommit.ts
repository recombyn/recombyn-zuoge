import type { Dispatch } from '@reduxjs/toolkit';
import {
  enqueueAgentContexts,
  enqueueImageGenMarkContexts,
  enqueueQuickEditMarkContexts,
  openImageToolPanel,
  setImageMarkPin,
  type PendingMarkContextChip,
} from '@/store/modules/editor';
import type { SceneBox } from './markGeometry';
import type { MarkRegion } from './MarkRegionOverlay';
import {
  buildMarkChipPayload,
  markComposerChipLabel,
  regionToMarkPin,
} from './markChipUtils';

export function buildPendingMarkChip(
  nodeId: string,
  region: Pick<MarkRegion, 'id' | 'index' | 'x' | 'y' | 'w' | 'h' | 'kind' | 'label'>,
  box: SceneBox,
  appendText?: string
): PendingMarkContextChip {
  const chip: PendingMarkContextChip = {
    key: `mark:${nodeId}:${region.id}:${Date.now()}`,
    label: markComposerChipLabel(region),
    kind: 'image',
    payload: buildMarkChipPayload(nodeId, region, box.width, box.height),
  };
  const tail = String(appendText || '').trim();
  if (tail) chip.appendText = ` ${tail}`;
  return chip;
}

function reopenMarkPanel(
  dispatch: Dispatch,
  opts: {
    markedNodeId: string;
    sessionNodeId?: string;
    sink: 'agent' | 'quickEdit' | 'imageGen';
  }
) {
  const anchor =
    opts.sink === 'quickEdit' || opts.sink === 'imageGen'
      ? opts.sessionNodeId || opts.markedNodeId
      : opts.markedNodeId;
  dispatch(
    openImageToolPanel({
      nodeId: anchor,
      kind: 'mark',
      ...(opts.sink === 'quickEdit' ? { markSink: 'quickEdit' as const } : {}),
      ...(opts.sink === 'imageGen' ? { markSink: 'imageGen' as const } : {}),
    })
  );
}

/** Stage a mark chip (no prompt text) — used when quick-edit draws a box. */
export function stageMarkRegion(
  dispatch: Dispatch,
  opts: {
    nodeId: string;
    sessionNodeId?: string;
    region: MarkRegion;
    box: SceneBox;
    sink: 'agent' | 'quickEdit' | 'imageGen';
  }
) {
  const chip = buildPendingMarkChip(opts.nodeId, opts.region, opts.box);
  if (opts.sink === 'quickEdit') {
    dispatch(enqueueQuickEditMarkContexts([chip]));
  } else if (opts.sink === 'imageGen') {
    dispatch(enqueueImageGenMarkContexts([chip]));
  } else {
    dispatch(enqueueAgentContexts([chip]));
  }
  dispatch(setImageMarkPin(regionToMarkPin(opts.nodeId, opts.region, opts.sink)));
  reopenMarkPanel(dispatch, {
    markedNodeId: opts.nodeId,
    sessionNodeId: opts.sessionNodeId,
    sink: opts.sink,
  });
}

export function commitMarkRegion(
  dispatch: Dispatch,
  opts: {
    nodeId: string;
    sessionNodeId?: string;
    region: MarkRegion;
    box: SceneBox;
    text: string;
    sink: 'agent' | 'quickEdit' | 'imageGen';
  }
) {
  const tail = opts.text.trim();
  if (!tail) {
    stageMarkRegion(dispatch, {
      nodeId: opts.nodeId,
      sessionNodeId: opts.sessionNodeId,
      region: opts.region,
      box: opts.box,
      sink: opts.sink,
    });
    return;
  }

  const chip = buildPendingMarkChip(opts.nodeId, opts.region, opts.box, tail);
  if (opts.sink === 'quickEdit') {
    dispatch(enqueueQuickEditMarkContexts([chip]));
  } else if (opts.sink === 'imageGen') {
    dispatch(enqueueImageGenMarkContexts([chip]));
  } else {
    dispatch(enqueueAgentContexts([chip]));
  }
  dispatch(setImageMarkPin(regionToMarkPin(opts.nodeId, opts.region, opts.sink)));
  reopenMarkPanel(dispatch, {
    markedNodeId: opts.nodeId,
    sessionNodeId: opts.sessionNodeId,
    sink: opts.sink,
  });
}
