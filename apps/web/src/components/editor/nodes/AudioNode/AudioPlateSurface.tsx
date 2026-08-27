/**
 * Shared audio plate — outer gen-empty + inner wave track + transport.
 * Canvas nodes + asset cards.
 */
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
  type RefObject,
} from 'react';
import { HiOutlinePause, HiOutlinePlay } from 'react-icons/hi2';
import { resolveGenPlateFill } from '@/components/rcb/scene/document/nodeFactories';
import { cn } from '@/utils/classnames';
import AudioWaveform, { type AudioWaveformHandle } from './AudioWaveform';

/** mm:ss clock for audio plates (canvas + asset cards). */
export function formatAudioClock(seconds: number, opts?: { round?: boolean }): string {
  const raw = Math.max(0, Number(seconds) || 0);
  if (raw > 0 && raw < 1) {
    return `00:00.${Math.max(1, Math.round(raw * 10))}`;
  }
  const s = opts?.round ? Math.round(raw) : Math.floor(raw + 1e-6);
  const m = Math.floor(s / 60);
  return `${String(m).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
}

type WaveColors = { wave: string; progress: string; cursor: string };

const WAVE_LIGHT: WaveColors = { wave: '#b0b7c3', progress: '#3d4654', cursor: '#5b8def' };
const WAVE_DARK: WaveColors = { wave: '#4a4a4a', progress: '#ececec', cursor: '#ff7a7a' };

function readWaveColors(): WaveColors {
  if (typeof document === 'undefined') return WAVE_LIGHT;
  return document.documentElement.getAttribute('data-theme') === 'dark' ? WAVE_DARK : WAVE_LIGHT;
}

function useWaveColors(): WaveColors {
  const [colors, setColors] = useState(readWaveColors);
  useEffect(() => {
    const sync = () => setColors(readWaveColors());
    sync();
    const obs = new MutationObserver(sync);
    obs.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['data-theme', 'class'],
    });
    return () => obs.disconnect();
  }, []);
  return colors;
}

/** `compact` = asset card; `node` = canvas plate. */
export type AudioPlateDensity = 'compact' | 'node';

/** Canvas node chrome — shell pad is screen-px (counter-scaled to scene 15px). */
function nodeChrome(boxH: number, zoom: number) {
  const h = Math.max(1, boxH);
  const z = Math.max(0.001, zoom);
  return {
    shell: {
      padding: 20 * z,
      gap: h * 0.015,
      borderRadius: 16 * z,
    } satisfies CSSProperties,
    track: {
      borderRadius: 12 * z,
      paddingLeft: h * 0.02,
      paddingRight: h * 0.02,
    } satisfies CSSProperties,
    transport: { height: h * 0.1 } satisfies CSSProperties,
    time: { fontSize: h * 0.032 } satisfies CSSProperties,
    button: { width: h * 0.09, height: h * 0.09 } satisfies CSSProperties,
    icon: h * 0.045,
  };
}

export type AudioPlateSurfaceProps = {
  playSrc: string;
  knownDuration?: number;
  plateFill?: string;
  density?: AudioPlateDensity;
  className?: string;
  /**
   * Counter-scaled screen height of the canvas plate (`layoutH * zoom`).
   * When set with density=node, chrome sizes are % of this — zoom/resize shrinks as a whole.
   */
  boxHeight?: number;
  /** Canvas zoom — with boxHeight, shell pad maps to fixed scene px. */
  zoom?: number;
  /** Asset cards — clock only; play lives in card hover chrome. */
  hideTransportPlayButton?: boolean;
  disabled?: boolean;
  playing?: boolean;
  ready?: boolean;
  currentTime?: number;
  duration?: number;
  onPlayingChange?: (playing: boolean) => void;
  onReady?: (duration: number) => void;
  onTimeUpdate?: (time: number) => void;
  onFinish?: () => void;
  waveformRef?: RefObject<AudioWaveformHandle | null>;
  onTogglePlay?: () => void;
  timeLabel?: string;
};

function readKnownDuration(value: unknown): number {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

export function AudioPlateSurface({
  playSrc,
  knownDuration,
  plateFill = resolveGenPlateFill(undefined),
  density = 'compact',
  className,
  boxHeight,
  zoom,
  hideTransportPlayButton = false,
  disabled = false,
  playing: playingProp,
  ready: readyProp,
  currentTime: currentProp,
  duration: durationProp,
  onPlayingChange,
  onReady,
  onTimeUpdate,
  onFinish,
  waveformRef: waveformRefProp,
  onTogglePlay,
  timeLabel: timeLabelProp,
}: AudioPlateSurfaceProps): ReactNode {
  const waveColors = useWaveColors();
  const internalWaveRef = useRef<AudioWaveformHandle | null>(null);
  const waveRef = waveformRefProp ?? internalWaveRef;
  const scaled = density === 'node' && boxHeight != null && boxHeight > 0;
  const chrome = scaled ? nodeChrome(boxHeight, zoom ?? 1) : null;

  const [internalPlaying, setInternalPlaying] = useState(false);
  const [internalReady, setInternalReady] = useState(false);
  const [internalCurrent, setInternalCurrent] = useState(0);
  const [internalDuration, setInternalDuration] = useState(() =>
    readKnownDuration(knownDuration)
  );

  const playing = playingProp ?? internalPlaying;
  const ready = readyProp ?? internalReady;
  const current = currentProp ?? internalCurrent;
  const duration = durationProp ?? internalDuration;

  useEffect(() => {
    setInternalReady(false);
    setInternalPlaying(false);
    setInternalCurrent(0);
    setInternalDuration(readKnownDuration(knownDuration));
  }, [playSrc, knownDuration]);

  const setPlaying = useCallback(
    (next: boolean) => {
      if (playingProp === undefined) setInternalPlaying(next);
      onPlayingChange?.(next);
    },
    [onPlayingChange, playingProp]
  );

  const handleReady = useCallback(
    (d: number) => {
      const next = readKnownDuration(d) || readKnownDuration(knownDuration);
      if (next > 0) setInternalDuration(next);
      setInternalReady(true);
      onReady?.(next);
    },
    [knownDuration, onReady]
  );

  const handleTimeUpdate = useCallback(
    (time: number) => {
      if (currentProp === undefined) setInternalCurrent(time);
      onTimeUpdate?.(time);
    },
    [currentProp, onTimeUpdate]
  );

  const defaultTogglePlay = useCallback(() => {
    const wave = waveRef.current;
    if (!wave || !ready || !playSrc) return;
    if (!wave.isPaused()) {
      wave.pause();
      return;
    }
    const liveDur = Math.max(duration, wave.getDuration() || 0);
    if (liveDur > 0 && wave.getCurrentTime() >= liveDur - 0.05) {
      wave.seekTo(0);
    }
    void wave.play().catch(() => setPlaying(false));
  }, [duration, playSrc, ready, setPlaying, waveRef]);

  const togglePlay = onTogglePlay ?? defaultTogglePlay;
  const liveDuration = Math.max(duration, waveRef.current?.getDuration() || 0);
  const timeLabel =
    timeLabelProp ??
    `${formatAudioClock(current)} / ${formatAudioClock(liveDuration, { round: true })}`;

  const iconPx = chrome?.icon;

  return (
    <div
      className={cn(
        'flex h-full w-full min-h-0 flex-col overflow-hidden text-[var(--ink)]',
        !chrome && 'gap-1 px-2 pt-2 pb-1',
        className
      )}
      style={{
        background: plateFill,
        boxShadow: 'inset 0 0 0 1px var(--line)',
        ...(chrome?.shell ?? null),
      }}
    >
      <div
        className={cn(
          'relative min-h-0 flex-1 overflow-hidden bg-[var(--audio-wave-track)]',
          !chrome && 'rounded-lg px-1.5'
        )}
        style={chrome?.track}
      >
        {playSrc ? (
          <AudioWaveform
            ref={waveRef}
            url={playSrc}
            waveColor={waveColors.wave}
            progressColor={waveColors.progress}
            cursorColor={waveColors.cursor}
            barWidth={3}
            barGap={2}
            barRadius={2}
            interact={false}
            className="absolute inset-0 h-full w-full"
            onReady={handleReady}
            onPlay={() => setPlaying(true)}
            onPause={() => setPlaying(false)}
            onTimeUpdate={handleTimeUpdate}
            onFinish={() => {
              setPlaying(false);
              onFinish?.();
            }}
          />
        ) : (
          <div className="h-full w-full animate-pulse rounded-md bg-[var(--line)]/30" />
        )}
      </div>

      <div
        data-audio-playback-bar
        className={cn(
          'relative flex w-full shrink-0 items-center',
          hideTransportPlayButton && 'justify-start',
          !chrome && 'h-auto min-h-0 py-0.5'
        )}
        style={chrome?.transport}
      >
        <span
          className={cn(
            'min-w-0 truncate tabular-nums text-[var(--muted)]',
            !chrome && 'text-[9px] leading-none'
          )}
          style={chrome?.time}
        >
          {timeLabel}
        </span>
        {hideTransportPlayButton ? null : (
          <button
            type="button"
            disabled={disabled || !ready || !playSrc}
            className={cn(
              'pointer-events-auto absolute left-1/2 inline-flex shrink-0 -translate-x-1/2 items-center justify-center rounded-full bg-[var(--surface)] text-[var(--ink)] shadow-sm ring-1 ring-[var(--line)] transition hover:bg-[var(--canvas)] disabled:opacity-40',
              !chrome && 'h-7 w-7'
            )}
            style={chrome?.button}
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              e.nativeEvent.stopImmediatePropagation?.();
              togglePlay();
            }}
            onPointerDown={(e) => {
              e.stopPropagation();
              e.nativeEvent.stopImmediatePropagation?.();
            }}
            aria-label={playing ? 'Pause' : 'Play'}
          >
            {playing ? (
              <HiOutlinePause
                className={cn(!chrome && 'h-3.5 w-3.5')}
                style={iconPx != null ? { width: iconPx, height: iconPx } : undefined}
                strokeWidth={2}
              />
            ) : (
              <HiOutlinePlay
                className={cn(!chrome && 'h-3.5 w-3.5', 'translate-x-[1px]')}
                style={iconPx != null ? { width: iconPx, height: iconPx } : undefined}
                strokeWidth={2}
              />
            )}
          </button>
        )}
      </div>
    </div>
  );
}
