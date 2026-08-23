/** Persisted layer-mask fields on image node attrs. */

export type LayerMaskAttrs = {
  maskSrc?: unknown;
  maskKey?: unknown;
  /** `false` temporarily disables mask without deleting it. */
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
