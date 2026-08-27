/**
 * wavesurfer.js wrapper for audio-node plates.
 * Height is measured from the host box — avoids canvas taller than the node.
 */
import {
  forwardRef,
  memo,
  useEffect,
  useImperativeHandle,
  useRef,
  type ReactNode,
} from 'react';
import WaveSurfer from 'wavesurfer.js';
import { cn } from '@/utils/classnames';

/** Amplitude scale inside the track so bars never kiss the clip edge. */
const DEFAULT_BAR_HEIGHT = 0.78;

export type AudioWaveformHandle = {
  play: () => Promise<void>;
  pause: () => void;
  isPaused: () => boolean;
  seekTo: (time: number) => void;
  getCurrentTime: () => number;
  getDuration: () => number;
  setPlaybackRate: (rate: number) => void;
  getMedia: () => HTMLMediaElement | null;
  getInstance: () => WaveSurfer | null;
};

function readGlobalMaxPeak(ws: WaveSurfer): number | undefined {
  try {
    const buffer = ws.getDecodedData?.();
    const channel = buffer?.getChannelData?.(0);
    if (!channel?.length) return undefined;
    let max = 0;
    for (let i = 0; i < channel.length; i++) {
      max = Math.max(max, Math.abs(channel[i] ?? 0));
    }
    return max > 0 ? max : undefined;
  } catch {
    return undefined;
  }
}

export type AudioWaveformProps = {
  /** Playable URL (blob: / data: / https). Empty → idle placeholder. */
  url: string;
  waveColor?: string;
  progressColor?: string;
  cursorColor?: string;
  /** Bar width in px; 0 = continuous wave. */
  barWidth?: number;
  barGap?: number;
  barRadius?: number;
  /** Vertical amplitude scale (0–1); lower leaves padding inside the track. */
  barHeight?: number;
  /** Allow click-to-seek on the waveform. */
  interact?: boolean;
  className?: string;
  onReady?: (duration: number) => void;
  onPlay?: () => void;
  onPause?: () => void;
  onTimeUpdate?: (time: number) => void;
  onSeek?: (time: number) => void;
  onFinish?: () => void;
};

function AudioWaveformInner(
  {
    url,
    waveColor = '#c8c8c8',
    progressColor = '#8a8a8a',
    cursorColor = '#141414',
    barWidth = 3,
    barGap = 2,
    barRadius = 2,
    barHeight = DEFAULT_BAR_HEIGHT,
    interact = false,
    className,
    onReady,
    onPlay,
    onPause,
    onTimeUpdate,
    onSeek,
    onFinish,
  }: AudioWaveformProps,
  ref: React.ForwardedRef<AudioWaveformHandle>
): ReactNode {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const wsRef = useRef<WaveSurfer | null>(null);
  const readyUrlRef = useRef('');
  const maxPeakRef = useRef<number | undefined>(undefined);
  const cbRef = useRef({
    onReady,
    onPlay,
    onPause,
    onTimeUpdate,
    onSeek,
    onFinish,
  });
  cbRef.current = {
    onReady,
    onPlay,
    onPause,
    onTimeUpdate,
    onSeek,
    onFinish,
  };

  useImperativeHandle(
    ref,
    () => ({
      play: async () => {
        const ws = wsRef.current;
        if (!ws) return;
        await ws.play();
      },
      pause: () => wsRef.current?.pause(),
      isPaused: () => {
        const ws = wsRef.current;
        if (!ws) return true;
        return !ws.isPlaying();
      },
      seekTo: (time: number) => {
        const ws = wsRef.current;
        if (!ws || !Number.isFinite(time)) return;
        const d = ws.getDuration();
        if (!(d > 0)) return;
        const t = Math.max(0, Math.min(time, d));
        ws.setTime(t);
      },
      getCurrentTime: () => Number(wsRef.current?.getCurrentTime()) || 0,
      getDuration: () => Number(wsRef.current?.getDuration()) || 0,
      setPlaybackRate: (rate: number) => {
        const ws = wsRef.current;
        if (!ws || !Number.isFinite(rate) || rate <= 0) return;
        try {
          ws.setOptions({ audioRate: rate });
        } catch {
          const media = ws.getMediaElement?.();
          if (media) media.playbackRate = rate;
        }
      },
      getMedia: () => wsRef.current?.getMediaElement?.() || null,
      getInstance: () => wsRef.current,
    }),
    []
  );

  useEffect(() => {
    const host = hostRef.current;
    const src = String(url || '').trim();
    if (!host || !src) {
      wsRef.current?.destroy();
      wsRef.current = null;
      readyUrlRef.current = '';
      maxPeakRef.current = undefined;
      return undefined;
    }

    let cancelled = false;
    const initialH = Math.max(1, Math.floor(host.clientHeight) || 48);
    const ws = WaveSurfer.create({
      container: host,
      height: initialH,
      waveColor,
      progressColor,
      cursorColor,
      cursorWidth: 1.5,
      barWidth,
      barGap,
      barRadius,
      barHeight,
      interact,
      dragToSeek: interact,
      normalize: true,
      fillParent: true,
      backend: 'MediaElement',
      mediaControls: false,
    });
    wsRef.current = ws;

    const syncHeight = () => {
      if (cancelled || !wsRef.current) return;
      const h = Math.max(1, Math.floor(host.clientHeight));
      try {
        ws.setOptions({ height: h });
      } catch {
        /* ignore mid-destroy */
      }
    };

    const ro = new ResizeObserver(syncHeight);

    const unsubs = [
      ws.on('ready', (duration) => {
        if (cancelled) return;
        readyUrlRef.current = src;
        syncHeight();
        const maxPeak = readGlobalMaxPeak(ws);
        if (maxPeak) {
          maxPeakRef.current = maxPeak;
          try {
            ws.setOptions({ maxPeak });
          } catch {
            /* ignore mid-destroy */
          }
        }
        cbRef.current.onReady?.(Number(duration) || ws.getDuration() || 0);
      }),
      ws.on('play', () => {
        if (!cancelled) cbRef.current.onPlay?.();
      }),
      ws.on('pause', () => {
        if (!cancelled) cbRef.current.onPause?.();
      }),
      ws.on('timeupdate', (time) => {
        if (!cancelled) cbRef.current.onTimeUpdate?.(Number(time) || 0);
      }),
      ws.on('interaction', (time) => {
        if (!cancelled) cbRef.current.onSeek?.(Number(time) || 0);
      }),
      ws.on('finish', () => {
        if (!cancelled) cbRef.current.onFinish?.();
      }),
    ];

    ro.observe(host);
    void ws.load(src).catch((err) => {
      if (!cancelled) console.warn('[AudioWaveform] load failed', err);
    });

    return () => {
      cancelled = true;
      ro.disconnect();
      unsubs.forEach((off) => {
        try {
          off();
        } catch {
          /* ignore */
        }
      });
      try {
        ws.destroy();
      } catch {
        /* ignore */
      }
      if (wsRef.current === ws) wsRef.current = null;
      readyUrlRef.current = '';
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [url, interact]);

  useEffect(() => {
    const ws = wsRef.current;
    if (!ws || readyUrlRef.current !== String(url || '').trim()) return;
    try {
      ws.setOptions({
        waveColor,
        progressColor,
        cursorColor,
        barWidth,
        barGap,
        barRadius,
        barHeight,
      });
    } catch {
      /* ignore mid-destroy */
    }
  }, [url, waveColor, progressColor, cursorColor, barWidth, barGap, barRadius, barHeight]);

  return (
    <div
      ref={hostRef}
      className={cn(
        'h-full w-full min-h-0 overflow-hidden [clip-path:inset(0)] [&_canvas]:!max-h-full [&_canvas]:!max-w-full',
        className
      )}
      data-audio-waveform
    />
  );
}

const AudioWaveform = memo(forwardRef(AudioWaveformInner));
export default AudioWaveform;
