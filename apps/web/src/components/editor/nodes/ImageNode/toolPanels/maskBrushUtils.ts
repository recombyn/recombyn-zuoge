/** Shared brush sizing for eraser / matting overlays. */

export function defaultBrushSize(box: { width: number; height: number }): number {
  const shortSide = Math.min(box.width, box.height);
  const scaled = shortSide * 0.12;
  const base = scaled > 0 ? scaled : 96;
  return Math.round(Math.min(280, Math.max(64, base)));
}

export function brushModeClass(active: boolean, tone: 'include' | 'exclude'): string {
  const base = 'flex-1 rounded-lg border px-2 py-1.5 text-xs font-medium transition-colors';
  if (!active) {
    return `${base} border-white/10 bg-white/5 text-white/70`;
  }
  if (tone === 'include') {
    return `${base} border-emerald-500/80 bg-emerald-500/15 text-emerald-200`;
  }
  return `${base} border-red-500/80 bg-red-500/15 text-red-200`;
}
