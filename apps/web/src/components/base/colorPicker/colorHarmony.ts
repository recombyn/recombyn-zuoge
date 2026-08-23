import { hsvToRgb, rgbToHsv, rgbaToHex, hexToRgba, type Hsv } from '@/components/base/colorPanel';

export type ColorHarmonyRule =
  | 'custom'
  | 'analogous'
  | 'monochromatic'
  | 'complementary'
  | 'triad'
  | 'square'
  | 'split';

export const HARMONY_RULES: ColorHarmonyRule[] = [
  'custom',
  'analogous',
  'monochromatic',
  'complementary',
  'triad',
  'square',
  'split',
];

/** Hue offsets (degrees) from the base color for each harmony rule. */
const HARMONY_OFFSETS: Record<ColorHarmonyRule, number[]> = {
  custom: [0],
  analogous: [-30, -15, 0, 15, 30],
  monochromatic: [0],
  complementary: [0, 180],
  triad: [0, 120, 240],
  square: [0, 90, 180, 270],
  split: [0, 150, 210],
};

export function harmonyOffsets(rule: ColorHarmonyRule): number[] {
  return HARMONY_OFFSETS[rule];
}

export function normalizeHue(h: number): number {
  return ((h % 360) + 360) % 360;
}

export function hsvFromHex(hex: string): Hsv {
  return rgbToHsv(hexToRgba(hex));
}

export function hexFromHsv(hsv: Hsv): string {
  return rgbaToHex(hsvToRgb(hsv));
}

export function harmonyHues(baseHue: number, rule: ColorHarmonyRule): number[] {
  return harmonyOffsets(rule).map((offset) => normalizeHue(baseHue + offset));
}

export function harmonyColorsFromBase(hex: string, rule: ColorHarmonyRule): string[] {
  const base = hsvFromHex(hex);
  return harmonyHues(base.h, rule).map((h) => hexFromHsv({ ...base, h }));
}

/** Polar coords on the wheel → HSV (0° hue at top). */
export function polarToHsv(
  cx: number,
  cy: number,
  x: number,
  y: number,
  maxRadius: number
): Hsv {
  const dx = x - cx;
  const dy = y - cy;
  const dist = Math.min(maxRadius, Math.hypot(dx, dy));
  const angle = Math.atan2(dy, dx);
  const hue = normalizeHue((angle * 180) / Math.PI + 90);
  const sat = Math.max(0.12, Math.min(1, dist / maxRadius));
  return { h: hue, s: sat, v: 1 };
}

/** HSV hue → wheel coordinates (0° at top). */
export function hueToWheelXY(
  cx: number,
  cy: number,
  radius: number,
  hue: number
): { x: number; y: number } {
  const rad = ((hue - 90) * Math.PI) / 180;
  return { x: cx + radius * Math.cos(rad), y: cy + radius * Math.sin(rad) };
}

export function harmonyRuleLabelKey(rule: ColorHarmonyRule): string {
  return `editor.colorHarmony.${rule}`;
}
