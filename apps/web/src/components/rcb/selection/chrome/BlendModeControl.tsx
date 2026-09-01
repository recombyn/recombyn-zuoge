import { useMemo, useState, type CSSProperties, type ReactNode, memo } from 'react';
import {
  autoUpdate,
  flip,
  FloatingPortal,
  offset,
  shift,
  useClick,
  useDismiss,
  useFloating,
  useInteractions,
} from '@floating-ui/react';
import { useTranslation } from 'react-i18next';
import { HiOutlineArrowPath, HiOutlineCheck, HiOutlineChevronDown } from 'react-icons/hi2';
import { MdOutlineOpacity } from 'react-icons/md';
import { Dropdown } from '@/components/base';
import type { MenuItemType } from '@/components/base/dropdown';
import { DropdownPanel } from '@/components/base/dropdown/DropdownPanel';
import Slider from '@/components/base/slider';
import Tooltip from '@/components/base/tooltip';
import { cn } from '@/utils/classnames';
import { SEL_ICON_BTN_ACTIVE, SEL_TOOL_BTN } from './ToolbarValueSlider';

/** Layer blend modes (CSS mix-blend-mode). */
export type BlendModeId =
  | 'pass-through'
  | 'normal'
  | 'darken'
  | 'multiply'
  | 'color-burn'
  | 'lighten'
  | 'screen'
  | 'color-dodge'
  | 'overlay'
  | 'soft-light'
  | 'hard-light'
  | 'difference'
  | 'exclusion'
  | 'hue'
  | 'saturation'
  | 'color'
  | 'luminosity';

export type BlendModeOption = {
  id: BlendModeId;
  groupStart?: boolean;
};

export const BLEND_MODE_OPTIONS: BlendModeOption[] = [
  { id: 'pass-through' },
  { id: 'normal' },
  { id: 'darken', groupStart: true },
  { id: 'multiply' },
  { id: 'color-burn' },
  { id: 'lighten', groupStart: true },
  { id: 'screen' },
  { id: 'color-dodge' },
  { id: 'overlay', groupStart: true },
  { id: 'soft-light' },
  { id: 'hard-light' },
  { id: 'difference', groupStart: true },
  { id: 'exclusion' },
  { id: 'hue', groupStart: true },
  { id: 'saturation' },
  { id: 'color' },
  { id: 'luminosity' },
];

const BLEND_MODE_SET = new Set(BLEND_MODE_OPTIONS.map((o) => o.id));

export function parseBlendMode(raw: unknown, opts?: { allowPassThrough?: boolean }): BlendModeId {
  const s = String(raw || '').trim().toLowerCase();
  const normalized =
    s === 'passthrough' || s === 'pass_through' ? 'pass-through' : s;
  if (BLEND_MODE_SET.has(normalized as BlendModeId)) {
    const id = normalized as BlendModeId;
    if (id === 'pass-through' && !opts?.allowPassThrough) return 'normal';
    return id;
  }
  return 'normal';
}

export function blendModeToCss(id: BlendModeId): string {
  if (id === 'pass-through') return '';
  return id;
}

export function parseLayerOpacity(raw: unknown, fallback = 1): number {
  const n = Number(raw);
  if (!Number.isFinite(n)) return fallback;
  if (n > 1) return Math.min(1, Math.max(0, n / 100));
  return Math.min(1, Math.max(0, n));
}

export function layerOpacityToPct(opacity01: number): number {
  return Math.round(Math.min(1, Math.max(0, opacity01)) * 100);
}

function clampOpacityPct(n: number): number {
  return Math.min(100, Math.max(0, Math.round(n)));
}

/** Mini two-circle preview — monochrome so it matches the rest of the toolbar. */
export function BlendModeIcon({ mode, className }: { mode: BlendModeId; className?: string }) {
  const cssMode: CSSProperties['mixBlendMode'] =
    mode === 'pass-through' ? 'normal' : (mode as CSSProperties['mixBlendMode']);
  return (
    <span
      className={cn(
        'relative inline-block h-3.5 w-3.5 shrink-0 overflow-hidden rounded-[2px] bg-[var(--canvas)] ring-1 ring-[var(--line)]',
        className
      )}
      style={{ isolation: 'isolate' }}
      aria-hidden
    >
      <span
        className="absolute left-0 top-0 h-[10px] w-[10px] rounded-full"
        style={{ background: '#737373' }}
      />
      <span
        className="absolute bottom-0 right-0 h-[10px] w-[10px] rounded-full"
        style={{ background: '#b0b0b0', mixBlendMode: cssMode }}
      />
    </span>
  );
}

export function OpacityControl({
  opacity,
  onOpacityChange,
  className,
}: {
  opacity?: unknown;
  onOpacityChange: (opacity01: number) => void;
  className?: string;
}) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const pct = layerOpacityToPct(parseLayerOpacity(opacity, 1));
  const opacityLabel = t('editor.imageToolbar.opacity');
  const applyPct = (nextPct: number) => {
    onOpacityChange(clampOpacityPct(nextPct) / 100);
  };
  const { refs, floatingStyles, context } = useFloating({
    open,
    onOpenChange: setOpen,
    placement: 'bottom-start',
    strategy: 'fixed',
    whileElementsMounted: autoUpdate,
    middleware: [
      offset(6),
      flip({
        padding: 12,
        fallbackPlacements: ['top-start', 'top-end', 'right-start', 'left-start'],
      }),
      shift({ padding: 12 }),
    ],
  });
  const click = useClick(context);
  const dismiss = useDismiss(context, { outsidePressEvent: 'pointerdown' });
  const { getReferenceProps, getFloatingProps } = useInteractions([click, dismiss]);

  return (
    <div className={cn('inline-flex', className)}>
      <button
        type="button"
        aria-label={opacityLabel}
        aria-expanded={open}
        ref={refs.setReference}
        className={cn(SEL_TOOL_BTN, open && SEL_ICON_BTN_ACTIVE)}
        {...getReferenceProps()}
      >
        <MdOutlineOpacity className="h-4 w-4" />
        <span>{opacityLabel}</span>
      </button>
      <FloatingPortal>
        {open ? (
          <DropdownPanel
            className="z-[80] w-[240px]"
            style={floatingStyles}
            ref={refs.setFloating}
            {...getFloatingProps()}
          >
            <div className="flex h-9 items-center justify-between gap-1 px-3">
              <span className="min-w-0 truncate text-[13px] font-medium text-[var(--ink)]">
                {opacityLabel}
              </span>
              <Tooltip tip={t('editor.imageToolbar.reset')} placement="top">
                <button
                  type="button"
                  aria-label={t('editor.imageToolbar.reset')}
                  onClick={() => applyPct(100)}
                  className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-xl text-[var(--muted)] transition-colors hover:bg-[var(--accent-soft)] hover:text-[var(--ink)]"
                >
                  <HiOutlineArrowPath className="h-4 w-4" />
                </button>
              </Tooltip>
            </div>
            <div className="px-3 pb-3">
              <Slider
                min={0}
                max={100}
                step={1}
                value={pct}
                onChange={applyPct}
                trackHeight={6}
                thumbWidth={16}
                thumbHeight={16}
              />
            </div>
          </DropdownPanel>
        ) : null}
      </FloatingPortal>
    </div>
  );
}

type Props = {
  blendMode?: unknown;
  opacity?: unknown;
  /** Pass-through is only meaningful for groups/frames. */
  allowPassThrough?: boolean;
  onBlendModeChange: (mode: BlendModeId) => void;
  onOpacityChange: (opacity01: number) => void;
  /** Inserted between blend-mode dropdown and opacity (e.g. corner radius). */
  afterBlendSlot?: ReactNode;
  className?: string;
};

function BlendModeControl({
  blendMode,
  opacity,
  allowPassThrough = false,
  onBlendModeChange,
  onOpacityChange,
  afterBlendSlot,
  className,
}: Props) {
  const { t } = useTranslation();
  const [blendOpen, setBlendOpen] = useState(false);
  const mode = parseBlendMode(blendMode, { allowPassThrough });
  const labelOf = (id: BlendModeId) => t(`editor.blendMode.${id}`);

  const items: MenuItemType[] = useMemo(() => {
    const out: MenuItemType[] = [];
    for (const opt of BLEND_MODE_OPTIONS) {
      if (opt.id === 'pass-through' && !allowPassThrough) continue;
      if (opt.groupStart && out.length > 0) {
        out.push({ key: `div-${opt.id}`, type: 'divider', label: '' });
      }
      out.push({
        key: opt.id,
        label: (
          <span className="flex w-full items-center gap-2">
            <BlendModeIcon mode={opt.id} />
            <span className="min-w-0 flex-1 truncate">{labelOf(opt.id)}</span>
            {mode === opt.id ? (
              <HiOutlineCheck className="h-3.5 w-3.5 shrink-0 text-[var(--accent)]" />
            ) : (
              <span className="h-3.5 w-3.5 shrink-0" />
            )}
          </span>
        ),
      });
    }
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps -- t + mode drive labels
  }, [mode, t, allowPassThrough]);

  return (
    <div className={cn('inline-flex h-8 items-center gap-0.5', className)}>
      <Dropdown
        trigger="click"
        open={blendOpen}
        onOpenChange={setBlendOpen}
        placement="bottom-start"
        offset={6}
        strategy="fixed"
        items={items}
        selectedKeys={[mode]}
        onClick={(key) => {
          if (key.startsWith('div-')) return;
          onBlendModeChange(parseBlendMode(key, { allowPassThrough }));
          setBlendOpen(false);
        }}
        popupClassName="min-w-[11rem] max-h-[min(70vh,22rem)] overflow-y-auto"
        floatingClassName="z-[80]"
        referenceClassName="inline-flex"
      >
        <button
          type="button"
          aria-label={t('editor.imageToolbar.blendMode')}
          aria-expanded={blendOpen}
          className={cn(
            'inline-flex h-8 max-w-[8.5rem] items-center gap-1.5 rounded-[4px] px-1.5 text-[12px] text-[var(--ink)] transition-colors hover:bg-[var(--accent-soft)]',
            blendOpen && 'bg-[var(--accent-soft)]'
          )}
        >
          <BlendModeIcon mode={mode} />
          <span className="min-w-0 truncate">{labelOf(mode)}</span>
          <HiOutlineChevronDown className="h-3.5 w-3.5 shrink-0 text-current" />
        </button>
      </Dropdown>
      {afterBlendSlot}
      <OpacityControl opacity={opacity} onOpacityChange={onOpacityChange} />
    </div>
  );
}

export default memo(BlendModeControl);
