/**
 * Canvas Lottie timeline — sticky ruler + scrolling track canvas.
 * Playhead = current time; Work Area bookends = composition ip/op.
 */
import {
  memo,
  useCallback,
  useEffect,
  useRef,
  type PointerEvent as ReactPointerEvent,
  type WheelEvent as ReactWheelEvent,
} from 'react';
import type { LottieTimelineLayer } from '@/components/editor/nodes/LottieNode/lottieTimelineModel';

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
const HANDLE_W = 10;
const BOOKEND_HIT = 8;
const CLIP_COLORS = [
  '#4F8CFF',
  '#77C562',
  '#7C83F6',
  '#E8A23A',
  '#E36B8B',
  '#2DB7A0',
  '#9B6BFF',
  '#D97757',
] as const;

function clipColor(ind: number): string {
  return CLIP_COLORS[Math.abs(ind) % CLIP_COLORS.length];
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

export type LottieTimelineCanvasProps = {
  rows: LottieTimelineFlatRow[];
  /** Full ruler span (may be longer than work area). */
  duration: number;
  fps: number;
  playhead: number;
  workInSec: number;
  workOutSec: number;
  workAreaPreview?: { inSec: number; outSec: number } | null;
  selectedLayerId: string | null;
  selectedKf: { propId: string; timeSec: number } | null;
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
  onToggleKfAt: (layerInd: number, propKey: string, times: number[], atSec: number) => void;
  onTimeZoomDelta: (delta: number) => void;
};

function LottieTimelineCanvas(props: LottieTimelineCanvasProps) {
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
    onToggleKfAt,
    onTimeZoomDelta,
  } = props;

  const hostRef = useRef<HTMLDivElement | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const rulerRef = useRef<HTMLCanvasElement | null>(null);
  const tracksRef = useRef<HTMLCanvasElement | null>(null);
  const widthRef = useRef(0);
  const scrubbingRef = useRef(false);

  const workIn = workAreaPreview?.inSec ?? workInSec;
  const workOut = workAreaPreview?.outSec ?? workOutSec;

  const trackW = () => Math.max(1, widthRef.current) * Math.max(1, timeZoom);
  const secToX = (sec: number, w: number) =>
    (Math.max(0, Math.min(duration, sec)) / Math.max(0.1, duration)) * w;
  const xToSec = (x: number, w: number) =>
    Math.max(0, Math.min(duration, (x / Math.max(1, w)) * duration));

  const paint = useCallback(() => {
    const host = hostRef.current;
    const ruler = rulerRef.current;
    const tracks = tracksRef.current;
    if (!host || !ruler || !tracks) return;
    const cssW = Math.max(1, Math.floor(host.clientWidth));
    widthRef.current = cssW;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const w = cssW * Math.max(1, timeZoom);
    const tracksH = Math.max(rows.length * ROW_H, Math.max(1, host.clientHeight - RULER_H));
    const win = workAreaPreview?.inSec ?? workInSec;
    const wout = workAreaPreview?.outSec ?? workOutSec;
    const xIn = secToX(win, w);
    const xOut = secToX(wout, w);

    const setup = (c: HTMLCanvasElement, h: number) => {
      c.width = Math.floor(w * dpr);
      c.height = Math.floor(h * dpr);
      c.style.width = `${w}px`;
      c.style.height = `${h}px`;
      const ctx = c.getContext('2d');
      if (!ctx) return null;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      return ctx;
    };

    const rctx = setup(ruler, RULER_H);
    if (rctx) {
      rctx.clearRect(0, 0, w, RULER_H);
      rctx.fillStyle = '#EEF2F7';
      rctx.fillRect(0, 0, w, RULER_H);
      // Dim outside work area on ruler
      rctx.fillStyle = 'rgba(15, 23, 42, 0.08)';
      if (xIn > 0) rctx.fillRect(0, 0, xIn, RULER_H);
      if (xOut < w) rctx.fillRect(xOut, 0, w - xOut, RULER_H);
      rctx.strokeStyle = '#D1D5DB';
      rctx.beginPath();
      rctx.moveTo(0, RULER_H - 0.5);
      rctx.lineTo(w, RULER_H - 0.5);
      rctx.stroke();
      const step = duration <= 3 ? 0.5 : duration <= 10 ? 1 : 2;
      rctx.font = '11px system-ui, sans-serif';
      rctx.textAlign = 'center';
      rctx.textBaseline = 'middle';
      for (let t = 0; t <= duration + 1e-6; t += step) {
        const x = secToX(t, w);
        const major = Math.abs(t - Math.round(t)) < 1e-6;
        rctx.strokeStyle = major ? '#9CA3AF' : '#D1D5DB';
        rctx.beginPath();
        rctx.moveTo(x + 0.5, major ? 10 : 16);
        rctx.lineTo(x + 0.5, RULER_H);
        rctx.stroke();
        if (major) {
          rctx.fillStyle = '#6B7280';
          rctx.fillText(formatMark(t), x, 10);
        }
      }

      // Work area bookends (Rive-style)
      drawBookend(rctx, xIn, 'in');
      drawBookend(rctx, xOut, 'out');

      if (workAreaPreview) {
        const tip = `Start: ${formatWorkTip(win, fps)}\nEnd: ${formatWorkTip(wout, fps)}`;
        const lines = tip.split('\n');
        const tipX = Math.min(w - 72, Math.max(8, (xIn + xOut) / 2 - 36));
        roundRect(rctx, tipX, 1, 72, 22, 3);
        rctx.fillStyle = '#FFFFFF';
        rctx.fill();
        rctx.strokeStyle = '#E5E7EB';
        rctx.stroke();
        rctx.fillStyle = '#0F172A';
        rctx.font = '600 8px system-ui, sans-serif';
        rctx.textAlign = 'left';
        rctx.fillText(lines[0]!, tipX + 6, 8);
        rctx.fillText(lines[1]!, tipX + 6, 17);
      }

      const px = secToX(playhead, w);
      rctx.fillStyle = '#EA580C';
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
        rctx.strokeStyle = '#38BDF8';
        rctx.lineWidth = 2;
        rctx.beginPath();
        rctx.moveTo(sx + 0.5, 0);
        rctx.lineTo(sx + 0.5, RULER_H);
        rctx.stroke();
      }
    }

    const tctx = setup(tracks, tracksH);
    if (!tctx) return;
    tctx.clearRect(0, 0, w, tracksH);
    tctx.fillStyle = '#F3F4F6';
    tctx.fillRect(0, 0, w, tracksH);

    const viewH = Math.max(ROW_H, host.clientHeight - RULER_H);
    const first = Math.max(0, Math.floor(scrollTop / ROW_H) - 2);
    const last = Math.min(rows.length - 1, Math.ceil((scrollTop + viewH) / ROW_H) + 2);

    for (let i = first; i <= last; i++) {
      if (i < 0) continue;
      const y = i * ROW_H;
      tctx.fillStyle = i % 2 === 0 ? '#FFFFFF' : '#F9FAFB';
      tctx.fillRect(0, y, w, ROW_H);
      tctx.strokeStyle = '#E5E7EB';
      tctx.beginPath();
      tctx.moveTo(0, y + ROW_H - 0.5);
      tctx.lineTo(w, y + ROW_H - 0.5);
      tctx.stroke();

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
        tctx.fillStyle = clipColor(row.layer.ind);
        tctx.fill();
        tctx.lineWidth = selected ? 2 : 1;
        tctx.strokeStyle = selected ? '#0F172A' : 'rgba(15,23,42,0.35)';
        tctx.stroke();
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
          tctx.fillStyle = 'rgba(0,0,0,0.22)';
          tctx.fillRect(x0, y + pad, HANDLE_W, ROW_H - pad * 2);
          tctx.fillRect(x0 + cw - HANDLE_W, y + pad, HANDLE_W, ROW_H - pad * 2);
          tctx.fillStyle = '#FFF';
          const midY = y + ROW_H / 2;
          for (const hx of [x0 + 3, x0 + 6, x0 + cw - 6, x0 + cw - 3]) {
            tctx.fillRect(hx, midY - 6, 1.2, 12);
          }
        }
      } else {
        for (const time of row.times) {
          const x = secToX(time, w);
          const selected =
            selectedKf?.propId === row.propId &&
            Math.abs((selectedKf?.timeSec || 0) - time) <= 1 / 60;
          drawDiamond(tctx, x, y + ROW_H / 2, 5, selected ? '#0F172A' : '#4F8CFF');
        }
      }
    }

    // Dim outside work area over tracks
    tctx.fillStyle = 'rgba(15, 23, 42, 0.12)';
    if (xIn > 0) tctx.fillRect(0, 0, xIn, tracksH);
    if (xOut < w) tctx.fillRect(xOut, 0, w - xOut, tracksH);
    // Work area edges
    tctx.strokeStyle = 'rgba(15, 23, 42, 0.45)';
    tctx.lineWidth = 1;
    tctx.beginPath();
    tctx.moveTo(xIn + 0.5, 0);
    tctx.lineTo(xIn + 0.5, tracksH);
    tctx.moveTo(xOut + 0.5, 0);
    tctx.lineTo(xOut + 0.5, tracksH);
    tctx.stroke();

    for (const sec of snapLinesSec) {
      const sx = secToX(sec, w);
      tctx.strokeStyle = '#38BDF8';
      tctx.lineWidth = 2;
      tctx.setLineDash([4, 3]);
      tctx.beginPath();
      tctx.moveTo(sx + 0.5, 0);
      tctx.lineTo(sx + 0.5, tracksH);
      tctx.stroke();
      tctx.setLineDash([]);
    }

    const px = secToX(playhead, w);
    tctx.fillStyle = '#EA580C';
    tctx.fillRect(px - 1, 0, 2, tracksH);
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
    trimPreview,
    snapLinesSec,
    timeZoom,
    scrollTop,
  ]);

  useEffect(() => {
    paint();
  }, [paint]);

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

  const hitBookend = (clientX: number, target: HTMLCanvasElement): 'in' | 'out' | null => {
    const rect = target.getBoundingClientRect();
    const x = clientX - rect.left;
    const w = trackW();
    const xIn = secToX(workIn, w);
    const xOut = secToX(workOut, w);
    if (Math.abs(x - xIn) <= BOOKEND_HIT) return 'in';
    if (Math.abs(x - xOut) <= BOOKEND_HIT) return 'out';
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
      if (local <= HANDLE_W) mode = 'in';
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
    const edge = hitBookend(e.clientX, e.currentTarget);
    if (edge) {
      onBeginWorkAreaDrag(edge, e.clientX);
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
    const edge = hitBookend(e.clientX, e.currentTarget);
    if (edge) {
      onBeginWorkAreaDrag(edge, e.clientX);
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

  const onWheel = (e: ReactWheelEvent) => {
    if (e.ctrlKey || e.metaKey) {
      e.preventDefault();
      onTimeZoomDelta(e.deltaY > 0 ? -0.5 : 0.5);
    }
  };

  return (
    <div ref={hostRef} className="flex min-h-0 min-w-0 flex-1 flex-col bg-[#F3F4F6]" onWheel={onWheel}>
      <div
        ref={scrollRef}
        data-lottie-timeline-scroll=""
        className="min-h-0 flex-1 overflow-auto"
        onScroll={(e) => onScrollTop((e.currentTarget as HTMLDivElement).scrollTop)}
      >
        <div className="sticky top-0 z-[2] border-b border-[#D1D5DB] bg-[#EEF2F7]">
          <canvas
            ref={rulerRef}
            className="block cursor-ew-resize"
            onPointerDown={onRulerPointerDown}
            onPointerMove={onRulerPointerMove}
            onPointerUp={onRulerPointerUp}
            onPointerCancel={onRulerPointerUp}
          />
        </div>
        <canvas ref={tracksRef} className="block" onPointerDown={onTracksPointerDown} />
      </div>
    </div>
  );
}

function drawBookend(
  ctx: CanvasRenderingContext2D,
  x: number,
  edge: 'in' | 'out'
) {
  const top = 4;
  const h = RULER_H - 6;
  ctx.fillStyle = '#0F172A';
  ctx.fillRect(x - 1, top, 2, h);
  // Cap with chevron chip
  const chipW = 12;
  const chipH = 12;
  const cx = edge === 'in' ? x : x - chipW;
  roundRect(ctx, cx, top, chipW, chipH, 2);
  ctx.fill();
  ctx.fillStyle = '#FFF';
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
  fill: string
) {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(Math.PI / 4);
  ctx.fillStyle = fill;
  ctx.fillRect(-r, -r, r * 2, r * 2);
  ctx.strokeStyle = '#FFFFFF';
  ctx.lineWidth = 1;
  ctx.strokeRect(-r, -r, r * 2, r * 2);
  ctx.restore();
}

export const LOTTIE_TIMELINE_ROW_H = ROW_H;
export const LOTTIE_TIMELINE_RULER_H = RULER_H;

export default memo(LottieTimelineCanvas);
