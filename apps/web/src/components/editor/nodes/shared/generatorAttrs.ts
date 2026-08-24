export function readGenAttrString(
  attrs: Record<string, unknown> | null | undefined,
  key: string
): string {
  const raw = attrs?.[key];
  return typeof raw === 'string' && raw.trim() ? raw.trim() : '';
}

export function readGenAttrCount(
  attrs: Record<string, unknown> | null | undefined,
  key = 'imageGenCount',
  min = 1,
  max = 4
): number | null {
  const raw = attrs?.[key];
  const n = typeof raw === 'number' ? raw : Number(raw);
  if (!Number.isFinite(n)) return null;
  return Math.max(min, Math.min(max, Math.round(n)));
}

export function readGenAttrDuration(
  attrs: Record<string, unknown> | null | undefined,
  key: string,
  min: number,
  max: number
): number | null {
  const raw = attrs?.[key];
  const n = typeof raw === 'number' ? raw : Number(raw);
  if (!Number.isFinite(n)) return null;
  return Math.max(min, Math.min(max, Math.round(n)));
}

export function ratioSummaryLabel(aspectRatio: string, t: (k: string) => string): string {
  const raw = String(aspectRatio || '').trim();
  if (raw === 'smart') return t('agent.ratioSmart');
  if (/^\d+x\d+$/i.test(raw)) {
    const [a, b] = raw.toLowerCase().split('x');
    return `${a}×${b}`;
  }
  return raw || '1:1';
}
