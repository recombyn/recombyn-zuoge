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
import { useRcbCamera } from '@/components/rcb';
import {
  isAudioNode,
  isNodeOverlayHidden,
} from '@/components/rcb/scene/document/nodeCapabilities';
import {
  resolveGenPlateFill
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
  isOurStoredImageUrl,
  resolveUploadObjectKey,
} from '@/utils/uploadImage';
import type { AudioWaveformHandle } from './AudioWaveform';
import { AudioPlateSurface, formatAudioClock } from './AudioPlateSurface';

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

export function getAudioHost(nodeId: string): AudioHostApi | null {
  return audioHosts.get(String(nodeId)) || null;
}

function clampSpeed(value: unknown): number {
  const n = Number(value);
  if (!Number.isFinite(n)) return 1;
  return Math.max(0.1, Math.min(4, n));
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

    const key = String(uploadKey || '').trim() || resolveUploadObjectKey(s);
    const needsAuthBlob = Boolean(key) || isOurStoredImageUrl(s);

    // Public https (e.g. dev fixtures) — load directly; blob proxy is unnecessary.
    if (!needsAuthBlob) {
      setPlayable(s);
      return undefined;
    }

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
        if (!cancelled) setPlayable(s);
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

export { usePlayableAudioSrc };

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
  // Counter-scale like video: WaveSurfer lays out at screen px, FO shows scene size.
  const layoutW = Math.max(1, scenePlate.width);
  const layoutH = Math.max(1, scenePlate.height);

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
        borderRadius: scenePlate.borderRadius,
      }}
      aria-hidden={hidden || undefined}
    >
      {/*
        Counter-scale like video: WaveSurfer at screen px, then scale(1/z) back.
        Plate chrome uses cqh so zoom/resize shrinks the whole UI — no fixed-px crush.
      */}
      <div
        className="pointer-events-none absolute left-0 top-0 overflow-hidden"
        style={{
          width: layoutW * z,
          height: layoutH * z,
          transform: `scale(${1 / z})`,
          transformOrigin: '0 0',
        }}
      >
        <AudioPlateSurface
          playSrc={playSrc}
          knownDuration={knownDuration}
          plateFill={plateFill}
          density="node"
          boxHeight={layoutH * z}
          zoom={z}
          className="pointer-events-none absolute inset-0 h-full w-full"
          playing={playing}
          ready={ready}
          currentTime={current}
          duration={duration}
          onPlayingChange={setPlaying}
          onReady={onWaveReady}
          onTimeUpdate={clampIntoWindow}
          onFinish={resetToWindowStart}
          waveformRef={waveRef}
          onTogglePlay={togglePlay}
          timeLabel={`${formatAudioClock(wallPos)} / ${formatAudioClock(wallLen, { round: true })}`}
        />
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
      plateFill={resolveGenPlateFill(node.attrs?.['fill-color'])}
      hidden={isNodeOverlayHidden(document, node, hidden)}
      trimStart={readOptionalNumber(node.attrs?.trimStart)}
      trimEnd={readOptionalNumber(node.attrs?.trimEnd)}
      knownDuration={readOptionalNumber(node.attrs?.duration)}
      speed={clampSpeed(node.attrs?.audioSpeed)}
    />
  );
}

export default memo(AudioNodeOverlay);
