import { normalizeColor } from './sceneEffects';

export type MeshPoint = {
  /** Percent 0–100 along width */
  x: number;
  /** Percent 0–100 along height */
  y: number;
  color: string;
  /** Per-anchor opacity 0–100 (default 100). */
  opacity?: number;
};

export const MESH_SIZES = [3, 4, 5, 6, 7, 8] as const;
export type MeshSize = (typeof MESH_SIZES)[number];

const PRESET_COLORS = [
  '#ff6b6b',
  '#feca57',
  '#48dbfb',
  '#ff9ff3',
  '#1dd1a1',
  '#5f27cd',
  '#c8d6e5',
  '#576574',
  '#54a0ff',
  '#00d2d3',
  '#ff9f43',
  '#ee5a24',
];

function clampPct(n: number) {
  return Math.min(100, Math.max(0, Number(n) || 0));
}

function clampOpacityPct(n: number) {
  return Math.min(100, Math.max(0, Math.round(Number(n) || 0)));
}

function parseRgb(hex: string): [number, number, number] {
  const h = normalizeColor(hex).replace('#', '');
  const full = h.length === 3 ? h.split('').map((c) => c + c).join('') : h.padEnd(6, '0');
  return [
    parseInt(full.slice(0, 2), 16) || 0,
    parseInt(full.slice(2, 4), 16) || 0,
    parseInt(full.slice(4, 6), 16) || 0,
  ];
}

/** Regular N×N mesh with evenly spaced anchors. */
export function createMeshGrid(size: MeshSize, baseColor = '#3B82F6'): MeshPoint[] {
  const n = Math.min(8, Math.max(3, size));
  const points: MeshPoint[] = [];
  for (let row = 0; row < n; row++) {
    for (let col = 0; col < n; col++) {
      const i = row * n + col;
      points.push({
        x: n === 1 ? 50 : (col / (n - 1)) * 100,
        y: n === 1 ? 50 : (row / (n - 1)) * 100,
        color: i === 0 ? normalizeColor(baseColor) : PRESET_COLORS[i % PRESET_COLORS.length],
        opacity: 100,
      });
    }
  }
  return points;
}

/** Rebuild grid density; try to keep nearby colors. */
export function remeshPoints(
  size: MeshSize,
  prev: MeshPoint[] | undefined,
  baseColor = '#3B82F6'
): MeshPoint[] {
  const next = createMeshGrid(size, baseColor);
  if (!prev?.length) return next;
  return next.map((p) => {
    let best = prev[0];
    let bestD = Infinity;
    for (const q of prev) {
      const d = (q.x - p.x) ** 2 + (q.y - p.y) ** 2;
      if (d < bestD) {
        bestD = d;
        best = q;
      }
    }
    return { ...p, color: best?.color || p.color, opacity: best?.opacity ?? 100 };
  });
}

export function normalizeMeshPoints(
  points: unknown,
  size: MeshSize,
  fallbackColor: string
): MeshPoint[] {
  if (!Array.isArray(points) || points.length === 0) {
    return createMeshGrid(size, fallbackColor);
  }
  const normalized = points.map((p) => {
    const rec = p && typeof p === 'object' ? (p as Record<string, unknown>) : {};
    return {
      x: clampPct(Number(rec.x ?? 50)),
      y: clampPct(Number(rec.y ?? 50)),
      color: normalizeColor(String(rec.color || fallbackColor)),
      opacity: clampOpacityPct(Number(rec.opacity ?? 100)),
    };
  });
  const expect = size * size;
  if (normalized.length === expect) return normalized;
  return remeshPoints(size, normalized, fallbackColor);
}

/**
 * Inverse-distance blend — soft multi-point “弥散” look.
 * Power ~2 keeps neighbors dominant without hard cell edges.
 */
export function bakeDiffuseMesh(
  width: number,
  height: number,
  points: MeshPoint[],
  globalOpacityPct = 100
): HTMLCanvasElement {
  const w = Math.max(1, Math.round(width));
  const h = Math.max(1, Math.round(height));
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (!ctx || points.length === 0) return canvas;

  const pts = points.map((p) => {
    const [r, g, b] = parseRgb(p.color);
    return {
      x: (clampPct(p.x) / 100) * (w - 1),
      y: (clampPct(p.y) / 100) * (h - 1),
      r,
      g,
      b,
      a: clampOpacityPct(p.opacity ?? 100) / 100,
    };
  });

  const img = ctx.createImageData(w, h);
  const data = img.data;
  const alphaScale = Math.min(100, Math.max(0, globalOpacityPct)) / 100;
  const power = 2.2;

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let wr = 0;
      let wg = 0;
      let wb = 0;
      let wa = 0;
      let wsum = 0;
      for (const p of pts) {
        const dx = x - p.x;
        const dy = y - p.y;
        const d2 = dx * dx + dy * dy;
        const weight = 1 / (Math.pow(d2, power / 2) + 1e-3);
        wr += p.r * weight;
        wg += p.g * weight;
        wb += p.b * weight;
        wa += p.a * weight;
        wsum += weight;
      }
      const i = (y * w + x) * 4;
      data[i] = Math.round(wr / wsum);
      data[i + 1] = Math.round(wg / wsum);
      data[i + 2] = Math.round(wb / wsum);
      data[i + 3] = Math.round(255 * (wa / wsum) * alphaScale);
    }
  }
  ctx.putImageData(img, 0, 0);
  return canvas;
}

/** Bake mesh to a data URL for SVG `<pattern>` / `<image>` fills. */
export function bakeDiffuseMeshDataUrl(
  points: MeshPoint[],
  nodeWidth: number,
  nodeHeight: number,
  globalOpacityPct = 100
): { dataUrl: string; width: number; height: number } {
  const w = Math.max(1, Number(nodeWidth) || 120);
  const h = Math.max(1, Number(nodeHeight) || 120);
  const maxSide = 384;
  const scale = Math.min(1, maxSide / Math.max(w, h));
  const cw = Math.max(1, Math.round(w * scale));
  const ch = Math.max(1, Math.round(h * scale));
  const source = bakeDiffuseMesh(cw, ch, points, globalOpacityPct);
  return { dataUrl: source.toDataURL('image/png'), width: w, height: h };
}

export function meshPreviewDataUrl(
  points: MeshPoint[],
  size = 160,
  globalOpacityPct = 100
): string {
  return bakeDiffuseMesh(size, size, points, globalOpacityPct).toDataURL('image/png');
}
