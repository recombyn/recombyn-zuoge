import { memo } from 'react';
import { Tooltip } from '@/components/base';
import {
  FillPanelPopover,
  fillPanelPreview,
  type FillPanelValue,
} from '@/components/editor/panels/FillPanel';
import { cn } from '@/utils/classnames';

type Props = {
  value: FillPanelValue;
  onChange: (next: FillPanelValue) => void;
  /** Clear saved canvas color → follow theme `--canvas`. */
  onReset?: () => void;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  meshSelectedIndex?: number;
  onMeshSelectedIndexChange?: (index: number) => void;
  meshShowGuides?: boolean;
  onMeshShowGuidesChange?: (show: boolean) => void;
};

/** Bottom-HUD canvas background — full fill panel (type tabs + solid / gradient / image). */
function CanvasBgPicker({
  value,
  onChange,
  onReset,
  open,
  onOpenChange,
  meshSelectedIndex,
  onMeshSelectedIndexChange,
  meshShowGuides,
  onMeshShowGuidesChange,
}: Props) {
  return (
    <FillPanelPopover
      value={value}
      onChange={onChange}
      onReset={onReset}
      title={'画布背景色'}
      placement="top-start"
      shiftMainAxis={false}
      className="inline-flex"
      open={open}
      onOpenChange={onOpenChange}
      meshSelectedIndex={meshSelectedIndex}
      onMeshSelectedIndexChange={onMeshSelectedIndexChange}
      meshShowGuides={meshShowGuides}
      onMeshShowGuidesChange={onMeshShowGuidesChange}
    >
      {({ open: isOpen, preview }) => (
        <Tooltip tip={'画布背景'} placement="top">
          <span
            className={cn(
              'inline-flex h-7 w-7 items-center justify-center rounded transition-colors',
              isOpen ? 'bg-[var(--accent-soft)]' : 'hover:bg-[var(--accent-soft)]'
            )}
          >
            <span
              className="box-border h-[15px] w-[15px] shrink-0 overflow-hidden rounded-full border border-[var(--line)]"
              style={{ background: preview || fillPanelPreview(value) }}
            />
          </span>
        </Tooltip>
      )}
    </FillPanelPopover>
  );
}

export default memo(CanvasBgPicker);
