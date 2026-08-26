import type { SceneDocument, SceneNode } from '@/components/rcb/sceneNode';
/**
 * HTML audio plates over SVG hit-targets (same lattice as Video/Lottie overlays).
 * Title lives on selection chrome only — plate shows waveform + transport.
 * Stays visible during move/resize (geometryOverrides) — SVG underlay has no real poster.
 */
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
  memo,
} from 'react';
import { createPortal } from 'react-dom';
import { HiOutlinePlay, HiOutlinePause } from 'react-icons/hi2';
import { useRcbCamera } from '@/components/rcb';
import {
  isAudioNode,
  isNodeOverlayHidden,
} from '@/components/rcb/scene/document/nodeCapabilities';
import {
  resolveThemeSurfaceFill
} from '@/components/rcb/scene/document/nodeFactories';
import {
  buildScenePlateStyle,
  readOptionalNumber,
  type MediaGeomOverride,
} from '@/components/editor/nodes/shared/mediaPlateGeometry';
import { useHtmlMediaMount } from '@/components/editor/nodes/useHtmlMediaMount';
import {
  toDisplayMediaUrl,
  resolvePlayableMediaBlobUrl,
} from '@/utils/uploadImage';
import AudioWaveform, { type AudioWaveformHandle } from './AudioWaveform';

export type AudioGeomOverride = MediaGeomOverride;

export type AudioHostApi = {
  getAudio: () => HTMLAudioElement | null;
  getMediaTime: () => number;
  play: () => void;
  pause: () => void;
  isPaused: () => boolean;
  setSpeed: (speed: number) => void;
  getSpeed: () => number;
  seek: (time: number) => void;
};

const audioHosts = new Map<string, AudioHostApi>();

type WaveThemeColors = { wave: string; progress: string; cursor: string };

const WAVE_COLORS_LIGHT: WaveThemeColors = {
  wave: '#c8c8c8',
  progress: '#8a8a8a',
  cursor: '#141414',
};
const WAVE_COLORS_DARK: WaveThemeColors = {
  wave: '#5c5c5c',
  progress: '#d4d4d4',
  cursor: '#ffffff',
};

/** Canvas-safe hex (WaveSurfer cannot paint CSS vars / color-mix). */
function resolveWaveThemeColors(): WaveThemeColors {
  if (typeof document === 'undefined') return WAVE_COLORS_LIGHT;
  if (document.documentElement.getAttribute('data-theme') === 'dark') {
    return WAVE_COLORS_DARK;
  }
  return WAVE_COLORS_LIGHT;
}

function useWaveThemeColors(): WaveThemeColors {
  const [colors, setColors] = useState(resolveWaveThemeColors);
  useEffect(() => {
    const sync = () => setColors(resolveWaveThemeColors());
    sync();
    const root = document.documentElement;
    const obs = new MutationObserver(sync);
    obs.observe(root, { attributes: true, attributeFilter: ['data-theme', 'class'] });
    return () => obs.disconnect();
  }, []);
  return colors;
}

export function getAudioHost(nodeId: string): AudioHostApi | null {
  return audioHosts.get(String(nodeId)) || null;
}

function clampSpeed(value: unknown): number {
  const n = Number(value);
  if (!Number.isFinite(n)) return 1;
  return Math.max(0.1, Math.min(4, n));
}

function formatClock(seconds: number, opts?: { round?: boolean }): string {
  const raw = Math.max(0, Number(seconds) || 0);
  // Sub-second wall times (e.g. 3s @ 4x ≈ 0.75s) — keep one decimal.
  if (raw > 0 && raw < 1) {
    const tenths = Math.max(1, Math.round(raw * 10));
    return `00:00.${tenths}`;
  }
  const s = opts?.round ? Math.round(raw) : Math.floor(raw + 1e-6);
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${String(m).padStart(2, '0')}:${String(r).padStart(2, '0')}`;
}

/**
 * Audio `src` → WaveSurfer-playable URL.
 * Remote COS/CDN lacks CORS for wavesurfer fetch — resolve to blob: via uploads API.
 */
function initialPlayableAudioSrc(display: string): string {
  const s = String(display || '').trim();
  if (s.startsWith('blob:') || s.startsWith('data:')) return s;
  return '';
}

function usePlayableAudioSrc(src: string, uploadKey?: string | null): string {
  const display = toDisplayMediaUrl(src, uploadKey);
  const [playable, setPlayable] = useState(() => initialPlayableAudioSrc(display));

  useEffect(() => {
    const s = String(display || '').trim();
    let cancelled = false;
    let revoke = () => {
      /* no blob yet */
    };

    if (!s) {
      setPlayable('');
      return undefined;
    }
    if (s.startsWith('blob:') || s.startsWith('data:')) {
      setPlayable(s);
      return undefined;
    }

    // Clear until auth blob is ready — avoids WaveSurfer fetch → COS CORS.
    setPlayable('');

    async function resolveBlob() {
      try {
        const resolved = await resolvePlayableMediaBlobUrl(s, {
          uploadKey,
          filename: 'audio.mp3',
          fallbackMime: 'audio/mpeg',
        });
        if (cancelled) {
          resolved.revoke();
          return;
        }
        revoke = resolved.revoke;
        setPlayable(resolved.url);
      } catch (err) {
        console.warn('[audio] resolve playable src failed', err);
        if (!cancelled) setPlayable('');
      }
    }

    resolveBlob();
    return () => {
      cancelled = true;
      revoke();
    };
  }, [display, uploadKey]);

  return playable;
}

function resolveTrimWindow(
  duration: number,
  trimStart?: number,
  trimEnd?: number
): { start: number; end: number } {
  const d = Number.isFinite(duration) && duration > 0 ? duration : 0;
  let start = 0;
  if (Number.isFinite(trimStart as number)) start = Math.max(0, Number(trimStart));

  let end = d || start + 0.1;
  if (Number.isFinite(trimEnd as number) && Number(trimEnd) > start) {
    end = Number(trimEnd);
  }

  if (d > 0) {
    start = Math.min(start, d);
    end = Math.min(end, d);
  }
  if (end - start < 0.05) end = start + 0.05;
  return { start, end };
}

function readKnownDuration(value: unknown): number {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return 0;
  return n;
}

function AudioZoomSync({ onZoom }: { onZoom: (zoom: number) => void }) {
  const zoom = useRcbCamera().zoom;
  useEffect(() => {
    onZoom(Math.max(0.05, zoom || 1));
  }, [zoom, onZoom]);
  return null;
}

function stopChromePointer(e: { stopPropagation: () => void; nativeEvent: Event }) {
  e.stopPropagation();
  (e.nativeEvent as any).stopImmediatePropagation?.();
}

function AudioPlate({
  nodeId,
  scenePlate,
  zoom,
  svgMount,
  src,
  uploadKey,
  plateFill,
  hidden,
  trimStart,
  trimEnd,
  knownDuration,
  speed,
}: {
  nodeId: string;
  scenePlate: CSSProperties & { left: number; top: number; width: number; height: number };
  zoom: number;
  svgMount: HTMLElement;
  src: string;
  uploadKey?: string | null;
  plateFill: string;
  hidden?: boolean;
  trimStart?: number;
  trimEnd?: number;
  knownDuration?: number;
  speed: number;
}) {
  const playSrc = usePlayableAudioSrc(src, uploadKey);
  const waveColors = useWaveThemeColors();
  const waveRef = useRef<AudioWaveformHandle | null>(null);
  const [playing, setPlaying] = useState(false);
  const [ready, setReady] = useState(false);
  const [current, setCurrent] = useState(0);
  const [duration, setDuration] = useState(() => readKnownDuration(knownDuration));
  const z = Math.max(0.05, zoom || 1);
  const rate = clampSpeed(speed);
  const hasTrim =
    Number.isFinite(trimStart as number) || Number.isFinite(trimEnd as number);

  const liveDuration = () =>
    Math.max(duration, waveRef.current?.getDuration() || 0);

  const mediaDuration = liveDuration();
  const win = resolveTrimWindow(mediaDuration, trimStart, trimEnd);
  const windowLen = mediaDuration > 0 ? Math.max(0.05, win.end - win.start) : 0;
  const mediaLen = hasTrim ? windowLen : mediaDuration || windowLen;
  const mediaOrigin = hasTrim && mediaDuration > 0 ? win.start : 0;
  const mediaPos = Math.max(0, current - mediaOrigin);
  const wallPos = mediaPos / rate;
  const wallLen = mediaLen > 0 ? mediaLen / rate : 0;
  const plateH = Math.max(1, scenePlate.height * z);
  const plateW = Math.max(1, scenePlate.width * z);
  // Design chrome at a reference plate size, then scale wave + time + play as one unit
  // (same idea as video playback bar fit) — transport must not steal wave height.
  const AUDIO_REF_W = 360;
  const AUDIO_REF_H = 180;
  const uiFit = Math.max(
    0.35,
    Math.min(1, plateW / AUDIO_REF_W, plateH / AUDIO_REF_H)
  );
  const layoutW = plateW / uiFit;
  const layoutH = plateH / uiFit;
  const padY = 10;
  const padX = 12;
  const transportH = 40; // mt-2 + 32px button row
  const waveHeight = Math.max(
    28,
    Math.min(140, Math.round(layoutH - padY * 2 - transportH))
  );

  useEffect(() => {
    setReady(false);
    setPlaying(false);
  }, [playSrc]);

  useEffect(() => {
    waveRef.current?.setPlaybackRate(speed);
  }, [speed]);

  useEffect(() => {
    const api: AudioHostApi = {
      getAudio: () => {
        const media = waveRef.current?.getMedia();
        if (media instanceof HTMLAudioElement) return media;
        return null;
      },
      getMediaTime: () => waveRef.current?.getCurrentTime() || 0,
      play: () => {
        async function tryPlay() {
          try {
            await waveRef.current?.play();
          } catch {
            /* ignore play rejection */
          }
        }
        tryPlay();
      },
      pause: () => waveRef.current?.pause(),
      isPaused: () => Boolean(waveRef.current?.isPaused() ?? true),
      setSpeed: (next) => waveRef.current?.setPlaybackRate(clampSpeed(next)),
      getSpeed: () => {
        const mediaRate = Number(waveRef.current?.getMedia()?.playbackRate);
        if (Number.isFinite(mediaRate) && mediaRate > 0) return mediaRate;
        return 1;
      },
      seek: (time) => waveRef.current?.seekTo(time),
    };
    audioHosts.set(nodeId, api);
    return () => {
      if (audioHosts.get(nodeId) === api) audioHosts.delete(nodeId);
    };
  }, [nodeId]);

  const resetToWindowStart = useCallback(() => {
    const d = liveDuration();
    const w = resolveTrimWindow(d, trimStart, trimEnd);
    const start = hasTrim ? w.start : 0;
    waveRef.current?.seekTo(start);
    setPlaying(false);
    setCurrent(start);
  }, [hasTrim, trimStart, trimEnd, duration]);

  const clampIntoWindow = useCallback(
    (time: number) => {
      const liveDur = liveDuration();
      // No trim → just mirror clock; never force-pause (fake 0.1s window used to kill play).
      if (!hasTrim || !(liveDur > 0.05)) {
        setCurrent(time);
        return;
      }
      const w = resolveTrimWindow(liveDur, trimStart, trimEnd);
      if (time >= w.end - 0.02) {
        waveRef.current?.pause();
        waveRef.current?.seekTo(w.start);
        setPlaying(false);
        setCurrent(w.start);
        return;
      }
      if (time < w.start - 0.01) {
        waveRef.current?.seekTo(w.start);
        setCurrent(w.start);
        return;
      }
      setCurrent(time);
    },
    [duration, hasTrim, trimStart, trimEnd]
  );

  const onWaveReady = useCallback(
    (d: number) => {
      const next = readKnownDuration(d) || readKnownDuration(knownDuration);
      if (next > 0) setDuration(next);
      setReady(true);
      waveRef.current?.setPlaybackRate(speed);
      if (!hasTrim) {
        setCurrent(0);
        return;
      }
      const w = resolveTrimWindow(next, trimStart, trimEnd);
      waveRef.current?.seekTo(w.start);
      setCurrent(w.start);
    },
    [hasTrim, knownDuration, speed, trimStart, trimEnd]
  );

  const seekBeforePlay = (wave: AudioWaveformHandle) => {
    const liveDur = Math.max(duration, wave.getDuration() || 0);
    if (!(liveDur > 0)) return;
    const t = wave.getCurrentTime();
    if (!hasTrim) {
      if (t >= liveDur - 0.05) wave.seekTo(0);
      return;
    }
    const w = resolveTrimWindow(liveDur, trimStart, trimEnd);
    if (t < w.start || t >= w.end - 0.02) wave.seekTo(w.start);
  };

  const togglePlay = () => {
    const wave = waveRef.current;
    if (!wave || !ready) return;
    if (!wave.isPaused()) {
      wave.pause();
      return;
    }
    seekBeforePlay(wave);
    async function tryPlay() {
      try {
        await wave.play();
      } catch {
        setPlaying(false);
      }
    }
    tryPlay();
  };

  return createPortal(
    <div
      data-audio-node={nodeId}
      className="pointer-events-none absolute inset-0 overflow-hidden"
      style={{
        visibility: hidden ? 'hidden' : undefined,
      }}
      aria-hidden={hidden || undefined}
    >
      <div
        className="pointer-events-none absolute left-0 top-0 overflow-hidden"
        style={{
          width: scenePlate.width * z,
          height: scenePlate.height * z,
          transform: `scale(${1 / z})`,
          transformOrigin: '0 0',
          borderRadius: scenePlate.borderRadius,
          background: plateFill,
          color: 'var(--ink)',
          boxShadow: 'inset 0 0 0 1px var(--line)',
        }}
      >
        <div
          className="pointer-events-none absolute left-0 top-0"
          style={{
            width: layoutW,
            height: layoutH,
            transform: `scale(${uiFit})`,
            transformOrigin: '0 0',
          }}
        >
          <div
            className="flex h-full w-full flex-col"
            style={{ padding: `${padY}px ${padX}px` }}
          >
            <div className="relative flex min-h-0 flex-1 items-center justify-center overflow-hidden rounded-xl bg-[var(--rail)] px-3">
              {playSrc ? (
                <div className="w-full" style={{ height: waveHeight }}>
                  <AudioWaveform
                    ref={waveRef}
                    url={playSrc}
                    height={waveHeight}
                    waveColor={waveColors.wave}
                    progressColor={waveColors.progress}
                    cursorColor={waveColors.cursor}
                    barWidth={3}
                    barGap={2}
                    barRadius={2}
                    interact={false}
                    className="h-full w-full"
                    onReady={onWaveReady}
                    onPlay={() => setPlaying(true)}
                    onPause={() => setPlaying(false)}
                    onTimeUpdate={clampIntoWindow}
                    onFinish={resetToWindowStart}
                  />
                </div>
              ) : (
                <div
                  className="w-full animate-pulse rounded-md bg-[var(--line)]/50"
                  style={{ height: waveHeight }}
                />
              )}
            </div>
            <div
              data-audio-playback-bar
              className="mt-2 grid h-8 shrink-0 grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-x-1"
              onPointerDown={stopChromePointer}
            >
              <span className="min-w-0 justify-self-start truncate text-[11px] tabular-nums text-[var(--muted)]">
                {formatClock(wallPos)}
                {' / '}
                {formatClock(wallLen, { round: true })}
              </span>
              <button
                type="button"
                disabled={!ready || !playSrc}
                className="pointer-events-auto col-start-2 inline-flex h-8 w-8 items-center justify-center justify-self-center rounded-full bg-[var(--ink)] text-[var(--on-brand)] transition hover:opacity-90 disabled:opacity-40"
                onPointerDown={(e) => {
                  e.preventDefault();
                  stopChromePointer(e);
                }}
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  togglePlay();
                }}
                aria-label={playing ? 'Pause' : 'Play'}
              >
                {playing ? (
                  <HiOutlinePause className="h-4 w-4" strokeWidth={2} />
                ) : (
                  <HiOutlinePlay className="h-4 w-4 translate-x-[1px]" strokeWidth={2} />
                )}
              </button>
              <span aria-hidden className="min-w-0" />
            </div>
          </div>
        </div>
      </div>
    </div>,
    svgMount
  );
}

/**
 * Idle = HTML waveform portaled into the SVG foreignObject mount (unified stack).
 * Stays mounted/visible during move — `geometryOverrides` tracks the chrome.
 */
function AudioNodeOverlay({
  document,
  hidden,
  geometryOverrides = null,
}: {
  document: SceneDocument;
  hidden?: boolean;
  geometryOverrides?: Record<string, AudioGeomOverride> | null;
}): ReactNode {
  const [zoom, setZoom] = useState(1);
  const onZoom = useCallback((z: number) => {
    setZoom((prev) => {
      if (Math.abs(prev - z) < 1e-6) return prev;
      return z;
    });
  }, []);
  const ids = useMemo(() => {
    const children: string[] = document?.deltaSetLike?.ROOT?.children || [];
    return children.filter((id) => {
      const node = document?.deltaSetLike?.[id];
      if (!isAudioNode(node)) return false;
      return Boolean(String(node?.attrs?.src || '').trim());
    });
  }, [document]);

  if (!ids.length) return null;

  return (
    <>
      <AudioZoomSync onZoom={onZoom} />
      {ids.map((nodeId) => (
        <AudioPlateHost
          key={nodeId}
          nodeId={nodeId}
          document={document}
          zoom={zoom}
          hidden={hidden}
          geometryOverrides={geometryOverrides}
        />
      ))}
    </>
  );
}

function AudioPlateHost({
  nodeId,
  document,
  zoom,
  hidden,
  geometryOverrides,
}: {
  nodeId: string;
  document: SceneDocument;
  zoom: number;
  hidden?: boolean;
  geometryOverrides?: Record<string, AudioGeomOverride> | null;
}) {
  const mount = useHtmlMediaMount(nodeId);
  const node = document?.deltaSetLike?.[nodeId];
  if (!node || !mount) return null;
  const src = String(node.attrs?.src || '').trim();
  if (!src) return null;
  const scenePlate = buildScenePlateStyle(document, node, geometryOverrides?.[nodeId]);
  return (
    <AudioPlate
      nodeId={nodeId}
      scenePlate={scenePlate}
      zoom={zoom}
      svgMount={mount}
      src={src}
      uploadKey={String(node.attrs?.uploadKey || '').trim() || null}
      plateFill={resolveThemeSurfaceFill(node.attrs?.['fill-color'])}
      hidden={isNodeOverlayHidden(document, node, hidden)}
      trimStart={readOptionalNumber(node.attrs?.trimStart)}
      trimEnd={readOptionalNumber(node.attrs?.trimEnd)}
      knownDuration={readOptionalNumber(node.attrs?.duration)}
      speed={clampSpeed(node.attrs?.audioSpeed)}
    />
  );
}

export default memo(AudioNodeOverlay);
