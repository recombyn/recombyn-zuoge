/**
 * Floating keyframe inspector (Rive / AE-style) — values, easing, delete.
 * Anchors bottom-left of the panel to the keyframe diamond (same chrome as canvas ctx menu).
 */
import {
  memo,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { HiOutlineTrash } from 'react-icons/hi2';
import type { LottieEasingPreset } from '@/components/editor/nodes/AnimationNode/animationTimelineMutate';
import { translateLottiePropLabel } from '@/components/editor/nodes/AnimationNode/animationPropI18n';
import { cn } from '@/utils/classnames';

const EASING_PRESETS: Array<{ id: LottieEasingPreset; labelKey: string; fallback: string }> = [
  { id: 'linear', labelKey: 'editor.lottieTimeline.easeLinear', fallback: 'Linear' },
  { id: 'ease', labelKey: 'editor.lottieTimeline.easeSmooth', fallback: 'Ease' },
  { id: 'easeIn', labelKey: 'editor.lottieTimeline.easeIn', fallback: 'Ease In' },
  { id: 'easeOut', labelKey: 'editor.lottieTimeline.easeOut', fallback: 'Ease Out' },
  { id: 'hold', labelKey: 'editor.lottieTimeline.easeHold', fallback: 'Hold' },
];

const PROP_CHANNELS: Record<string, string[]> = {
  p: ['X', 'Y'],
  a: ['X', 'Y'],
  s: ['X', 'Y'],
  r: ['°'],
  o: ['%'],
  sk: ['°'],
  sa: ['°'],
};

const FIELD =
  'flex h-7 min-w-0 items-center gap-1 rounded-sm bg-[var(--accent-soft)] px-1.5';
const LABEL =
  'w-3 shrink-0 cursor-ew-resize select-none text-[10px] font-medium text-[var(--muted)]';
const INPUT =
  'min-w-0 flex-1 border-0 bg-transparent p-0 text-[11px] tabular-nums text-[var(--ink)] outline-none';

export type AnimationKeyframePopoverProps = {
  open: boolean;
  anchor: { x: number; y: number } | null;
  propKey: string;
  propLabel?: string;
  timeSec: number;
  fps: number;
  valueDraft: string[];
  easing?: LottieEasingPreset | null;
  hold?: boolean;
  onChangeDraft: (next: string[]) => void;
  onCommitValues: (override?: string[]) => void;
  onCommitChannel: (index: number, n: number) => void;
  onEasing: (preset: LottieEasingPreset) => void;
  onDelete: () => void;
  onClose: () => void;
};

function useLabelScrub(onCommit: (n: number) => void, value: number, step = 1) {
  const valueRef = useRef(value);
  valueRef.current = value;
  const onCommitRef = useRef(onCommit);
  onCommitRef.current = onCommit;
  const stepRef = useRef(step);
  stepRef.current = step;
  const dragRef = useRef<{
    pointerId: number;
    startX: number;
    startValue: number;
    moved: boolean;
  } | null>(null);

  useEffect(() => {
    const onMove = (e: PointerEvent) => {
      const drag = dragRef.current;
      if (!drag || drag.pointerId !== e.pointerId) return;
      e.preventDefault();
      e.stopPropagation();
      const dx = e.clientX - drag.startX;
      if (!drag.moved && Math.abs(dx) < 2) return;
      drag.moved = true;
      const fine = e.shiftKey ? 0.1 : 1;
      const next = drag.startValue + Math.round((dx / 2) * fine) * stepRef.current;
      onCommitRef.current(next);
    };
    const onUp = (e: PointerEvent) => {
      const drag = dragRef.current;
      if (!drag || drag.pointerId !== e.pointerId) return;
      dragRef.current = null;
    };
    window.addEventListener('pointermove', onMove, true);
    window.addEventListener('pointerup', onUp, true);
    window.addEventListener('pointercancel', onUp, true);
    return () => {
      window.removeEventListener('pointermove', onMove, true);
      window.removeEventListener('pointerup', onUp, true);
      window.removeEventListener('pointercancel', onUp, true);
    };
  }, []);

  const onPointerDown = useCallback((e: ReactPointerEvent<HTMLElement>) => {
    if (e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    dragRef.current = {
      pointerId: e.pointerId,
      startX: e.clientX,
      startValue: valueRef.current,
      moved: false,
    };
  }, []);

  return { onPointerDown };
}

function ScrubField({
  label,
  raw,
  onTyped,
  onBlurCommit,
  onScrub,
}: {
  label: string;
  raw: string;
  onTyped: (s: string) => void;
  onBlurCommit: () => void;
  onScrub: (n: number) => void;
}) {
  const num = Number(raw);
  const scrub = useLabelScrub(onScrub, Number.isFinite(num) ? num : 0);
  return (
    <div className={FIELD}>
      <span className={LABEL} title="Drag to adjust" {...scrub}>
        {label}
      </span>
      <input
        type="text"
        inputMode="decimal"
        className={INPUT}
        value={raw}
        onPointerDown={(e) => e.stopPropagation()}
        onChange={(ev) => onTyped(ev.target.value)}
        onBlur={onBlurCommit}
        onKeyDown={(ev) => {
          if (ev.key === 'Enter') (ev.target as HTMLInputElement).blur();
        }}
      />
    </div>
  );
}

function AnimationKeyframePopover({
  open,
  anchor,
  propKey,
  propLabel,
  timeSec,
  fps,
  valueDraft,
  easing,
  hold,
  onChangeDraft,
  onCommitValues,
  onCommitChannel,
  onEasing,
  onDelete,
  onClose,
}: AnimationKeyframePopoverProps) {
  const { t } = useTranslation();
  const panelRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 220, h: 200 });
  const channels = PROP_CHANNELS[propKey] || valueDraft.map((_, i) => String(i + 1));
  const title = translateLottiePropLabel(t, propKey, propLabel || propKey);
  const frame = Math.round(Math.max(0, timeSec) * Math.max(1, fps));
  const activeEase: LottieEasingPreset | null = hold ? 'hold' : easing || null;

  useLayoutEffect(() => {
    if (!open || !anchor) return;
    const el = panelRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    if (rect.width > 0 && rect.height > 0) {
      setSize({ w: rect.width, h: rect.height });
    }
  }, [open, anchor, valueDraft.length, propKey]);

  const style = useMemo(() => {
    if (!anchor) return { left: 0, top: 0, visibility: 'hidden' as const };
    const pad = 8;
    const gap = 4;
    // Bottom-left of panel sits on the keyframe (panel opens upward / rightward).
    let left = anchor.x;
    let top = anchor.y - gap - size.h;
    if (left + size.w > window.innerWidth - pad) {
      left = Math.max(pad, anchor.x - size.w);
    }
    if (top < pad) {
      top = Math.min(window.innerHeight - pad - size.h, anchor.y + gap);
    }
    left = Math.max(pad, Math.min(window.innerWidth - pad - size.w, left));
    top = Math.max(pad, Math.min(window.innerHeight - pad - size.h, top));
    return {
      left,
      top,
      visibility: 'visible' as const,
    };
  }, [anchor, size.h, size.w]);

  useEffect(() => {
    if (!open || !anchor) return undefined;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      }
    };
    const onDown = (e: PointerEvent) => {
      const el = e.target as HTMLElement | null;
      if (!el) return;
      if (panelRef.current?.contains(el)) return;
      if (el.closest?.('[data-lottie-kf-popover]')) return;
      onClose();
    };
    window.addEventListener('keydown', onKey);
    window.addEventListener('pointerdown', onDown, true);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('pointerdown', onDown, true);
    };
  }, [open, anchor, onClose]);

  if (!open || !anchor) return null;

  return createPortal(
    <div
      ref={panelRef}
      data-lottie-kf-popover=""
      className="pointer-events-auto fixed z-[540] w-[13.75rem] overflow-hidden rounded-xl bg-[var(--surface)] text-[var(--ink)] shadow-lg ring-1 ring-[var(--line)]"
      style={style}
      role="dialog"
      aria-label={t('editor.lottieTimeline.kfPanel')}
    >
      <div className="flex items-center justify-between gap-2 border-b border-[var(--line)] px-2.5 py-1.5">
        <div className="min-w-0">
          <div className="truncate text-[11px] font-semibold">{title}</div>
          <div className="text-[10px] tabular-nums text-[var(--muted)]">
            {timeSec.toFixed(2)}s · f{frame}
          </div>
        </div>
        <button
          type="button"
          className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-sm text-[var(--muted)] hover:bg-[var(--accent-soft)] hover:text-[var(--ink)]"
          aria-label={t('editor.lottieTimeline.deleteKf')}
          onClick={onDelete}
        >
          <HiOutlineTrash className="h-3.5 w-3.5" strokeWidth={1.75} />
        </button>
      </div>

      <div className="space-y-2 px-2.5 py-2">
        <div className="text-[10px] font-medium uppercase tracking-wide text-[var(--muted)]">
          {t('editor.lottieTimeline.kfValue')}
        </div>
        <div className={cn('grid gap-1.5', valueDraft.length > 1 ? 'grid-cols-2' : 'grid-cols-1')}>
          {valueDraft.map((raw, i) => (
            <ScrubField
              key={i}
              label={channels[i] ?? String(i + 1)}
              raw={raw}
              onTyped={(s) => {
                const next = [...valueDraft];
                next[i] = s;
                onChangeDraft(next);
              }}
              onBlurCommit={() => onCommitValues()}
              onScrub={(n) => onCommitChannel(i, n)}
            />
          ))}
        </div>

        <div className="text-[10px] font-medium uppercase tracking-wide text-[var(--muted)]">
          {t('editor.lottieTimeline.easing')}
        </div>
        <div className="flex flex-wrap gap-1">
          {EASING_PRESETS.map((p) => (
            <button
              key={p.id}
              type="button"
              className={cn(
                'h-6 rounded-sm px-1.5 text-[10px] font-medium transition-colors',
                activeEase === p.id
                  ? 'bg-[var(--ink)] text-[var(--surface)]'
                  : 'bg-[var(--accent-soft)] text-[var(--ink)] hover:bg-[var(--line)]'
              )}
              aria-pressed={activeEase === p.id}
              onClick={() => onEasing(p.id)}
            >
              {t(p.labelKey, { defaultValue: p.fallback })}
            </button>
          ))}
        </div>
      </div>
    </div>,
    document.body
  );
}

export default memo(AnimationKeyframePopover);
