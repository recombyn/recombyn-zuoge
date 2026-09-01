import { useEffect, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { HiOutlineArrowsRightLeft } from 'react-icons/hi2';
import { ColorPanelPopover } from '@/components/base/colorPanel';
import Slider from '@/components/base/slider';
import Switch from '@/components/base/switch';
import {
  getGpuDepthOfFieldParams,
  isGpuDofEnvEnabled,
  setGpuDepthOfFieldParams,
  subscribeGpuDepthOfField,
} from '@/components/rcb/render/gpuDepthOfField';

type EffectPatch = Record<string, string | number | boolean>;

type Props = {
  attrs: Record<string, unknown> | undefined;
  onChange: (attrs: EffectPatch) => void;
};

function enabled(attrs: Record<string, unknown> | undefined, key: string) {
  const value = attrs?.[key];
  return value === true || value === 'true' || value === 1 || value === '1';
}

function numberValue(attrs: Record<string, unknown> | undefined, key: string, fallback: number) {
  const value = Number(attrs?.[key]);
  return Number.isFinite(value) ? value : fallback;
}

function NumberField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: number;
  onChange: (value: number) => void;
}) {
  return (
    <label className="grid min-w-0 grid-cols-[14px_1fr] items-center gap-1.5">
      <span className="text-[10px] text-[var(--muted)]">{label}</span>
      <input
        type="number"
        value={Number.isFinite(value) ? value : 0}
        onChange={(event) => onChange(Number(event.target.value) || 0)}
        className="h-6 min-w-0 border-0 border-b border-[var(--line)] bg-transparent px-0 text-right text-[11px] tabular-nums text-[var(--ink)] outline-none focus:border-[var(--ink)] focus:ring-0"
      />
    </label>
  );
}

function ShadowSection({
  title,
  prefix,
  attrs,
  onChange,
}: {
  title: string;
  prefix: 'shadow-' | 'inner-shadow-';
  attrs: Record<string, unknown> | undefined;
  onChange: (attrs: EffectPatch) => void;
}) {
  const enabledKey = `${prefix}enabled`;
  const visibleKey = `${prefix}visible`;
  const colorKey = `${prefix}color`;
  const xKey = `${prefix}x`;
  const yKey = `${prefix}y`;
  const blurKey = `${prefix}blur`;
  const isEnabled = enabled(attrs, enabledKey);
  const color = String(attrs?.[colorKey] || 'rgba(0,0,0,0.25)');

  return (
    <section className="border-b border-[var(--line)] px-2 py-2 last:border-b-0">
      <div className="grid h-8 grid-cols-[20px_minmax(0,1fr)_28px] items-center gap-2">
        <ColorPanelPopover
          value={color}
          showAlpha
          title={`${title}颜色`}
          onChange={(next) => onChange({ [colorKey]: next })}
          className="h-5 w-5 p-0"
          triggerClassName="h-4 w-4 rounded-[3px]"
        />
        <span className="min-w-0 text-[12px] leading-4 text-[var(--ink)]">{title}</span>
        <Switch
          checked={isEnabled}
          onChange={(next) => onChange({ [enabledKey]: next, [visibleKey]: next })}
          className="h-4 w-7 justify-self-end p-[2px] [&>span]:h-3 [&>span]:w-3"
        />
      </div>
      {isEnabled ? (
        <div className="mt-2 grid grid-cols-3 gap-3">
          <NumberField
            label="X"
            value={numberValue(attrs, xKey, 0)}
            onChange={(value) => onChange({ [xKey]: value })}
          />
          <NumberField
            label="Y"
            value={numberValue(attrs, yKey, 2)}
            onChange={(value) => onChange({ [yKey]: value })}
          />
          <NumberField
            label="B"
            value={numberValue(attrs, blurKey, 4)}
            onChange={(value) => onChange({ [blurKey]: Math.max(0, value) })}
          />
        </div>
      ) : null}
    </section>
  );
}

/**
 * Scene-wide GPU DOF (stack-order depth). Runtime uniforms only — not node attrs.
 * Visible when `VITE_GPU_DOF=1`.
 */
function GpuDepthOfFieldSection() {
  const { t } = useTranslation();
  const [params, setParams] = useState(() => getGpuDepthOfFieldParams());
  useEffect(() => {
    return subscribeGpuDepthOfField(() => {
      setParams(getGpuDepthOfFieldParams());
    });
  }, []);

  if (!isGpuDofEnvEnabled()) return null;

  return (
    <section className="border-b border-[var(--line)] px-2 py-2">
      <div className="flex h-8 items-center justify-between gap-3">
        <span className="min-w-0 text-[12px] leading-4 text-[var(--ink)]">
          {t('editor.imageToolbar.sceneDepthOfField', { defaultValue: 'Scene depth of field' })}
        </span>
        <Switch
          checked={params.enabled}
          onChange={(next) => setGpuDepthOfFieldParams({ enabled: next })}
          className="h-4 w-7 p-[2px] [&>span]:h-3 [&>span]:w-3"
        />
      </div>
      {params.enabled ? (
        <div className="mt-2 space-y-2.5">
          <Slider
            min={0}
            max={100}
            step={1}
            value={Math.round(params.focalDepth * 100)}
            onChange={(value) => setGpuDepthOfFieldParams({ focalDepth: value / 100 })}
          />
          <div className="flex items-center justify-between text-[11px] text-[var(--muted)]">
            <span>{t('editor.imageToolbar.dofFocalPlane', { defaultValue: 'Focal plane' })}</span>
            <span className="tabular-nums text-[var(--ink)]">{Math.round(params.focalDepth * 100)}</span>
          </div>
          <Slider
            min={0}
            max={200}
            step={5}
            value={Math.round(params.aperture * 100)}
            onChange={(value) => setGpuDepthOfFieldParams({ aperture: value / 100 })}
          />
          <div className="flex items-center justify-between text-[11px] text-[var(--muted)]">
            <span>{t('editor.imageToolbar.dofAperture', { defaultValue: 'Aperture' })}</span>
            <span className="tabular-nums text-[var(--ink)]">{params.aperture.toFixed(2)}</span>
          </div>
          <Slider
            min={0}
            max={64}
            step={1}
            value={params.maxCoCPx}
            onChange={(value) => setGpuDepthOfFieldParams({ maxCoCPx: value })}
          />
          <div className="flex items-center justify-between text-[11px] text-[var(--muted)]">
            <span>{t('editor.imageToolbar.dofMaxBlur', { defaultValue: 'Max blur' })}</span>
            <span className="tabular-nums text-[var(--ink)]">{params.maxCoCPx}px</span>
          </div>
        </div>
      ) : null}
    </section>
  );
}

export function EffectsForm({ attrs, onChange }: Props) {
  const objectMode = String(attrs?.['blur-mode'] || 'backdrop') === 'object';
  const backdropEnabled = enabled(attrs, 'backdrop-blur-enabled');
  const objectEnabled = enabled(attrs, 'blur-enabled');
  const amount = numberValue(attrs, 'backdrop-blur-amount', 12);
  const objectAmount = numberValue(attrs, 'blur-amount', 12);
  const brightness = numberValue(attrs, 'backdrop-blur-brightness', 100);
  const blurEnabled = objectMode ? objectEnabled : backdropEnabled;
  const blurLabel = objectMode ? '对象模糊' : '背景模糊';
  const switchBlurMode = () => {
    const nextObjectMode = !objectMode;
    onChange({
      'blur-mode': nextObjectMode ? 'object' : 'backdrop',
      'blur-enabled': nextObjectMode,
      'backdrop-blur-enabled': !nextObjectMode,
    });
  };

  let blurSliders: ReactNode = null;
  if (blurEnabled && objectMode) {
    blurSliders = (
      <div className="mt-3 space-y-1.5">
        <Slider
          min={0}
          max={64}
          step={1}
          value={objectAmount}
          onChange={(value) => onChange({ 'blur-amount': value })}
        />
        <div className="flex items-center justify-between text-[11px] text-[var(--muted)]">
          <span>模糊</span>
          <span className="tabular-nums text-[var(--ink)]">{objectAmount}</span>
        </div>
      </div>
    );
  } else if (blurEnabled) {
    blurSliders = (
      <div className="mt-3 space-y-2.5">
        <Slider
          min={0}
          max={64}
          step={1}
          value={amount}
          onChange={(value) => onChange({ 'backdrop-blur-amount': value })}
        />
        <div className="flex items-center justify-between text-[11px] text-[var(--muted)]">
          <span>模糊</span>
          <span className="tabular-nums text-[var(--ink)]">{amount}</span>
        </div>
        <Slider
          min={0}
          max={200}
          step={1}
          value={brightness}
          onChange={(value) => onChange({ 'backdrop-blur-brightness': value })}
        />
        <div className="flex items-center justify-between text-[11px] text-[var(--muted)]">
          <span>亮度</span>
          <span className="tabular-nums text-[var(--ink)]">{brightness}%</span>
        </div>
      </div>
    );
  }

  return (
    <>
      <GpuDepthOfFieldSection />
      <ShadowSection title="内阴影" prefix="inner-shadow-" attrs={attrs} onChange={onChange} />
      <ShadowSection title="投影" prefix="shadow-" attrs={attrs} onChange={onChange} />
      <section className="px-2 py-2 last:border-b-0">
        <div className="flex h-8 items-center justify-between gap-3">
          <button
            type="button"
            aria-label={`切换为${objectMode ? '背景模糊' : '对象模糊'}`}
            className="inline-flex min-w-0 items-center gap-1.5 text-left text-[12px] text-[var(--ink)] hover:text-[var(--accent)]"
            onClick={switchBlurMode}
            title="切换模糊类型"
          >
            <HiOutlineArrowsRightLeft className="h-3.5 w-3.5 shrink-0 text-[var(--muted)]" aria-hidden />
            {blurLabel}
          </button>
          <Switch
            checked={blurEnabled}
            onChange={(next) =>
              onChange({
                [objectMode ? 'blur-enabled' : 'backdrop-blur-enabled']: next,
              })
            }
            className="h-4 w-7 p-[2px] [&>span]:h-3 [&>span]:w-3"
          />
        </div>
        {blurSliders}
      </section>
    </>
  );
}
