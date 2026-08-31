/**
 * Canvas Lottie timeline — fixed ruler (scroll-synced via translateX) + scrolling tracks.
 * Playhead = current time; Work Area bookends = composition ip/op.
 */
import {
  memo,
  useCallback,
  useEffect,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
  type WheelEvent as ReactWheelEvent,
} from 'react';
import {
  rulerStepForWidth,
  type LottieTimelineLayer,
} from '@/components/editor/nodes/AnimationNode/animationTimelineModel';

export type LottieTimelineFlatRow =
  | { kind: 'layer'; layer: LottieTimelineLayer; expanded: boolean }
  | {
      kind: 'prop';
      layer: LottieTimelineLayer;
      propId: string;
      propKey: string;
      label: string;
      times: number[];
    };

const ROW_H = 28;
const RULER_H = 28;
/** Left/right gutter so playhead head + time chip aren't clipped at t=0 / end (Rive-style). */
const TIME_PAD_X = 28;
const HANDLE_W = 10;
/** Hit slop for playhead / work-area stems (full vertical line is draggable). */
const STEM_HIT = 10;
/** Playhead head + stem — one color across ruler and tracks. */
const PLAYHEAD_COLOR = '#EA580C';
const WORK_AREA_STEM_W = 2;
/** Only two clip colors: image vs element (shape / text / null). */
const CLIP_COLOR_IMAGE = '#4F8CFF';
const CLIP_COLOR_ELEMENT = '#77C562';
const SNAP_LINE_COLOR = '#38BDF8';

type TimelinePaintTheme = {
  tracksBg: string;
  rulerBg: string;
  rowEven: string;
  rowOdd: string;
  tickMajor: string;
  tickMinor: string;
  label: string;
  ink: string;
  surface: string;
  muted: string;
  line: string;
};

function cssVar(cs: CSSStyleDeclaration, name: string, fallback: string): string {
  const v = cs.getPropertyValue(name).trim();
  return v || fallback;
}

/** Resolve timeline canvas colors from theme tokens on the host. */
function readTimelinePaintTheme(el: Element | null): TimelinePaintTheme {
  const cs = getComputedStyle(el || document.documentElement);
  const surface = cssVar(cs, '--surface', '#ffffff');
  const canvas = cssVar(cs, '--canvas', '#F2F2F2');
  const rail = cssVar(cs, '--rail', canvas);
  const ink = cssVar(cs, '--ink', '#141414');
  const muted = cssVar(cs, '--muted', '#767676');
  const line = cssVar(cs, '--line', '#d9d9d9');
  return {
    tracksBg: canvas,
    rulerBg: rail,
    rowEven: surface,
    rowOdd: rail,
    tickMajor: line,
    tickMinor: line,
    label: muted,
    ink,
    surface,
    muted,
    line,
  };
}

function clipColor(kind: 'image' | 'element' | undefined): string {
  return kind === 'image' ? CLIP_COLOR_IMAGE : CLIP_COLOR_ELEMENT;
}

function formatMark(sec: number): string {
  if (sec <= 0) return '0s';
  if (sec >= 60) {
    const m = Math.floor(sec / 60);
    const s = Math.round(sec % 60);
    return `${m}:${String(s).padStart(2, '0')}`;
  }
  return `${Math.round(sec * 10) / 10}s`;
}

function formatWorkTip(sec: number, fps: number): string {
  const frame = Math.round(Math.max(0, sec) * Math.max(1, fps));
  const s = Math.floor(frame / Math.max(1, fps));
  const f = frame % Math.max(1, fps);
  return `${s}s ${f}f`;
}

export type LottieWorkAreaPreview = {
  inSec: number;
  outSec: number;
  /** Which bookend is being dragged — tip anchors here (not mid work-area). */
  edge: 'in' | 'out';
};

export type AnimationTimelineCanvasProps = {
  rows: LottieTimelineFlatRow[];
  /** Full ruler span (may be longer than work area). */
  duration: number;
  fps: number;
  playhead: number;
  workInSec: number;
  workOutSec: number;
  workAreaPreview?: LottieWorkAreaPreview | null;
  selectedLayerId: string | null;
  selectedKf: { propId: string; timeSec: number } | null;
  /** Live keyframe drag ghost (DOM-driven; hide source diamond). */
  kfGhost?: { propId: string; fromSec: number; timeSec: number } | null;
  trimPreview: { layerId: string; inSec: number; outSec: number } | null;
  snapLinesSec: number[];
  timeZoom: number;
  scrollTop: number;
  onScrollTop: (y: number) => void;
  onSeek: (sec: number) => void;
  onSelectLayer: (layer: LottieTimelineLayer) => void;
  onBeginClipDrag: (
    e: { clientX: number },
    layer: LottieTimelineLayer,
    mode: 'move' | 'in' | 'out'
  ) => void;
  onBeginWorkAreaDrag: (edge: 'in' | 'out', clientX: number) => void;
  onSelectKf: (propId: string, timeSec: number) => void;
  onKfPointerDown: (e: ReactPointerEvent, propId: string, fromSec: number) => void;
  onTracksContextMenu: (
    clientX: number,
    clientY: number,
    hit: {
      kind: 'kf' | 'prop' | 'layer' | 'clip' | 'row' | 'empty';
      propId?: string;
      propKey?: string;
      layerId?: string;
      layerInd?: number;
      timeSec?: number;
      times?: number[];
      sec?: number;
    }
  ) => void;
  onToggleKfAt: (layerInd: number, propKey: string, times: number[], atSec: number) => void;
  onTimeZoomDelta: (delta: number) => void;
};

function AnimationTimelineCanvas(props: AnimationTimelineCanvasProps) {
  const {
    rows,
    duration,
    fps,
    playhead,
    workInSec,
    workOutSec,
    workAreaPreview,
    selectedLayerId,
    selectedKf,
    kfGhost = null,
    trimPreview,
    snapLinesSec,
    timeZoom,
    scrollTop,
    onScrollTop,
    onSeek,
    onSelectLayer,
    onBeginClipDrag,
    onBeginWorkAreaDrag,
    onSelectKf,
    onKfPointerDown,
    onTracksContextMenu,
    onToggleKfAt,
    onTimeZoomDelta,
  } = props;

  const hostRef = useRef<HTMLDivElement | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const contentRef = useRef<HTMLDivElement | null>(null);
  const rulerRef = useRef<HTMLCanvasElement | null>(null);
  const tracksRef = useRef<HTMLCanvasElement | null>(null);
  const workTipRef = useRef<HTMLDivElement | null>(null);
  const widthRef = useRef(0);
  /** Keep ruler in lockstep with track horizontal scroll (no sticky — sticky desyncs when zoomed). */
  const syncRulerScrollX = useCallback(() => {
    const ruler = rulerRef.current;
    const scroll = scrollRef.current;
    if (!ruler || !scroll) return;
    const x = -scroll.scrollLeft;
    const next = x === 0 ? 'none' : `translateX(${x}px)`;
    if (ruler.style.transform !== next) ruler.style.transform = next;
  }, []);
  /** Avoid reallocating canvas buffers on every paint (drag stutter). */
  const canvasSizeRef = useRef({
    rulerW: 0,
    rulerH: 0,
    tracksW: 0,
    tracksH: 0,
  });
  const tipWidthRef = useRef(0);
  const scrubbingRef = useRef(false);
  /** Bump when html[data-theme] changes so canvas paints re-resolve CSS vars. */
  const [themeEpoch, setThemeEpoch] = useState(0);

  useEffect(() => {
    const obs = new MutationObserver(() => setThemeEpoch((n) => n + 1));
    obs.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['data-theme', 'class'],
    });
    return () => obs.disconnect();
  }, []);

  const workIn = workAreaPreview?.inSec ?? workInSec;
  const workOut = workAreaPreview?.outSec ?? workOutSec;

  const timesCoincide = (a: number, b: number) => Math.abs(a - b) <= 1 / Math.max(1, fps);

  const trackW = () => Math.max(1, widthRef.current) * Math.max(1, timeZoom);
  const innerW = (w: number) => Math.max(1, w - TIME_PAD_X * 2);
  const secToX = (sec: number, w: number) =>
    TIME_PAD_X +
    (Math.max(0, Math.min(duration, sec)) / Math.max(0.1, duration)) * innerW(w);
  const xToSec = (x: number, w: number) =>
    Math.max(
      0,
      Math.min(duration, ((x - TIME_PAD_X) / innerW(w)) * duration)
    );

  /** DOM tip next to the dragged bookend (viewport-clamped; not mid work-area). */
  const syncWorkAreaTip = useCallback(() => {
    const tip = workTipRef.current;
    const host = hostRef.current;
    const scroll = scrollRef.current;
    if (!tip || !host) return;
    if (!workAreaPreview) {
      tip.style.visibility = 'hidden';
      tipWidthRef.current = 0;
      return;
    }
    const startEl = tip.querySelector('[data-work-tip="start"]');
    const endEl = tip.querySelector('[data-work-tip="end"]');
    if (startEl) startEl.textContent = `Start: ${formatWorkTip(workAreaPreview.inSec, fps)}`;
    if (endEl) endEl.textContent = `End: ${formatWorkTip(workAreaPreview.outSec, fps)}`;
    const cssW = Math.max(1, Math.floor(host.clientWidth));
    const w = cssW * Math.max(1, timeZoom);
    const anchorSec =
      workAreaPreview.edge === 'in' ? workAreaPreview.inSec : workAreaPreview.outSec;
    const ax = secToX(anchorSec, w);
    const scrollLeft = scroll?.scrollLeft || 0;
    const measured = tip.offsetWidth;
    if (measured > 0) tipWidthRef.current = measured;
    const tipW = tipWidthRef.current || 88;
    // Bookend chip is 12px wide; keep ≥10px clear of the chip (not just the stem).
    const CHIP_W = 12;
    const gap = 10;
    let left =
      workAreaPreview.edge === 'in'
        ? ax - scrollLeft + CHIP_W + gap
        : ax - scrollLeft - CHIP_W - tipW - gap;
    left = Math.max(8, Math.min(cssW - tipW - 8, left));
    tip.style.left = `${left}px`;
    tip.style.visibility = 'visible';
  }, [duration, fps, timeZoom, workAreaPreview]);

  const paint = useCallback(() => {
    const host = hostRef.current;
    const ruler = rulerRef.current;
    const tracks = tracksRef.current;
    if (!host || !ruler || !tracks) return;
    const scroll = scrollRef.current;
    const cssW = Math.max(1, Math.floor(host.clientWidth));
    widthRef.current = cssW;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const w = cssW * Math.max(1, timeZoom);
    const content = contentRef.current;
    if (content && content.style.width !== `${w}px`) {
      content.style.width = `${w}px`;
    }
    const viewTracksH = Math.max(
      1,
      Math.floor(scroll?.clientHeight || Math.max(0, host.clientHeight - RULER_H))
    );
    const tracksH = Math.max(rows.length * ROW_H, viewTracksH);
    syncRulerScrollX();
    const win = workAreaPreview?.inSec ?? workInSec;
    const wout = workAreaPreview?.outSec ?? workOutSec;
    const xIn = secToX(win, w);
    const xOut = secToX(wout, w);

    const setup = (
      c: HTMLCanvasElement,
      h: number,
      kind: 'ruler' | 'tracks'
    ) => {
      const bufW = Math.floor(w * dpr);
      const bufH = Math.floor(h * dpr);
      const sizes = canvasSizeRef.current;
      const prevW = kind === 'ruler' ? sizes.rulerW : sizes.tracksW;
      const prevH = kind === 'ruler' ? sizes.rulerH : sizes.tracksH;
      if (prevW !== bufW || prevH !== bufH) {
        c.width = bufW;
        c.height = bufH;
        if (kind === 'ruler') {
          sizes.rulerW = bufW;
          sizes.rulerH = bufH;
        } else {
          sizes.tracksW = bufW;
          sizes.tracksH = bufH;
        }
      }
      if (c.style.width !== `${w}px`) c.style.width = `${w}px`;
      if (c.style.height !== `${h}px`) c.style.height = `${h}px`;
      const ctx = c.getContext('2d');
      if (!ctx) return null;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      return ctx;
    };

    const theme = readTimelinePaintTheme(host);
    const rctx = setup(ruler, RULER_H, 'ruler');
    if (rctx) {
      rctx.clearRect(0, 0, w, RULER_H);
      rctx.fillStyle = theme.rulerBg;
      rctx.fillRect(0, 0, w, RULER_H);
      // Dim outside work area on ruler (keep TIME_PAD gutters undimmed)
      rctx.save();
      rctx.globalAlpha = 0.1;
      rctx.fillStyle = theme.ink;
      if (xIn > TIME_PAD_X) rctx.fillRect(TIME_PAD_X, 0, xIn - TIME_PAD_X, RULER_H);
      if (xOut < w - TIME_PAD_X) {
        rctx.fillRect(xOut, 0, w - TIME_PAD_X - xOut, RULER_H);
      }
      rctx.restore();
      rctx.strokeStyle = theme.line;
      rctx.beginPath();
      rctx.moveTo(0, RULER_H - 0.5);
      rctx.lineTo(w, RULER_H - 0.5);
      rctx.stroke();
      // Density-aware step: long spans (e.g. after a low-FPS glitch) must not
      // paint a label every 0.5–2s or ticks collapse into a solid bar.
      const step = rulerStepForWidth(duration, Math.max(1, w - TIME_PAD_X * 2));
      // Label band on top, tick stems below — leave a clear gap so they don't kiss.
      const labelY = 4;
      const tickTopMajor = 16;
      const tickTopMinor = 20;
      rctx.font = '10px system-ui, sans-serif';
      rctx.textAlign = 'center';
      rctx.textBaseline = 'top';
      for (let t = 0; t <= duration + 1e-6; t += step) {
        const x = secToX(t, w);
        const major = Math.abs(t / step - Math.round(t / step)) < 1e-6;
        rctx.strokeStyle = major ? theme.tickMajor : theme.tickMinor;
        rctx.globalAlpha = major ? 1 : 0.55;
        rctx.beginPath();
        rctx.moveTo(x + 0.5, major ? tickTopMajor : tickTopMinor);
        rctx.lineTo(x + 0.5, RULER_H);
        rctx.stroke();
        rctx.globalAlpha = 1;
        if (major) {
          rctx.fillStyle = theme.label;
          rctx.fillText(formatMark(t), x, labelY);
        }
      }

      // Work area bookends first; playhead paints on top when they share t≈0.
      drawBookend(rctx, xIn, 'in', theme.ink, theme.surface);
      drawBookend(rctx, xOut, 'out', theme.ink, theme.surface);

      const px = secToX(playhead, w);
      rctx.fillStyle = PLAYHEAD_COLOR;
      rctx.beginPath();
      rctx.moveTo(px, RULER_H);
      rctx.lineTo(px - 6, RULER_H - 10);
      rctx.lineTo(px + 6, RULER_H - 10);
      rctx.closePath();
      rctx.fill();
      roundRect(rctx, px - 18, 2, 36, 14, 3);
      rctx.fill();
      rctx.fillStyle = '#FFF';
      rctx.font = '600 9px system-ui, sans-serif';
      rctx.textAlign = 'center';
      rctx.fillText(`${playhead.toFixed(1)}s`, px, 9);
      for (const sec of snapLinesSec) {
        const sx = secToX(sec, w);
        rctx.strokeStyle = SNAP_LINE_COLOR;
        rctx.lineWidth = 2;
        rctx.beginPath();
        rctx.moveTo(sx + 0.5, 0);
        rctx.lineTo(sx + 0.5, RULER_H);
        rctx.stroke();
      }
    }

    const tctx = setup(tracks, tracksH, 'tracks');
    if (!tctx) return;
    tctx.clearRect(0, 0, w, tracksH);
    tctx.fillStyle = theme.tracksBg;
    tctx.fillRect(0, 0, w, tracksH);

    const viewH = Math.max(ROW_H, viewTracksH);
    const first = Math.max(0, Math.floor(scrollTop / ROW_H) - 2);
    const last = Math.min(rows.length - 1, Math.ceil((scrollTop + viewH) / ROW_H) + 2);

    for (let i = first; i <= last; i++) {
      if (i < 0) continue;
      const y = i * ROW_H;
      tctx.fillStyle = i % 2 === 0 ? theme.rowEven : theme.rowOdd;
      tctx.fillRect(0, y, w, ROW_H);
      tctx.save();
      tctx.strokeStyle = theme.ink;
      tctx.globalAlpha = 0.08;
      tctx.lineWidth = 1;
      tctx.beginPath();
      tctx.moveTo(0, y + ROW_H - 0.5);
      tctx.lineTo(w, y + ROW_H - 0.5);
      tctx.stroke();
      tctx.restore();

      const row = rows[i];
      if (!row) continue;
      if (row.kind === 'layer') {
        const preview = trimPreview?.layerId === row.layer.id ? trimPreview : null;
        const inSec = preview?.inSec ?? row.layer.inSec;
        const outSec = preview?.outSec ?? row.layer.outSec;
        const x0 = secToX(inSec, w);
        const x1 = secToX(outSec, w);
        const cw = Math.max(8, x1 - x0);
        const selected = selectedLayerId === row.layer.id;
        const pad = 2;
        roundRect(tctx, x0, y + pad, cw, ROW_H - pad * 2, 4);
        tctx.fillStyle = clipColor(row.layer.clipKind);
        tctx.fill();
        tctx.save();
        tctx.lineWidth = selected ? 2 : 1;
        tctx.strokeStyle = theme.ink;
        tctx.globalAlpha = selected ? 1 : 0.35;
        tctx.stroke();
        tctx.restore();
        tctx.lineWidth = 1;
        tctx.fillStyle = '#FFF';
        tctx.font = '600 11px system-ui, sans-serif';
        tctx.textAlign = 'left';
        tctx.textBaseline = 'middle';
        tctx.save();
        tctx.beginPath();
        tctx.rect(x0 + 4, y, Math.max(0, cw - 8), ROW_H);
        tctx.clip();
        tctx.fillText(row.layer.name, x0 + (selected ? 14 : 8), y + ROW_H / 2);
        tctx.restore();
        if (selected) {
          const inAtWorkStart = timesCoincide(inSec, workIn);
          const leftHandleX = inAtWorkStart ? x0 + 3 : x0;
          tctx.fillStyle = 'rgba(0,0,0,0.22)';
          tctx.fillRect(leftHandleX, y + pad, HANDLE_W, ROW_H - pad * 2);
          tctx.fillRect(x0 + cw - HANDLE_W, y + pad, HANDLE_W, ROW_H - pad * 2);
          tctx.fillStyle = '#FFF';
          const midY = y + ROW_H / 2;
          for (const hx of [leftHandleX + 3, leftHandleX + 6, x0 + cw - 6, x0 + cw - 3]) {
            tctx.fillRect(hx, midY - 6, 1.2, 12);
          }
        }
      } else {
        for (const time of row.times) {
          if (
            kfGhost &&
            kfGhost.propId === row.propId &&
            Math.abs(time - kfGhost.fromSec) <= 1 / 60
          ) {
            continue;
          }
          const x = secToX(time, w);
          const selected =
            selectedKf?.propId === row.propId &&
            Math.abs((selectedKf?.timeSec || 0) - time) <= 1 / 60;
          drawDiamond(
            tctx,
            x,
            y + ROW_H / 2,
            5,
            selected ? theme.ink : CLIP_COLOR_IMAGE,
            theme.surface
          );
        }
        if (kfGhost && kfGhost.propId === row.propId) {
          const gx = secToX(kfGhost.timeSec, w);
          drawDiamond(tctx, gx, y + ROW_H / 2, 6, theme.ink, theme.surface);
        }
      }
    }

    // Dim outside work area over tracks (keep TIME_PAD gutters undimmed)
    tctx.save();
    tctx.globalAlpha = 0.14;
    tctx.fillStyle = theme.ink;
    if (xIn > TIME_PAD_X) tctx.fillRect(TIME_PAD_X, 0, xIn - TIME_PAD_X, tracksH);
    if (xOut < w - TIME_PAD_X) {
      tctx.fillRect(xOut, 0, w - TIME_PAD_X - xOut, tracksH);
    }
    tctx.restore();
    // Work-area stems span tracks; playhead line paints after (higher visual priority).
    tctx.fillStyle = theme.ink;
    tctx.fillRect(xIn - WORK_AREA_STEM_W / 2, 0, WORK_AREA_STEM_W, tracksH);
    tctx.fillRect(xOut - WORK_AREA_STEM_W / 2, 0, WORK_AREA_STEM_W, tracksH);

    for (const sec of snapLinesSec) {
      const sx = secToX(sec, w);
      tctx.strokeStyle = SNAP_LINE_COLOR;
      tctx.lineWidth = 2;
      tctx.setLineDash([4, 3]);
      tctx.beginPath();
      tctx.moveTo(sx + 0.5, 0);
      tctx.lineTo(sx + 0.5, tracksH);
      tctx.stroke();
      tctx.setLineDash([]);
    }

    const px = secToX(playhead, w);
    tctx.fillStyle = PLAYHEAD_COLOR;
    tctx.fillRect(px - 1, 0, 2, tracksH);
    syncWorkAreaTip();
  }, [
    rows,
    duration,
    fps,
    playhead,
    workInSec,
    workOutSec,
    workAreaPreview,
    selectedLayerId,
    selectedKf,
    kfGhost,
    trimPreview,
    snapLinesSec,
    timeZoom,
    scrollTop,
    themeEpoch,
    syncWorkAreaTip,
    syncRulerScrollX,
  ]);

  useEffect(() => {
    paint();
  }, [paint]);

  useEffect(() => {
    syncWorkAreaTip();
  }, [syncWorkAreaTip]);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const ro = new ResizeObserver(() => paint());
    ro.observe(host);
    return () => ro.disconnect();
  }, [paint]);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    if (Math.abs(el.scrollTop - scrollTop) > 0.5) el.scrollTop = scrollTop;
  }, [scrollTop]);

  /** Nearest vertical stem under pointer: work-area bookends or playhead. */
  const hitVerticalStem = (
    clientX: number,
    clientY: number,
    target: HTMLCanvasElement
  ): 'in' | 'out' | 'playhead' | null => {
    const rect = target.getBoundingClientRect();
    const x = clientX - rect.left;
    const w = trackW();
    const px = secToX(playhead, w);
    const xInPx = secToX(workIn, w);
    const candidates: Array<{ kind: 'in' | 'out' | 'playhead'; d: number }> = [
      { kind: 'playhead', d: Math.abs(x - px) },
      { kind: 'in', d: Math.abs(x - xInPx) },
      { kind: 'out', d: Math.abs(x - secToX(workOut, w)) },
    ];
    let best: (typeof candidates)[number] | null = null;
    for (const c of candidates) {
      if (c.d > STEM_HIT) continue;
      if (!best || c.d < best.d) best = c;
    }
    if (!best) return null;
    // When playhead + work-in coincide, playhead wins (same pixel column at t=0).
    if (
      timesCoincide(playhead, workIn) &&
      Math.abs(x - px) <= STEM_HIT &&
      Math.abs(x - xInPx) <= STEM_HIT
    ) {
      return 'playhead';
    }
    return best.kind;
  };

  const hitClipHandle = (
    clientX: number,
    clientY: number
  ): { kind: 'clip'; row: Extract<LottieTimelineFlatRow, { kind: 'layer' }>; mode: 'in' | 'out' } | null => {
    const canvas = tracksRef.current;
    if (!canvas) return null;
    const rect = canvas.getBoundingClientRect();
    const x = clientX - rect.left;
    const y = clientY - rect.top;
    const w = trackW();
    const rowIndex = Math.floor(y / ROW_H);
    if (rowIndex < 0 || rowIndex >= rows.length) return null;
    const row = rows[rowIndex];
    if (!row || row.kind !== 'layer') return null;
    const preview = trimPreview?.layerId === row.layer.id ? trimPreview : null;
    const inSec = preview?.inSec ?? row.layer.inSec;
    const outSec = preview?.outSec ?? row.layer.outSec;
    const x0 = secToX(inSec, w);
    const x1 = secToX(outSec, w);
    const cw = Math.max(8, x1 - x0);
    if (x < x0 || x > x0 + cw) return null;
    const local = x - x0;
    const inAtWorkStart = timesCoincide(inSec, workIn);
    const inHandleW = inAtWorkStart ? HANDLE_W + 4 : HANDLE_W;
    if (local <= inHandleW) return { kind: 'clip', row, mode: 'in' };
    if (local >= cw - HANDLE_W) return { kind: 'clip', row, mode: 'out' };
    return null;
  };

  const hitTracks = (clientX: number, clientY: number) => {
    const canvas = tracksRef.current;
    if (!canvas) return null;
    const rect = canvas.getBoundingClientRect();
    const x = clientX - rect.left;
    const y = clientY - rect.top;
    const w = trackW();
    const rowIndex = Math.floor(y / ROW_H);
    if (rowIndex < 0 || rowIndex >= rows.length) {
      return { kind: 'empty' as const, sec: xToSec(x, w) };
    }
    const row = rows[rowIndex];
    const rowY = rowIndex * ROW_H;
    if (row.kind === 'layer') {
      const preview = trimPreview?.layerId === row.layer.id ? trimPreview : null;
      const inSec = preview?.inSec ?? row.layer.inSec;
      const outSec = preview?.outSec ?? row.layer.outSec;
      const x0 = secToX(inSec, w);
      const x1 = secToX(outSec, w);
      const cw = Math.max(8, x1 - x0);
      if (x < x0 || x > x0 + cw) {
        return { kind: 'row' as const, row, sec: xToSec(x, w) };
      }
      const local = x - x0;
      let mode: 'move' | 'in' | 'out' = 'move';
      const inAtWorkStart = timesCoincide(inSec, workIn);
      const inHandleW = inAtWorkStart ? HANDLE_W + 4 : HANDLE_W;
      if (local <= inHandleW) mode = 'in';
      else if (local >= cw - HANDLE_W) mode = 'out';
      return { kind: 'clip' as const, row, mode };
    }
    for (const time of row.times) {
      const kx = secToX(time, w);
      if (Math.abs(x - kx) <= 7 && Math.abs(y - (rowY + ROW_H / 2)) <= 8) {
        return { kind: 'kf' as const, row, time };
      }
    }
    return { kind: 'prop' as const, row, sec: xToSec(x, w) };
  };

  const seekFromClientX = (clientX: number, target: HTMLCanvasElement) => {
    const rect = target.getBoundingClientRect();
    onSeek(xToSec(clientX - rect.left, trackW()));
  };

  const onRulerPointerDown = (e: ReactPointerEvent<HTMLCanvasElement>) => {
    const stem = hitVerticalStem(e.clientX, e.clientY, e.currentTarget);
    if (stem === 'in' || stem === 'out') {
      onBeginWorkAreaDrag(stem, e.clientX);
      return;
    }
    scrubbingRef.current = true;
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    seekFromClientX(e.clientX, e.currentTarget);
  };

  const onRulerPointerMove = (e: ReactPointerEvent<HTMLCanvasElement>) => {
    if (!scrubbingRef.current || !(e.buttons & 1)) return;
    seekFromClientX(e.clientX, e.currentTarget);
  };

  const onRulerPointerUp = (e: ReactPointerEvent<HTMLCanvasElement>) => {
    scrubbingRef.current = false;
    try {
      (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
    } catch {
      /* ignore */
    }
  };

  const onTracksPointerDown = (e: ReactPointerEvent<HTMLCanvasElement>) => {
    if (e.button !== 0) return;
    const clipHandle = hitClipHandle(e.clientX, e.clientY);
    if (clipHandle) {
      onSelectLayer(clipHandle.row.layer);
      onBeginClipDrag({ clientX: e.clientX }, clipHandle.row.layer, clipHandle.mode);
      return;
    }
    const stem = hitVerticalStem(e.clientX, e.clientY, e.currentTarget);
    if (stem === 'in' || stem === 'out') {
      onBeginWorkAreaDrag(stem, e.clientX);
      return;
    }
    if (stem === 'playhead') {
      scrubbingRef.current = true;
      (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
      seekFromClientX(e.clientX, e.currentTarget);
      return;
    }
    const hit = hitTracks(e.clientX, e.clientY);
    if (!hit) return;
    if (hit.kind === 'clip') {
      onSelectLayer(hit.row.layer);
      onBeginClipDrag({ clientX: e.clientX }, hit.row.layer, hit.mode);
      return;
    }
    if (hit.kind === 'row') {
      onSelectLayer(hit.row.layer);
      onSeek(hit.sec);
      return;
    }
    if (hit.kind === 'empty') {
      onSeek(hit.sec);
      return;
    }
    if (hit.kind === 'kf') {
      onSelectKf(hit.row.propId, hit.time);
      onKfPointerDown(e, hit.row.propId, hit.time);
      if (e.altKey) onToggleKfAt(hit.row.layer.ind, hit.row.propKey, hit.row.times, hit.time);
      return;
    }
    if (hit.kind === 'prop' && e.detail >= 2) {
      onSeek(hit.sec);
      onToggleKfAt(hit.row.layer.ind, hit.row.propKey, hit.row.times, hit.sec);
    } else if (hit.kind === 'prop') {
      onSeek(hit.sec);
    }
  };

  const onTracksPointerUp = (e: ReactPointerEvent<HTMLCanvasElement>) => {
    if (!scrubbingRef.current) return;
    scrubbingRef.current = false;
    try {
      (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
    } catch {
      /* ignore */
    }
  };

  const onTracksContextMenuLocal = (e: ReactMouseEvent<HTMLCanvasElement>) => {
    e.preventDefault();
    const hit = hitTracks(e.clientX, e.clientY);
    if (!hit) {
      onTracksContextMenu(e.clientX, e.clientY, { kind: 'empty' });
      return;
    }
    if (hit.kind === 'kf') {
      onTracksContextMenu(e.clientX, e.clientY, {
        kind: 'kf',
        propId: hit.row.propId,
        propKey: hit.row.propKey,
        layerId: hit.row.layer.id,
        layerInd: hit.row.layer.ind,
        timeSec: hit.time,
        times: hit.row.times,
      });
      return;
    }
    if (hit.kind === 'prop') {
      onTracksContextMenu(e.clientX, e.clientY, {
        kind: 'prop',
        propId: hit.row.propId,
        propKey: hit.row.propKey,
        layerId: hit.row.layer.id,
        layerInd: hit.row.layer.ind,
        times: hit.row.times,
        sec: hit.sec,
      });
      return;
    }
    if (hit.kind === 'clip' || hit.kind === 'row') {
      onTracksContextMenu(e.clientX, e.clientY, {
        kind: 'layer',
        layerId: hit.row.layer.id,
        layerInd: hit.row.layer.ind,
      });
      return;
    }
    onTracksContextMenu(e.clientX, e.clientY, { kind: 'empty', sec: hit.sec });
  };

  const onTracksPointerMove = (e: ReactPointerEvent<HTMLCanvasElement>) => {
    const el = e.currentTarget;
    if (scrubbingRef.current && e.buttons & 1) {
      seekFromClientX(e.clientX, el);
      el.style.cursor = 'ew-resize';
      return;
    }
    const stem = hitVerticalStem(e.clientX, e.clientY, el);
    if (stem) {
      el.style.cursor = 'ew-resize';
      return;
    }
    const clipHandle = hitClipHandle(e.clientX, e.clientY);
    if (clipHandle) {
      el.style.cursor = 'ew-resize';
      return;
    }
    const hit = hitTracks(e.clientX, e.clientY);
    if (hit?.kind === 'clip' && (hit.mode === 'in' || hit.mode === 'out')) {
      el.style.cursor = 'ew-resize';
      return;
    }
    if (hit?.kind === 'clip') {
      el.style.cursor = 'grab';
      return;
    }
    if (hit?.kind === 'kf') {
      el.style.cursor = kfGhost ? 'grabbing' : 'grab';
      return;
    }
    el.style.cursor = kfGhost ? 'grabbing' : 'default';
  };

  const onTracksPointerLeave = (e: ReactPointerEvent<HTMLCanvasElement>) => {
    e.currentTarget.style.cursor = 'default';
  };

  const onWheel = (e: ReactWheelEvent) => {
    if (e.ctrlKey || e.metaKey) {
      e.preventDefault();
      onTimeZoomDelta(e.deltaY > 0 ? -0.5 : 0.5);
    }
  };

  return (
    <div
      ref={hostRef}
      className="relative flex min-h-0 min-w-0 flex-1 flex-col bg-[var(--canvas)]"
      onWheel={onWheel}
    >
      {/* Ruler sits outside the scroller; translateX mirrors track scrollLeft. */}
      <div className="relative z-[2] h-7 shrink-0 overflow-hidden border-b border-[var(--line)] bg-[var(--rail)]">
        <canvas
          ref={rulerRef}
          className="block cursor-ew-resize will-change-transform"
          onPointerDown={onRulerPointerDown}
          onPointerMove={onRulerPointerMove}
          onPointerUp={onRulerPointerUp}
          onPointerCancel={onRulerPointerUp}
        />
      </div>
      <div
        ref={scrollRef}
        data-lottie-timeline-scroll=""
        className="min-h-0 flex-1 overflow-auto"
        onScroll={(e) => {
          const el = e.currentTarget as HTMLDivElement;
          onScrollTop(el.scrollTop);
          syncRulerScrollX();
          syncWorkAreaTip();
        }}
      >
        <div ref={contentRef} className="relative min-h-full">
          <canvas
            ref={tracksRef}
            className="block"
            onPointerDown={onTracksPointerDown}
            onPointerMove={onTracksPointerMove}
            onPointerUp={onTracksPointerUp}
            onPointerCancel={onTracksPointerUp}
            onPointerLeave={onTracksPointerLeave}
            onContextMenu={onTracksContextMenuLocal}
          />
        </div>
      </div>
      {/* HTML tip — not canvas — so browser zoom keeps crisp text (Rive-style). */}
      <div
        ref={workTipRef}
        className="pointer-events-none absolute top-0.5 z-[6] min-w-[5.5rem] rounded-sm border border-[var(--line)] bg-[var(--surface)] px-2 py-1 text-[10px] font-semibold leading-tight text-[var(--ink)] shadow-sm"
        style={{ visibility: 'hidden', left: 8 }}
        aria-hidden={!workAreaPreview}
      >
        <div data-work-tip="start">Start: 0s 0f</div>
        <div data-work-tip="end">End: 0s 0f</div>
      </div>
    </div>
  );
}

function drawBookend(
  ctx: CanvasRenderingContext2D,
  x: number,
  edge: 'in' | 'out',
  stemColor: string,
  chipTextColor: string
) {
  const top = 4;
  const h = RULER_H - 6;
  ctx.fillStyle = stemColor;
  ctx.fillRect(x - WORK_AREA_STEM_W / 2, top, WORK_AREA_STEM_W, h);
  // Cap with chevron chip
  const chipW = 12;
  const chipH = 12;
  const cx = edge === 'in' ? x : x - chipW;
  roundRect(ctx, cx, top, chipW, chipH, 2);
  ctx.fill();
  ctx.fillStyle = chipTextColor;
  ctx.font = '700 9px system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(edge === 'in' ? '›' : '‹', cx + chipW / 2, top + chipH / 2 + 0.5);
}

function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number
) {
  const rr = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
}

function drawDiamond(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  r: number,
  fill: string,
  stroke: string
) {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(Math.PI / 4);
  ctx.fillStyle = fill;
  ctx.fillRect(-r, -r, r * 2, r * 2);
  ctx.strokeStyle = stroke;
  ctx.lineWidth = 1;
  ctx.strokeRect(-r, -r, r * 2, r * 2);
  ctx.restore();
}

export const LOTTIE_TIMELINE_ROW_H = ROW_H;
export const LOTTIE_TIMELINE_RULER_H = RULER_H;
export const LOTTIE_TIMELINE_TIME_PAD_X = TIME_PAD_X;

export default memo(AnimationTimelineCanvas);
