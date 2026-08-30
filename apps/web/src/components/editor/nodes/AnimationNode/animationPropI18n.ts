/** Translate Lottie transform prop keys for timeline / keyframe UI. */

const PROP_DEFAULTS: Record<string, string> = {
  p: 'Position',
  s: 'Scale',
  r: 'Rotation',
  o: 'Opacity',
  a: 'Anchor',
  sk: 'Skew',
  sa: 'Skew Axis',
  ts: 'Trim Start',
  te: 'Trim End',
  to: 'Trim Offset',
  puppet: 'Puppet',
};

type TranslateFn = (key: string, opts?: { defaultValue?: string }) => string;

export function translateLottiePropLabel(
  t: TranslateFn,
  propKey: string,
  fallback?: string
): string {
  const key = String(propKey || '').trim();
  const def = fallback || PROP_DEFAULTS[key] || key;
  if (!key) return def;
  return t(`editor.lottieTimeline.prop.${key}`, { defaultValue: def });
}
