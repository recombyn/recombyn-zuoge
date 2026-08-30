import { memo } from 'react';
import { HiOutlineArrowPath } from 'react-icons/hi2';
import { useTranslation } from 'react-i18next';
import Slider from '@/components/base/slider';
import {
  PUPPET_DENSITY_MAX,
  PUPPET_DENSITY_MIN,
} from '@/components/editor/nodes/ImageNode/puppet/puppetModel';
import ImageToolPanelShell, { PanelIconBtn } from './ImageToolPanelShell';

function PuppetToolPanel({
  density,
  keyframeCount,
  timelineOpen,
  onDensityChange,
  onReset,
  onClose,
}: {
  density: number;
  keyframeCount: number;
  timelineOpen: boolean;
  onDensityChange: (v: number) => void;
  onReset: () => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const safe = Math.max(
    PUPPET_DENSITY_MIN,
    Math.min(PUPPET_DENSITY_MAX, Math.round(density))
  );
  return (
    <ImageToolPanelShell
      title={t('editor.imageToolbar.puppet', { defaultValue: '人偶' })}
      width={240}
      onClose={onClose}
      headerRight={
        <PanelIconBtn
          title={t('editor.imageToolbar.reset', { defaultValue: '重置' })}
          onClick={onReset}
        >
          <HiOutlineArrowPath className="h-4 w-4" />
        </PanelIconBtn>
      }
    >
      <div className="flex flex-col items-stretch gap-2 pb-0.5 pt-0">
        <div className="flex items-center justify-between gap-2 text-[11px] text-[var(--ink)]">
          <span>
            {t('editor.imageToolbar.puppetDensity', { defaultValue: '网格密度' })}
          </span>
          <span className="tabular-nums text-[var(--ink-soft)]">{safe}</span>
        </div>
        <Slider
          min={PUPPET_DENSITY_MIN}
          max={PUPPET_DENSITY_MAX}
          step={1}
          value={safe}
          onChange={onDensityChange}
          trackHeight={6}
          thumbWidth={16}
          thumbHeight={16}
        />
        <p className="text-[10px] leading-snug text-[var(--ink-soft)]">
          {timelineOpen
            ? keyframeCount > 0
              ? t('editor.imageToolbar.puppetKfCount', {
                  defaultValue: '时间轴「人偶」· {{count}} 个关键帧',
                  count: keyframeCount,
                })
              : t('editor.imageToolbar.puppetKfHint', {
                  defaultValue: '拖钉点写入当前帧；换时间再拖即可做动画',
                })
            : t('editor.imageToolbar.puppetOpenTimeline', {
                defaultValue: '打开关键帧时间轴后，拖钉点可写入动画',
              })}
        </p>
      </div>
    </ImageToolPanelShell>
  );
}

export default memo(PuppetToolPanel);
