/**
 * Right-click menu for the Lottie timeline dock (Rive-style actions).
 */
import { memo, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { cn } from '@/utils/classnames';

export type LottieTimelineCtxTarget =
  | {
      kind: 'kf';
      propId: string;
      propKey: string;
      layerId: string;
      layerInd: number;
      timeSec: number;
      times: number[];
    }
  | {
      kind: 'prop';
      propId: string;
      propKey: string;
      layerId: string;
      layerInd: number;
      times: number[];
    }
  | {
      kind: 'layer';
      layerId: string;
      layerInd: number;
    }
  | { kind: 'empty' };

export type LottieTimelineCtxAction =
  | 'editKf'
  | 'addKf'
  | 'removeKf'
  | 'showAllKfs'
  | 'copy'
  | 'paste'
  | 'rename'
  | 'delete';

export type AnimationTimelineContextMenuState = {
  clientX: number;
  clientY: number;
  target: LottieTimelineCtxTarget;
};

type Props = {
  menu: AnimationTimelineContextMenuState | null;
  canPaste: boolean;
  onAction: (action: LottieTimelineCtxAction) => void;
  onClose: () => void;
};

const itemClass =
  'flex w-full items-center justify-between gap-6 px-3 py-1.5 text-left text-[12px] text-[var(--ink)] hover:bg-[var(--accent-soft)] disabled:pointer-events-none disabled:opacity-40';
const sepClass = 'my-1 h-px bg-[var(--line)]';
const PAD = 8;
const CLICK_THROUGH_GUARD_MS = 280;

function AnimationTimelineContextMenu({ menu, canPaste, onAction, onClose }: Props) {
  const { t } = useTranslation();
  const panelRef = useRef<HTMLDivElement | null>(null);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);
  const [guardOpen, setGuardOpen] = useState(false);
  const guardTimerRef = useRef<number | null>(null);
  const mod =
    typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform) ? '⌘' : 'Ctrl';

  const armGuard = () => {
    setGuardOpen(true);
    if (guardTimerRef.current != null) window.clearTimeout(guardTimerRef.current);
    guardTimerRef.current = window.setTimeout(() => {
      guardTimerRef.current = null;
      setGuardOpen(false);
    }, CLICK_THROUGH_GUARD_MS);
  };

  const close = () => {
    armGuard();
    onClose();
  };

  const run = (action: LottieTimelineCtxAction) => {
    onAction(action);
    close();
  };

  useLayoutEffect(() => {
    if (!menu || !panelRef.current) {
      setPos(null);
      return;
    }
    const rect = panelRef.current.getBoundingClientRect();
    const viewW = window.innerWidth;
    const viewH = window.innerHeight;
    let left = menu.clientX;
    let top = menu.clientY;
    if (left + rect.width > viewW - PAD) left = Math.max(PAD, viewW - PAD - rect.width);
    if (top + rect.height > viewH - PAD) top = Math.max(PAD, viewH - PAD - rect.height);
    if (left < PAD) left = PAD;
    if (top < PAD) top = PAD;
    setPos({ left, top });
  }, [menu]);

  useEffect(() => {
    if (!menu) return undefined;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        close();
      }
    };
    const onDown = (e: PointerEvent) => {
      const el = e.target as HTMLElement | null;
      if (panelRef.current?.contains(el)) return;
      close();
    };
    window.addEventListener('keydown', onKey);
    window.addEventListener('pointerdown', onDown, true);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('pointerdown', onDown, true);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- close closes menu; menu identity is enough
  }, [menu]);

  useEffect(
    () => () => {
      if (guardTimerRef.current != null) window.clearTimeout(guardTimerRef.current);
    },
    []
  );

  const target = menu?.target;
  const isKf = target?.kind === 'kf';
  const isProp = target?.kind === 'prop' || isKf;
  const isLayer = target?.kind === 'layer' || isProp;
  const canRemoveKf = isKf;
  const canAddKf = Boolean(target && (target.kind === 'prop' || target.kind === 'kf'));
  const canEditKf = isKf;
  const canCopy = isKf;
  const canRename = isLayer;
  const canDelete = isLayer || isKf;
  const canShowAll = isLayer;

  if (!menu && !guardOpen) return null;

  return createPortal(
    <>
      {guardOpen ? (
        <div className="pointer-events-auto fixed inset-0 z-[548]" aria-hidden />
      ) : null}
      {menu ? (
        <div
          ref={panelRef}
          data-lottie-timeline-ctx=""
          role="menu"
          className={cn(
            'pointer-events-auto fixed z-[550] min-w-[13.5rem] overflow-hidden rounded-xl bg-[var(--surface)] py-1 text-[var(--ink)] shadow-lg ring-1 ring-[var(--line)]'
          )}
          style={{
            left: pos?.left ?? menu.clientX,
            top: pos?.top ?? menu.clientY,
            visibility: pos ? 'visible' : 'hidden',
          }}
          onPointerDown={(e) => e.stopPropagation()}
          onContextMenu={(e) => e.preventDefault()}
        >
          <button
            type="button"
            role="menuitem"
            className={itemClass}
            disabled={!canEditKf && !canAddKf}
            onClick={() => run(canEditKf ? 'editKf' : 'addKf')}
          >
            <span>
              {canEditKf
                ? t('editor.lottieTimeline.ctxEditKf')
                : t('editor.lottieTimeline.ctxAnimate')}
            </span>
            <span className="text-[10px] tabular-nums text-[var(--muted)]">⇧K</span>
          </button>
          <button
            type="button"
            role="menuitem"
            className={itemClass}
            disabled={!canShowAll}
            onClick={() => run('showAllKfs')}
          >
            <span>
              {t('editor.lottieTimeline.ctxShowAllKfs')}
            </span>
            <span className="text-[10px] tabular-nums text-[var(--muted)]">U</span>
          </button>
          <button
            type="button"
            role="menuitem"
            className={itemClass}
            disabled={!canRemoveKf}
            onClick={() => run('removeKf')}
          >
            <span>
              {t('editor.lottieTimeline.ctxRemoveKfs')}
            </span>
          </button>

          <div className={sepClass} role="separator" />

          <button
            type="button"
            role="menuitem"
            className={itemClass}
            disabled={!canCopy}
            onClick={() => run('copy')}
          >
            <span>{t('editor.contextMenu.copy')}</span>
            <span className="text-[10px] tabular-nums text-[var(--muted)]">{mod}+C</span>
          </button>
          <button
            type="button"
            role="menuitem"
            className={itemClass}
            disabled={!canPaste || (!isProp && !isKf)}
            onClick={() => run('paste')}
          >
            <span>{t('editor.contextMenu.paste')}</span>
            <span className="text-[10px] tabular-nums text-[var(--muted)]">{mod}+V</span>
          </button>

          <div className={sepClass} role="separator" />

          <button
            type="button"
            role="menuitem"
            className={itemClass}
            disabled={!canRename}
            onClick={() => run('rename')}
          >
            <span>{t('editor.lottieTimeline.ctxRename')}</span>
            <span className="text-[10px] tabular-nums text-[var(--muted)]">↵</span>
          </button>
          <button
            type="button"
            role="menuitem"
            className={itemClass}
            disabled={!canDelete}
            onClick={() => run('delete')}
          >
            <span>{t('editor.contextMenu.delete')}</span>
            <span className="text-[10px] tabular-nums text-[var(--muted)]">⌫</span>
          </button>
        </div>
      ) : null}
    </>,
    document.body
  );
}

export default memo(AnimationTimelineContextMenu);
