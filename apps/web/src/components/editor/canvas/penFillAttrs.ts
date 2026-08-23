/** Closed pen path fill visibility from toolbar fill color. */
export function closedPenFillAttrs(fillColor: string): Record<string, string> {
  const enabled = fillColor !== 'transparent' ? 'true' : 'false';
  return {
    'fill-enabled': enabled,
    'fill-visible': enabled,
  };
}
