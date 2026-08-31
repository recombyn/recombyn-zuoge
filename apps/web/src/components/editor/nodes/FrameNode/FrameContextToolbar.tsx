import { useState, memo } from 'react';
import { useDispatch } from '@/store';
import { useTranslation } from 'react-i18next';
import {
  HiOutlineArrowsRightLeft,
  HiOutlineEye,
  HiOutlineEyeSlash,
  HiOutlineLockClosed,
  HiOutlineLockOpen,
} from 'react-icons/hi2';
import { ColorPanelPopover, FILL_ALPHA_PRESETS } from '@/components/base/colorPanel';
import { Icon } from '@/components/base/icon';
import FrameSizePresetMenu from '@/components/editor/nodes/FrameNode/FrameSizePresetMenu';
import {
  applyFramePreset,
  findFramePreset,
  matchFramePreset,
  swapFrameOrientation,
} from '@/components/editor/chrome/SizePresetPanel';
import {
  updateArtboardFrame,
  type ArtboardFrame,
} from '@/store/modules/editor';
import Tooltip from '@/components/base/tooltip';
import { SEL_ICON_BTN, SEL_SIZE_INPUT, SEL_TOOL_BTN } from '@/components/rcb/selection/chrome/ToolbarValueSlider';
import { SelectionToolbarShell } from '@/components/rcb/selection/chrome/SelectionToolbarShell';
import { ExportSelectionPopover } from '@/components/editor/panels/ExportSelectionPanel';
import { cn } from '@/utils/classnames';

type Props = {
  frame: ArtboardFrame;
  frames?: ArtboardFrame[];
  box?: { left: number; top: number; width: number; height: number };
};

/** Matches shape / selection toolbar field chrome. */
const field =
  'inline-flex h-8 shrink-0 items-center gap-1 rounded-lg px-1.5 text-[12px] text-[var(--ink)]';

/** Floating toolbar for the active artboard / frame (shown after draw / select). */
function FrameContextToolbar({ frame, frames, box }: Props) {
  const { t } = useTranslation();
  const dispatch = useDispatch();
  const [presetOpen, setPresetOpen] = useState(false);
  const [ratioOpen, setRatioOpen] = useState(false);
  const canvasLocked = Boolean(frame.locked);
  const multiFrame = Boolean(frames && frames.length > 1);
  const aspectLocked = Boolean(frame.lockAspect);
  const clipContent = Boolean(frame.clipContent);
  const presetKey = matchFramePreset(frame.width, frame.height);
  const presetMeta = findFramePreset(presetKey);
  const isRatio = presetMeta?.category === 'ratio';
  const deviceTitle = isRatio
    ? t('editor.frameToolbar.custom')
    : presetMeta?.label || t('editor.frameToolbar.custom');
  // Default / free size — original; matched ratio preset — e.g. 4:3
  const ratioTitle = isRatio
    ? presetMeta?.key === 'original'
      ? t('editor.frameToolbar.original')
      : presetMeta?.label || t('editor.frameToolbar.original')
    : t('editor.frameToolbar.original');
  const ratioActiveKey = isRatio ? presetKey : 'original';
  const isLandscape = frame.width > frame.height;

  const patch = (next: Partial<ArtboardFrame>) => {
    dispatch(updateArtboardFrame({ id: frame.id, patch: next }));
  };

  const setSize = (axis: 'w' | 'h', raw: string) => {
    if (canvasLocked) return;
    const trimmed = String(raw || '').trim();
    if (!trimmed) return;
    const n = Math.round(Number(trimmed));
    if (!Number.isFinite(n) || n < 40) return;
    if (axis === 'w' && n === Math.round(frame.width)) return;
    if (axis === 'h' && n === Math.round(frame.height)) return;
    if (aspectLocked) {
      const ratio = frame.width / Math.max(1, frame.height);
      if (axis === 'w') {
        patch({ width: n, height: Math.max(40, Math.round(n / ratio)) });
      } else {
        patch({ width: Math.max(40, Math.round(n * ratio)), height: n });
      }
      return;
    }
    if (axis === 'w') patch({ width: n });
    else patch({ height: n });
  };

  const fill = frame.backgroundColor || '#FFFFFF';
  const fillHex = fill === 'transparent' ? '#FFFFFF' : fill;
  const fillOpacity = fill === 'transparent'
    ? 0
    : Math.max(0, Math.min(100, Number(frame.backgroundOpacity ?? 100)));
  const resolveFrameColorForOpacity = (opacity: number) => {
    if (opacity <= 0) return 'transparent';
    if (frame.backgroundColor === 'transparent') return '#FFFFFF';
    return frame.backgroundColor || '#FFFFFF';
  };

  return (
    <SelectionToolbarShell
      box={box || { left: frame.x, top: frame.y, width: frame.width, height: frame.height }}
      hasTitleLabel={!multiFrame}
      isFrameToolbar
      zIndexClassName="z-[30]"
    >
      <ColorPanelPopover
        value={fillHex}
        opacity={fillOpacity}
        showAlpha
        presets={FILL_ALPHA_PRESETS}
        onChange={(hex) => {
          if (hex === 'transparent') {
            patch({ backgroundColor: 'transparent', backgroundOpacity: 0 });
            return;
          }
          patch({
            backgroundColor: hex,
            backgroundOpacity: fillOpacity > 0 ? fillOpacity : 100,
          });
        }}
        onOpacityChange={(opacity) => {
          const nextOpacity = Math.max(0, Math.min(100, Math.round(opacity)));
          const nextColor = resolveFrameColorForOpacity(nextOpacity);
          patch({ backgroundColor: nextColor, backgroundOpacity: nextOpacity });
        }}
        title={t('editor.frameToolbar.canvasColor')}
        placement="bottom-start"
        className={SEL_ICON_BTN}
      >
        <span
          className="relative inline-flex h-4 w-4 overflow-hidden rounded-full ring-1 ring-[var(--line)]"
          style={{ background: fill === 'transparent' ? undefined : fill }}
        >
          {fill === 'transparent' ? (
            <span
              aria-hidden
              className="absolute inset-0"
              style={{
                backgroundImage:
                  'linear-gradient(45deg,#9ca3af 25%,transparent 25%,transparent 75%,#9ca3af 75%),linear-gradient(45deg,#9ca3af 25%,transparent 25%,transparent 75%,#9ca3af 75%)',
                backgroundSize: '6px 6px',
                backgroundPosition: '0 0, 3px 3px',
              }}
            />
          ) : null}
        </span>
      </ColorPanelPopover>

      <FrameSizePresetMenu
        open={presetOpen}
        onOpenChange={(v) => {
          if (canvasLocked) return;
          setPresetOpen(v);
          if (v) setRatioOpen(false);
        }}
        activeKey={isRatio ? 'custom' : presetKey}
        panelDataAttrs={{ 'data-frame-toolbar': true }}
        triggerClassName={cn(
          SEL_TOOL_BTN,
          'gap-1.5 px-2.5',
          presetOpen && 'bg-[var(--accent-soft)]',
          canvasLocked && 'pointer-events-none opacity-50'
        )}
        onPick={(preset) => {
          if (canvasLocked) return;
          const next = applyFramePreset(frame, preset);
          patch(next);
        }}
        iconKind={isRatio ? 'doc' : presetMeta?.icon || 'doc'}
      >
        <span className="max-w-[7rem] truncate">{deviceTitle}</span>
      </FrameSizePresetMenu>

      <Tooltip
        tip={
          isLandscape
            ? t('editor.frameToolbar.toPortrait')
            : t('editor.frameToolbar.toLandscape')
        }
        placement="top"
      >
        <button
          type="button"
          aria-label={
            isLandscape
              ? t('editor.frameToolbar.toPortrait')
              : t('editor.frameToolbar.toLandscape')
          }
          aria-pressed={isLandscape}
          disabled={canvasLocked}
          className={cn(
            SEL_ICON_BTN,
            isLandscape && 'bg-[var(--accent-soft)]',
            canvasLocked && 'opacity-50'
          )}
          onClick={() => {
            if (canvasLocked) return;
            patch(swapFrameOrientation(frame));
          }}
        >
          <HiOutlineArrowsRightLeft className="h-3.5 w-3.5" />
        </button>
      </Tooltip>

      <FrameSizePresetMenu
        variant="ratio"
        open={ratioOpen}
        onOpenChange={(v) => {
          if (canvasLocked) return;
          setRatioOpen(v);
          if (v) setPresetOpen(false);
        }}
        activeKey={ratioActiveKey}
        panelDataAttrs={{ 'data-frame-toolbar': true }}
        triggerClassName={cn(
          SEL_TOOL_BTN,
          'gap-1.5 px-2.5',
          ratioOpen && 'bg-[var(--accent-soft)]',
          canvasLocked && 'pointer-events-none opacity-50'
        )}
        onPick={(preset) => {
          if (canvasLocked) return;
          if (preset.key === 'original') {
            // 「自由」：保持当前尺寸，取消比例锁—
            patch({ lockAspect: false });
            return;
          }
          const next = applyFramePreset(frame, preset);
          const hasOrig =
            Number(frame.aspectOriginalWidth) > 0 && Number(frame.aspectOriginalHeight) > 0;
          patch({
            ...next,
            lockAspect: true,
            ...(!hasOrig
              ? {
                  aspectOriginalWidth: Math.round(frame.width),
                  aspectOriginalHeight: Math.round(frame.height),
                }
              : {}),
          });
        }}
      >
        <span>{ratioTitle}</span>
      </FrameSizePresetMenu>

      <label className={cn(field, canvasLocked && 'opacity-50')}>
        <span className="text-[var(--muted)]">W</span>
        <input
          className={SEL_SIZE_INPUT}
          value={Math.round(frame.width)}
          disabled={canvasLocked}
          onChange={(e) => setSize('w', e.target.value)}
          onPointerDown={(e) => e.stopPropagation()}
        />
      </label>
      <Tooltip
        tip={
          aspectLocked
            ? t('editor.frameToolbar.unlockAspect')
            : t('editor.frameToolbar.lockAspect')
        }
        placement="top"
      >
        <button
          type="button"
          aria-label={
            aspectLocked
              ? t('editor.frameToolbar.unlockAspect')
              : t('editor.frameToolbar.lockAspect')
          }
          aria-pressed={aspectLocked}
          disabled={canvasLocked}
          className={cn(
            'inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-[var(--muted)] transition-colors hover:bg-[var(--accent-soft)] hover:text-[var(--ink)]',
            aspectLocked && 'bg-[var(--accent-soft)] text-[var(--ink)]',
            canvasLocked && 'pointer-events-none opacity-50'
          )}
          onClick={() => {
            if (canvasLocked) return;
            patch({ lockAspect: !aspectLocked });
          }}
        >
          {aspectLocked ? (
            <Icon name="editor-link" width={14} height={14} />
          ) : (
            <Icon name="editor-unlink" width={14} height={14} />
          )}
        </button>
      </Tooltip>
      <label className={cn(field, canvasLocked && 'opacity-50')}>
        <span className="text-[var(--muted)]">H</span>
        <input
          className={SEL_SIZE_INPUT}
          value={Math.round(frame.height)}
          disabled={canvasLocked}
          onChange={(e) => setSize('h', e.target.value)}
          onPointerDown={(e) => e.stopPropagation()}
        />
      </label>

      <Tooltip
        tip={
          canvasLocked
            ? t('editor.frameToolbar.unlockCanvas')
            : t('editor.frameToolbar.lockCanvas')
        }
        placement="top"
      >
        <button
          type="button"
          aria-label={
            canvasLocked
              ? t('editor.frameToolbar.unlockCanvas')
              : t('editor.frameToolbar.lockCanvas')
          }
          aria-pressed={canvasLocked}
          className={cn(SEL_ICON_BTN, canvasLocked && 'bg-[var(--accent-soft)]')}
          onClick={() => patch({ locked: !canvasLocked })}
        >
          {canvasLocked ? (
            <HiOutlineLockClosed className="h-3.5 w-3.5" />
          ) : (
            <HiOutlineLockOpen className="h-3.5 w-3.5" />
          )}
        </button>
      </Tooltip>

      <Tooltip
        tip={clipContent ? t('editor.showOverflow') : t('editor.clipOverflow')}
        placement="top"
      >
        <button
          type="button"
          aria-label={clipContent ? t('editor.showOverflow') : t('editor.clipOverflow')}
          aria-pressed={clipContent}
          className={cn(SEL_ICON_BTN, clipContent && 'bg-[var(--accent-soft)]')}
          onClick={() => patch({ clipContent: !clipContent })}
        >
          {clipContent ? (
            <HiOutlineEyeSlash className="h-3.5 w-3.5" strokeWidth={1.75} />
          ) : (
            <HiOutlineEye className="h-3.5 w-3.5" strokeWidth={1.75} />
          )}
        </button>
      </Tooltip>

      <ExportSelectionPopover
        crop={{
          x: frame.x,
          y: frame.y,
          width: frame.width,
          height: frame.height,
          backgroundColor: frame.backgroundColor,
        }}
        baseName={frame.name || 'Frame'}
      />
    </SelectionToolbarShell>
  );
}

export default memo(FrameContextToolbar);
