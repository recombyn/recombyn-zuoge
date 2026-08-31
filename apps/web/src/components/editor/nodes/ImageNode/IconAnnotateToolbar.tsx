import { memo, type ReactNode } from 'react';
import { useSelector } from '@/store';
import { LuPencil } from 'react-icons/lu';
import { ColorPanelPopover } from '@/components/base/colorPanel';
import { Icon } from '@/components/base/icon';
import Slider from '@/components/base/slider';
import Tooltip from '@/components/base/tooltip';
import {
  setActiveTool,
  setPenStrokeColor,
  setPenStrokeWidth,
} from '@/store/modules/editor';
import { cn } from '@/utils/classnames';
type Props = {
  /** Optional download / export control after the annotate tools. */
  downloadSlot?: ReactNode;
};

const BTN =
  'inline-flex h-8 w-8 items-center justify-center rounded-lg text-white/85 transition-colors hover:bg-white/10';
const BTN_ACTIVE = 'bg-white/15 text-white';

/**
 * Icon annotate strip: pen · select · text · color · stroke width.
 * No photo tools (remove-bg / upscale / eraser — .
 */
function IconAnnotateToolbar({ downloadSlot }: Props): ReactNode {  const activeTool = useSelector((s: any) => String(s.editor.activeTool || 'select'));
  const color = useSelector((s: any) => String(s.editor.penStrokeColor || '#ef4444'));
  const width = useSelector((s: any) => {
    const n = Number(s.editor.penStrokeWidth);
    return Number.isFinite(n) && n > 0 ? n : 2;
  });

  const penActive = activeTool === 'pencil' || activeTool === 'pen';
  const selectActive = activeTool === 'select' || activeTool === 'pan';
  const textActive = activeTool === 'text';

  return (
    <div
      className="inline-flex items-center gap-0.5 rounded-[12px] bg-[#2c2c2c] px-1.5 py-1 shadow-[0_8px_24px_rgba(0,0,0,0.28)]"
      onPointerDown={(e) => e.stopPropagation()}
    >
      <Tooltip tip={'画笔'} placement="top">
        <button
          type="button"
          aria-label={'画笔'}
          className={cn(BTN, penActive && BTN_ACTIVE)}
          onClick={() => setActiveTool('pencil')}
        >
          <LuPencil className="h-4 w-4" strokeWidth={1.75} />
        </button>
      </Tooltip>

      <Tooltip tip={'选择'} placement="top">
        <button
          type="button"
          aria-label={'选择'}
          className={cn(BTN, selectActive && !penActive && !textActive && BTN_ACTIVE)}
          onClick={() => setActiveTool('select')}
        >
          <Icon name="editor-annotate-select" className="h-4 w-4" />
        </button>
      </Tooltip>

      <Tooltip tip={'文字'} placement="top">
        <button
          type="button"
          aria-label={'文字'}
          className={cn(BTN, textActive && BTN_ACTIVE)}
          onClick={() => setActiveTool('text')}
        >
          <Icon name="editor-annotate-text" className="h-4 w-4" />
        </button>
      </Tooltip>

      <span className="mx-1 h-4 w-px bg-white/20" aria-hidden />

      <ColorPanelPopover
        value={color}
        onChange={(hex) => setPenStrokeColor(hex)}
        title={'标注颜色'}
        placement="top"
        offset={10}
        shiftMainAxis={false}
        className="inline-flex"
      >
        {({ open, hex }) => (
          <Tooltip tip={'颜色'} placement="top">
            <span className={cn(BTN, open && BTN_ACTIVE)}>
              <span
                className="h-4 w-4 rounded-full ring-1 ring-white/30"
                style={{ background: hex }}
              />
            </span>
          </Tooltip>
        )}
      </ColorPanelPopover>

      <span className="mx-1 h-4 w-px bg-white/20" aria-hidden />

      <div className="flex items-center gap-2 px-1">
        <Icon name="editor-annotate-stroke" className="h-4 w-4 shrink-0 text-white/80" />
        <div className="w-[88px]">
          <Slider
            min={1}
            max={24}
            step={1}
            value={width}
            onChange={(v) => setPenStrokeWidth(v)}
            thumbColor="#ffffff"
            activeColor="#ffffff"
            inactiveColor="rgba(255,255,255,0.28)"
          />
        </div>
      </div>

      {downloadSlot ? (
        <>
          <span className="mx-1 h-4 w-px bg-white/20" aria-hidden />
          <span className="[&_button]:text-white/85 [&_button:hover]:bg-white/10">
            {downloadSlot}
          </span>
        </>
      ) : null}
    </div>
  );
}

export default memo(IconAnnotateToolbar);
