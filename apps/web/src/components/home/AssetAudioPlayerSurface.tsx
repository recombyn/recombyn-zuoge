/**
 * Audio asset inline player — same plate as canvas; white hover play like video cards.
 */
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import type { AudioWaveformHandle } from '@/components/editor/nodes/AudioNode/AudioWaveform';
import { AudioPlateSurface } from '@/components/editor/nodes/AudioNode/AudioPlateSurface';
import { usePlayableAudioSrc } from '@/components/editor/nodes/AudioNode/AudioNodeOverlay';
import type { UserAsset } from '@/models/assets';
import { cn } from '@/utils/classnames';
import { AssetCardHoverMediaButton } from '@/components/home/assetCardMediaChrome';

function assetDurationSeconds(asset: UserAsset): number | undefined {
  const fromMeta = Number((asset.meta as { duration?: unknown } | null)?.duration);
  return Number.isFinite(fromMeta) && fromMeta > 0 ? fromMeta : undefined;
}

function useAssetAudioPlate(asset: UserAsset) {
  const url = String(asset.url || '').trim();
  const uploadKey = String(asset.objectKey || '').trim() || undefined;
  const playSrc = usePlayableAudioSrc(url, uploadKey);
  const waveRef = useRef<AudioWaveformHandle | null>(null);
  return { playSrc, waveRef, knownDuration: assetDurationSeconds(asset) };
}

export function AssetAudioIdleThumb({ asset }: { asset: UserAsset }): ReactNode {
  const { playSrc, waveRef, knownDuration } = useAssetAudioPlate(asset);
  return (
    <span className="pointer-events-none relative block h-full w-full overflow-hidden">
      <AudioPlateSurface
        playSrc={playSrc}
        density="compact"
        hideTransportPlayButton
        waveformRef={waveRef}
        knownDuration={knownDuration}
      />
    </span>
  );
}

export type AudioAssetCardMediaProps = {
  asset: UserAsset;
  active: boolean;
  onActiveChange: (active: boolean) => void;
  className?: string;
};

export function AudioAssetCardMedia({
  asset,
  active,
  onActiveChange,
  className,
}: AudioAssetCardMediaProps): ReactNode {
  const { t } = useTranslation();
  const { playSrc, waveRef, knownDuration } = useAssetAudioPlate(asset);
  const [playing, setPlaying] = useState(false);

  useEffect(() => {
    if (!active) {
      waveRef.current?.pause();
      setPlaying(false);
    }
  }, [active, waveRef]);

  useEffect(() => {
    if (!active || !playSrc) return;
    const timer = window.setTimeout(() => {
      void waveRef.current?.play();
    }, 60);
    return () => window.clearTimeout(timer);
  }, [active, playSrc, waveRef]);

  return (
    <div
      className={cn('absolute inset-0 overflow-hidden', className)}
      data-asset-audio-inline-player={active || undefined}
    >
      <AudioPlateSurface
        playSrc={playSrc}
        density="compact"
        hideTransportPlayButton
        waveformRef={waveRef}
        knownDuration={knownDuration}
        playing={active ? playing : false}
        onPlayingChange={setPlaying}
      />
      <AssetCardHoverMediaButton
        showPause={active && playing}
        playLabel={t('agent.previewPlay', { defaultValue: '播放' })}
        pauseLabel={t('agent.previewPause', { defaultValue: '暂停' })}
        onToggle={() => {
          if (!active) {
            onActiveChange(true);
            return;
          }
          const wave = waveRef.current;
          if (!wave) return;
          if (wave.isPaused()) void wave.play();
          else wave.pause();
        }}
      />
    </div>
  );
}

export { AudioAssetCardMedia as AssetAudioPlayerSurface };
