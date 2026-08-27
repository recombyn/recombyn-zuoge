/** Scene node attrs for smart mockup (PS-style warp, no session mode). */
export const MOCKUP_CHROME_STROKE = '#e67e22';

export function isMockupNodeActive(attrs: Record<string, unknown> | undefined | null): boolean {
  if (!attrs) return false;
  return attrs.mockupEnabled === true || attrs.mockupEnabled === 'true';
}
