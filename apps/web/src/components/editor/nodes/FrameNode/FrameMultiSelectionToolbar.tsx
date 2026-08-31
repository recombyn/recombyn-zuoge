import { memo, type ReactNode } from 'react';
import { useDispatch } from '@/store';
import { HiOutlineLockClosed, HiOutlineLockOpen } from 'react-icons/hi2';
import { Icon } from '@/components/base/icon';
import Tooltip from '@/components/base/tooltip';
import { ExportSelectionPopover } from '@/components/editor/panels/ExportSelectionPanel';
import { updateArtboardFrames, type ArtboardFrame } from '@/store/modules/editor';
import { SelectionToolbarShell } from '@/components/rcb/selection/chrome/SelectionToolbarShell';
import {
  SEL_ICON_BTN,
  SEL_TOOL_BTN,
} from '@/components/rcb/selection/chrome/ToolbarValueSlider';
import { cn } from '@/utils/classnames';

type SceneBox = { left: number; top: number; width: number; height: number };
type AlignMode = 'left' | 'centerX' | 'right' | 'top' | 'middle' | 'bottom';

type Props = {
  frames: ArtboardFrame[];
  box: SceneBox;
};

function framePatches(frames: ArtboardFrame[], box: SceneBox, mode: AlignMode) {
  const right = box.left + box.width;
  const bottom = box.top + box.height;
  return frames.map((frame) => {
    const width = Math.max(1, Number(frame.width) || 1);
    const height = Math.max(1, Number(frame.height) || 1);
    switch (mode) {
      case 'left':
        return { id: frame.id, patch: { x: box.left } };
      case 'centerX':
        return { id: frame.id, patch: { x: box.left + (box.width - width) / 2 } };
      case 'right':
        return { id: frame.id, patch: { x: right - width } };
      case 'top':
        return { id: frame.id, patch: { y: box.top } };
      case 'middle':
        return { id: frame.id, patch: { y: box.top + (box.height - height) / 2 } };
      case 'bottom':
        return { id: frame.id, patch: { y: bottom - height } };
      default:
        return { id: frame.id, patch: {} };
    }
  });
}

function distributePatches(frames: ArtboardFrame[], axis: 'h' | 'v') {
  if (frames.length < 3) return [];
  const horizontal = axis === 'h';
  const sorted = [...frames].sort((a, b) => {
    const aPos = horizontal ? Number(a.x) || 0 : Number(a.y) || 0;
    const bPos = horizontal ? Number(b.x) || 0 : Number(b.y) || 0;
    return aPos - bPos;
  });
  const first = sorted[0];
  const last = sorted[sorted.length - 1];
  const firstPos = horizontal ? Number(first.x) || 0 : Number(first.y) || 0;
  const lastPos = horizontal ? Number(last.x) || 0 : Number(last.y) || 0;
  const totalSize = sorted.reduce(
    (sum, frame) => sum + (horizontal ? Number(frame.width) || 1 : Number(frame.height) || 1),
    0
  );
  const span =
    lastPos + (horizontal ? Number(last.width) || 1 : Number(last.height) || 1) -
    firstPos - totalSize;
  const gap = span / (sorted.length - 1);
  let cursor = firstPos + (horizontal ? Number(first.width) || 1 : Number(first.height) || 1) + gap;
  return sorted.slice(1, -1).map((frame) => {
    const patch = horizontal ? { x: cursor } : { y: cursor };
    cursor += (horizontal ? Number(frame.width) || 1 : Number(frame.height) || 1) + gap;
    return { id: frame.id, patch };
  });
}

function FrameMultiSelectionToolbar({ frames, box }: Props): ReactNode {
  const dispatch = useDispatch();
  const allLocked = frames.every((frame) => Boolean(frame.locked));
  const apply = (patches: Array<{ id: string; patch: Record<string, number | boolean> }>) => {
    if (patches.length) dispatch(updateArtboardFrames({ patches }));
  };
  const alignItems: Array<{ mode: AlignMode; tip: string; icon: string }> = [
    { mode: 'left', tip: '左对齐', icon: 'editor-align-left' },
    { mode: 'centerX', tip: '水平居中', icon: 'editor-align-center-x' },
    { mode: 'right', tip: '右对齐', icon: 'editor-align-right' },
    { mode: 'top', tip: '顶部对齐', icon: 'editor-align-top' },
    { mode: 'middle', tip: '垂直居中', icon: 'editor-align-middle' },
    { mode: 'bottom', tip: '底部对齐', icon: 'editor-align-bottom' },
  ];

  return (
    <SelectionToolbarShell box={box}>
      <div className="flex flex-nowrap items-center gap-0.5" role="group" aria-label="画板对齐">
        {alignItems.map(({ mode, tip, icon }) => (
          <Tooltip key={mode} tip={tip} placement="top">
            <button
              type="button"
              aria-label={tip}
              className={SEL_ICON_BTN}
              onClick={() => apply(framePatches(frames, box, mode))}
            >
              <Icon name={icon} width={16} height={16} />
            </button>
          </Tooltip>
        ))}
      </div>
      <span className="mx-0.5 h-4 w-px shrink-0 bg-[var(--line)]" aria-hidden />
      <Tooltip tip="水平分布" placement="top">
        <button
          type="button"
          aria-label="水平分布"
          className={cn(SEL_ICON_BTN, frames.length < 3 && 'opacity-40')}
          disabled={frames.length < 3}
          onClick={() => apply(distributePatches(frames, 'h'))}
        >
          <Icon name="editor-distribute" width={16} height={16} />
        </button>
      </Tooltip>
      <Tooltip tip="锁定画板" placement="top">
        <button
          type="button"
          aria-label={allLocked ? '解锁画板' : '锁定画板'}
          aria-pressed={allLocked}
          className={cn(SEL_ICON_BTN, allLocked && 'bg-[var(--accent-soft)]')}
          onClick={() => apply(frames.map((frame) => ({ id: frame.id, patch: { locked: !allLocked } })))}
        >
          {allLocked ? <HiOutlineLockClosed className="h-3.5 w-3.5" /> : <HiOutlineLockOpen className="h-3.5 w-3.5" />}
        </button>
      </Tooltip>
      <ExportSelectionPopover
        crop={{
          x: box.left,
          y: box.top,
          width: box.width,
          height: box.height,
          backgroundColor: frames[0]?.backgroundColor,
        }}
        baseName="Frames"
        triggerClassName={SEL_TOOL_BTN}
      />
    </SelectionToolbarShell>
  );
}

export default memo(FrameMultiSelectionToolbar);
