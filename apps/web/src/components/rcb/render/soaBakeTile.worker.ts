/**
 * Off-main-thread SoA tile bake (viewport streaming map).
 * Receives a TypedArray snapshot + tile bounds; returns ImageBitmap.
 */
/// <reference lib="webworker" />

const SOA_FLAG_VISIBLE = 1 << 0;
const SOA_FLAG_CANVAS_IDLE = 1 << 3;
const SOA_FLAG_BASIC_GEOM = 1 << 4;
const SOA_FLAG_FREE = 1 << 5;
const SOA_KIND_RECT = 0;
const SOA_KIND_ELLIPSE = 1;
const SOA_KIND_LINE = 2;
const SOA_KIND_PATH = 3;
const POS_STRIDE = 4;
const RAD_STRIDE = 4;

export type SoaBakeWorkerSync = {
  type: 'sync';
  revision: number;
  count: number;
  positions: Float32Array;
  radii: Float32Array;
  colors: Uint32Array;
  flags: Uint32Array;
  kinds: Uint8Array;
  strokeWidths: Float32Array;
  strokeColors: Uint32Array;
  pathXY: Float32Array;
  pathStart: Int32Array;
  pathLen: Uint16Array;
  pathClosed: Uint8Array;
};

export type SoaBakeWorkerJob = {
  type: 'bake';
  jobId: number;
  key: string;
  revision: number;
  tilePx: number;
  bounds: { left: number; top: number; width: number; height: number };
};

export type SoaBakeWorkerRequest = SoaBakeWorkerSync | SoaBakeWorkerJob;

export type SoaBakeWorkerResult =
  | {
      type: 'tile';
      jobId: number;
      key: string;
      revision: number;
      ok: true;
      bitmap: ImageBitmap;
    }
  | {
      type: 'tile';
      jobId: number;
      key: string;
      revision: number;
      ok: false;
      error: string;
    };

type BufSnap = {
  revision: number;
  count: number;
  positions: Float32Array;
  radii: Float32Array;
  colors: Uint32Array;
  flags: Uint32Array;
  kinds: Uint8Array;
  strokeWidths: Float32Array;
  strokeColors: Uint32Array;
  pathXY: Float32Array;
  pathStart: Int32Array;
  pathLen: Uint16Array;
  pathClosed: Uint8Array;
};

let snap: BufSnap | null = null;

function unpackCssColor(argb: number): string {
  const a = ((argb >>> 24) & 255) / 255;
  const r = (argb >>> 16) & 255;
  const g = (argb >>> 8) & 255;
  const b = argb & 255;
  if (a >= 0.999) return `rgb(${r},${g},${b})`;
  return `rgba(${r},${g},${b},${a})`;
}

function paintRoundedRect(
  ctx: OffscreenCanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  tl: number,
  tr: number,
  br: number,
  bl: number
) {
  ctx.beginPath();
  ctx.moveTo(x + tl, y);
  ctx.lineTo(x + w - tr, y);
  if (tr > 0) ctx.arcTo(x + w, y, x + w, y + tr, tr);
  else ctx.lineTo(x + w, y);
  ctx.lineTo(x + w, y + h - br);
  if (br > 0) ctx.arcTo(x + w, y + h, x + w - br, y + h, br);
  else ctx.lineTo(x + w, y + h);
  ctx.lineTo(x + bl, y + h);
  if (bl > 0) ctx.arcTo(x, y + h, x, y + h - bl, bl);
  else ctx.lineTo(x, y + h);
  ctx.lineTo(x, y + tl);
  if (tl > 0) ctx.arcTo(x, y, x + tl, y, tl);
  else ctx.lineTo(x, y);
  ctx.closePath();
}

function paintSnapInto(
  ctx: OffscreenCanvasRenderingContext2D,
  buf: BufSnap,
  bounds: { left: number; top: number; width: number; height: number }
) {
  const vl = bounds.left;
  const vt = bounds.top;
  const vr = vl + bounds.width;
  const vb = vt + bounds.height;
  for (let i = 0; i < buf.count; i += 1) {
    const flags = buf.flags[i];
    if (flags & SOA_FLAG_FREE) continue;
    if (!(flags & SOA_FLAG_VISIBLE) || !(flags & SOA_FLAG_CANVAS_IDLE)) continue;
    if (!(flags & SOA_FLAG_BASIC_GEOM)) continue;
    const kind = buf.kinds[i];
    const o = i * POS_STRIDE;
    const x = buf.positions[o];
    const y = buf.positions[o + 1];
    const w = buf.positions[o + 2];
    const h = buf.positions[o + 3];
    if (x + w < vl || y + h < vt || x > vr || y > vb) continue;

    if (kind === SOA_KIND_LINE || kind === SOA_KIND_PATH) {
      const start = buf.pathStart[i];
      const len = buf.pathLen[i];
      const sw = buf.strokeWidths[i] > 0 ? buf.strokeWidths[i] : 2;
      const strokeArgb = buf.strokeColors[i] || buf.colors[i];
      if (start < 0 || len < 2 || !strokeArgb) continue;
      ctx.strokeStyle = unpackCssColor(strokeArgb);
      ctx.lineWidth = sw;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      const closed = buf.pathClosed[i] !== 0;
      const fillArgb = buf.colors[i];
      const doFill = closed && kind === SOA_KIND_PATH && fillArgb !== 0;
      if (doFill) ctx.fillStyle = unpackCssColor(fillArgb);
      ctx.beginPath();
      const base = start * 2;
      let moved = false;
      for (let p = 0; p < len; p += 1) {
        const fo = base + p * 2;
        const px = buf.pathXY[fo];
        const py = buf.pathXY[fo + 1];
        if (!Number.isFinite(px) || !Number.isFinite(py)) {
          moved = false;
          continue;
        }
        if (!moved) {
          ctx.moveTo(px, py);
          moved = true;
        } else {
          ctx.lineTo(px, py);
        }
      }
      if (closed) ctx.closePath();
      if (doFill) ctx.fill();
      ctx.stroke();
      continue;
    }

    if (kind === SOA_KIND_ELLIPSE) {
      const fillArgb = buf.colors[i];
      if (!fillArgb) continue;
      ctx.fillStyle = unpackCssColor(fillArgb);
      ctx.beginPath();
      ctx.ellipse(x + w / 2, y + h / 2, Math.max(0.5, w / 2), Math.max(0.5, h / 2), 0, 0, Math.PI * 2);
      ctx.fill();
      const outlineW = buf.strokeWidths[i];
      const outlineArgb = buf.strokeColors[i];
      if (outlineW > 0 && outlineArgb) {
        ctx.strokeStyle = unpackCssColor(outlineArgb);
        ctx.lineWidth = outlineW;
        ctx.stroke();
      }
      continue;
    }

    if (kind !== SOA_KIND_RECT) continue;
    const fillArgb = buf.colors[i];
    if (!fillArgb) continue;
    ctx.fillStyle = unpackCssColor(fillArgb);
    const ro = i * RAD_STRIDE;
    const tl = buf.radii[ro] || 0;
    const tr = buf.radii[ro + 1] || 0;
    const br = buf.radii[ro + 2] || 0;
    const bl = buf.radii[ro + 3] || 0;
    if (tl > 0 || tr > 0 || br > 0 || bl > 0) {
      paintRoundedRect(ctx, x, y, w, h, tl, tr, br, bl);
      ctx.fill();
    } else {
      ctx.fillRect(x, y, w, h);
    }
    const outlineW = buf.strokeWidths[i];
    const outlineArgb = buf.strokeColors[i];
    if (outlineW > 0 && outlineArgb) {
      ctx.strokeStyle = unpackCssColor(outlineArgb);
      ctx.lineWidth = outlineW;
      if (tl > 0 || tr > 0 || br > 0 || bl > 0) {
        paintRoundedRect(ctx, x, y, w, h, tl, tr, br, bl);
        ctx.stroke();
      } else {
        ctx.strokeRect(x, y, w, h);
      }
    }
  }
}

async function bakeTile(job: SoaBakeWorkerJob): Promise<SoaBakeWorkerResult> {
  if (!snap || snap.revision !== job.revision) {
    return {
      type: 'tile',
      jobId: job.jobId,
      key: job.key,
      revision: job.revision,
      ok: false,
      error: 'stale-or-missing-sync',
    };
  }
  const px = Math.max(1, Math.min(4096, Math.floor(job.tilePx) || 2048));
  const canvas = new OffscreenCanvas(px, px);
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    return {
      type: 'tile',
      jobId: job.jobId,
      key: job.key,
      revision: job.revision,
      ok: false,
      error: 'no-2d',
    };
  }
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, px, px);
  const sx = px / Math.max(1, job.bounds.width);
  const sy = px / Math.max(1, job.bounds.height);
  ctx.setTransform(sx, 0, 0, sy, -job.bounds.left * sx, -job.bounds.top * sy);
  paintSnapInto(ctx, snap, job.bounds);
  const bitmap = await createImageBitmap(canvas);
  return {
    type: 'tile',
    jobId: job.jobId,
    key: job.key,
    revision: job.revision,
    ok: true,
    bitmap,
  };
}

self.onmessage = async (ev: MessageEvent<SoaBakeWorkerRequest>) => {
  const msg = ev.data;
  if (!msg || typeof msg !== 'object') return;
  if (msg.type === 'sync') {
    snap = {
      revision: msg.revision,
      count: msg.count,
      positions: msg.positions,
      radii: msg.radii,
      colors: msg.colors,
      flags: msg.flags,
      kinds: msg.kinds,
      strokeWidths: msg.strokeWidths,
      strokeColors: msg.strokeColors,
      pathXY: msg.pathXY,
      pathStart: msg.pathStart,
      pathLen: msg.pathLen,
      pathClosed: msg.pathClosed,
    };
    return;
  }
  if (msg.type !== 'bake') return;
  try {
    const res = await bakeTile(msg);
    if (res.ok) {
      self.postMessage(res, [res.bitmap]);
    } else {
      self.postMessage(res);
    }
  } catch (err) {
    const res: SoaBakeWorkerResult = {
      type: 'tile',
      jobId: msg.jobId,
      key: msg.key,
      revision: msg.revision,
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    };
    self.postMessage(res);
  }
};
