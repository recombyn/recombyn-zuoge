import { boolEffectAttr } from '@/components/rcb/scene/document/sceneEffects';

/** Closed pen path fill visibility from toolbar fill color. */
export function closedPenFillAttrs(fillColor: string): Record<string, string> {
  const enabled = fillColor !== 'transparent' ? 'true' : 'false';
  return {
    'fill-enabled': enabled,
    'fill-visible': enabled,
  };
}

export function pathNodeHasSolidFill(
  attrs: Record<string, unknown> | null | undefined
): boolean {
  if (!attrs) return false;
  if (!boolEffectAttr(attrs['fill-enabled'], true)) return false;
  if (!boolEffectAttr(attrs['fill-visible'], true)) return false;
  const fill = attrs.fill ?? attrs['fill-color'] ?? attrs.fillColor;
  const s = String(fill || '')
    .trim()
    .toLowerCase();
  return Boolean(s && s !== 'none' && s !== 'transparent' && s !== 'rgba(0,0,0,0)');
}
