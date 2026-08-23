/** Scene document fields for image layer masks (read-only; OSS-safe). */

export type LayerMaskAttrs = {
  maskSrc?: unknown;
  maskKey?: unknown;
  maskEnabled?: unknown;
};

export function readMaskSrc(attrs: LayerMaskAttrs | undefined | null): string {
  return String(attrs?.maskSrc || '').trim();
}

export function readMaskKey(attrs: LayerMaskAttrs | undefined | null): string | null {
  const key = String(attrs?.maskKey || '').trim();
  return key || null;
}

export function isMaskEnabled(attrs: LayerMaskAttrs | undefined | null): boolean {
  if (!readMaskSrc(attrs)) return false;
  return String(attrs?.maskEnabled || 'true') !== 'false';
}

export function hasLayerMask(attrs: LayerMaskAttrs | undefined | null): boolean {
  return Boolean(readMaskSrc(attrs));
}
