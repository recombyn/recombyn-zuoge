import { memo, type ReactNode } from 'react';
import { useSelector } from 'react-redux';
import { useTranslation } from 'react-i18next';
import { BiExit } from 'react-icons/bi';
import { HiOutlineBolt } from 'react-icons/hi2';
import Slider from '@/components/base/slider';
import Tooltip from '@/components/base/tooltip';
import { useShowCreditCosts } from '@/service/wallet';
import { cn } from '@/utils/classnames';
import './imageToolPanel.css';

/** Panel actions — soft rect (xl), same family as default SegmentedControl. */
const panelBtn =
  'inline-flex h-7 min-w-0 flex-1 items-center justify-center gap-1 whitespace-nowrap rounded-xl px-2 text-[12px] font-medium leading-none transition-colors';

/**
 * Image-tool 积分 costs — sync with apps/api `image_tools.py` `_KIND_CREDIT_COST`.
 * No LLM (removeBg / editText / editElements / CSS adjust) → 0.
 * Local desktop / BYOK also skip platform credits on the server.
 */
export const IMAGE_TOOL_CREDIT_COST = {
  upscale: 0,
  removeBg: 0,
  eraser: 0,
  multiAngle: 30,
  expand: 30,
  editText: 0,
  editElements: 0,
  detectRegions: 0,
  replaceText: 30,
  vector: 20,
  adjust: 0,
} as const;

/** Shared chrome for image tool panels docked beside the source image. */
function ImageToolPanelShell({
  title,
  headerRight,
  onClose,
  footer,
  className,
  children,
  width = 260,
}: {
  title: string;
  headerRight?: ReactNode;
  /** Exit (chat-style) — shown on the far right of the header. */
  onClose?: () => void;
  footer?: ReactNode;
  className?: string;
  children: ReactNode;
  width?: number;
}) {
  return (
    <div
      className={cn(
        'flex flex-col overflow-hidden rounded-xl bg-[var(--surface)] text-left shadow-[0_8px_28px_rgba(15,23,42,0.14)] ring-1 ring-[var(--line)]',
        className
      )}
      style={{ width }}
      onPointerDown={(e) => {
        e.stopPropagation();
        e.nativeEvent.stopImmediatePropagation?.();
      }}
      onWheel={(e) => {
        e.stopPropagation();
      }}
      onTouchMove={(e) => {
        e.stopPropagation();
      }}
      data-image-tool-panel
    >
      <div className="flex items-center justify-between gap-2 px-4 pb-1 pt-3.5">
        <h3 className="min-w-0 flex-1 truncate text-[15px] font-semibold tracking-tight text-[var(--ink)]">
          {title}
        </h3>
        <div className="flex shrink-0 items-center gap-1">
          {headerRight}
          {onClose ? (
            <Tooltip tip={'退出'} placement="top">
              <button
                type="button"
                aria-label={'退出'}
                onClick={onClose}
                className="inline-flex h-7 w-7 items-center justify-center rounded-xl text-[var(--muted)] transition-colors hover:bg-[var(--accent-soft)] hover:text-[var(--ink)]"
              >
                <BiExit className="h-[18px] w-[18px]" />
              </button>
            </Tooltip>
          ) : null}
        </div>
      </div>
      <div className="flex min-h-0 flex-1 flex-col px-4 pb-3 pt-2">{children}</div>
      {footer ? (
        <div className="flex flex-nowrap items-center gap-1.5 px-4 pb-2.5 pt-0.5">
          {footer}
        </div>
      ) : null}
    </div>
  );
}

function PanelIconBtn({
  title,
  onClick,
  children,
}: {
  title: string;
  onClick?: () => void;
  children: ReactNode;
}) {
  return (
    <Tooltip tip={title} placement="top">
      <button
        type="button"
        aria-label={title}
        onClick={onClick}
                className="inline-flex h-7 w-7 items-center justify-center rounded-xl text-[var(--muted)] transition-colors hover:bg-[var(--accent-soft)] hover:text-[var(--ink)]"
      >
        {children}
      </button>
    </Tooltip>
  );
}

/** Cost chip for primary CTAs: amount + bolt after the label; inherits text color. */
function PanelConfirmCost({
  amount,
}: {
  amount: number;
}) {
  const { t } = useTranslation();
  const showCreditCosts = useShowCreditCosts();
  const n = Number.isFinite(amount) ? Math.round(amount) : 0;
  // Free tools, local desktop, loopback dev, or wallet billing off — no credit chip.
  if (n <= 0 || !showCreditCosts) return null;
  const display = String(n);
  const tip = t('wallet.creditCostTip', { count: display });
  // Native title — do not wrap Tooltip (div) inside confirm <button>s.
  return (
    <span className="inline-flex shrink-0 items-center gap-0.5 text-current" title={tip}>
      <span className="tabular-nums">{display}</span>
      <HiOutlineBolt className="h-3.5 w-3.5 shrink-0" aria-hidden />
    </span>
  );
}


function PanelFooterActions({
  onCancel,
  onConfirm,
  confirmLabel,
  confirmDisabled,
  confirmBusy,
  confirmCost,
  confirmExtra,
}: {
  onCancel: () => void;
  onConfirm: () => void;
  confirmLabel: string;
  confirmDisabled?: boolean;
  confirmBusy?: boolean;
  /** When set, shows cost + bolt after the label (inherits button text color). */
  confirmCost?: number;
  confirmExtra?: ReactNode;
}) {
  return (
    <>
      <button
        type="button"
        className={cn(panelBtn, 'border border-[var(--line)] bg-[var(--surface)] text-[var(--ink)] hover:bg-[var(--accent-soft)]')}
        onClick={onCancel}
      >
        {'取消'}
      </button>
      <button
        type="button"
        disabled={confirmDisabled || confirmBusy}
        className={cn(
          panelBtn,
          'bg-[var(--ink)] text-[var(--on-brand)] hover:opacity-90 disabled:bg-[var(--line)] disabled:text-[var(--muted)] disabled:opacity-80'
        )}
        onClick={onConfirm}
      >
        {confirmBusy ? (
          <span className="h-3 w-3 shrink-0 animate-spin rounded-full border-2 border-white/30 border-t-white" />
        ) : null}
        <span className="truncate">{confirmLabel}</span>
        {typeof confirmCost === 'number' ? <PanelConfirmCost amount={confirmCost} /> : null}
        {confirmExtra}
      </button>
    </>
  );
}

function PanelSliderRow({
  label,
  value,
  display,
  min = -100,
  max = 100,
  step = 1,
  onChange,
  fillFromZero,
  className,
}: {
  label: string;
  value: number;
  display?: string;
  min?: number;
  max?: number;
  step?: number;
  onChange: (v: number) => void;
  fillFromZero?: boolean;
  className?: string;
}) {
  return (
    <div className={cn('flex items-center gap-2.5 py-1.5', className)}>
      <span className="w-10 shrink-0 text-left text-[12px] text-[var(--ink)]">{label}</span>
      <div className="relative min-w-0 flex-1 py-0.5">
        <Slider
          min={min}
          max={max}
          step={step}
          value={value}
          onChange={onChange}
          fillFromZero={fillFromZero}
        />
      </div>
      <span className="w-9 shrink-0 text-right text-[12px] tabular-nums text-[var(--muted)]">
        {display ?? String(value)}
      </span>
    </div>
  );
}

export default memo(ImageToolPanelShell);

const MemoizedPanelIconBtn = memo(PanelIconBtn);
export { MemoizedPanelIconBtn as PanelIconBtn };
const MemoizedPanelConfirmCost = memo(PanelConfirmCost);
export { MemoizedPanelConfirmCost as PanelConfirmCost };
const MemoizedPanelFooterActions = memo(PanelFooterActions);
export { MemoizedPanelFooterActions as PanelFooterActions };
const MemoizedPanelSliderRow = memo(PanelSliderRow);
export { MemoizedPanelSliderRow as PanelSliderRow };
