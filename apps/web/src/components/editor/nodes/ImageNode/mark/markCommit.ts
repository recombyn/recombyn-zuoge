import type { Dispatch } from '@reduxjs/toolkit';
import {
  enqueueAgentContexts,
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
  nodeId: string,
  sink: 'agent' | 'quickEdit'
) {
  dispatch(
    openImageToolPanel({
      nodeId,
      kind: 'mark',
      ...(sink === 'quickEdit' ? { markSink: 'quickEdit' } : {}),
    })
  );
}

/** Stage a mark chip (no prompt text) — used when quick-edit draws a box. */
export function stageMarkRegion(
  dispatch: Dispatch,
  opts: {
    nodeId: string;
    region: MarkRegion;
    box: SceneBox;
    sink: 'agent' | 'quickEdit';
  }
) {
  const chip = buildPendingMarkChip(opts.nodeId, opts.region, opts.box);
  if (opts.sink === 'quickEdit') {
    dispatch(enqueueQuickEditMarkContexts([chip]));
  } else {
    dispatch(enqueueAgentContexts([chip]));
  }
  dispatch(setImageMarkPin(regionToMarkPin(opts.nodeId, opts.region, opts.sink)));
  reopenMarkPanel(dispatch, opts.nodeId, opts.sink);
}

export function commitMarkRegion(
  dispatch: Dispatch,
  opts: {
    nodeId: string;
    region: MarkRegion;
    box: SceneBox;
    text: string;
    sink: 'agent' | 'quickEdit';
  }
) {
  const tail = opts.text.trim();
  if (!tail) {
    stageMarkRegion(dispatch, {
      nodeId: opts.nodeId,
      region: opts.region,
      box: opts.box,
      sink: opts.sink,
    });
    return;
  }

  const chip = buildPendingMarkChip(opts.nodeId, opts.region, opts.box, tail);
  if (opts.sink === 'quickEdit') {
    dispatch(enqueueQuickEditMarkContexts([chip]));
  } else {
    dispatch(enqueueAgentContexts([chip]));
  }
  dispatch(setImageMarkPin(regionToMarkPin(opts.nodeId, opts.region, opts.sink)));
  reopenMarkPanel(dispatch, opts.nodeId, opts.sink);
}
