/**
 * Tiny registry so sceneRenderBuffer ↔ sceneRenderer do not TDZ on circular load.
 */
import type { SceneNodeInput } from '@/components/rcb/sceneNode';

export type SoaTextInkPainter = (
  ctx: CanvasRenderingContext2D,
  opts: { node: SceneNodeInput; width: number; height: number; opacity?: number }
) => void;

let painter: SoaTextInkPainter | null = null;

export function setSoaTextInkPainter(fn: SoaTextInkPainter | null): void {
  painter = fn;
}

export function getSoaTextInkPainter(): SoaTextInkPainter | null {
  return painter;
}
