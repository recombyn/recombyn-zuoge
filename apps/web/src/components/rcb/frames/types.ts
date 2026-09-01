/** Editor artboard frame (document.frames). Canvas domain — not the editor store-specific. */

/**
 * Idle artboard plate chrome — screen-constant hairline (not closed-rect #333).
 * World camera uses CSS `scale(zoom)`, so `vector-effect: non-scaling-stroke`
 * still thickens under zoom. Paint stroke in **scene** units = CSS_px / zoom.
 */
export const FRAME_PLATE_STROKE = 'color-mix(in srgb, var(--ink) 28%, transparent)';
/** Soft interior / context focus — same blue as selection chrome edge. */
export const FRAME_HIGHLIGHT_STROKE = '#3388ff';
/** Target hairline in CSS px after camera scale. */
export const FRAME_PLATE_STROKE_WIDTH = 1;

/** Scene stroke width so CSS `scale(zoom)` yields ~FRAME_PLATE_STROKE_WIDTH CSS px. */
export function framePlateStrokeSceneWidth(zoom: number): number {
  return FRAME_PLATE_STROKE_WIDTH / Math.max(0.05, Number(zoom) || 1);
}

export type ArtboardFrame = {
  id: string;
  name: string;
  x: number;
  y: number;
  width: number;
  height: number;
  backgroundColor: string;
  /** Artboard fill alpha, stored as a percentage from 0 to 100. */
  backgroundOpacity?: number;
  /**
   * Plate role. `animation` = 动画工作台 (same HtmlArtboardFrame + clip,
   * different selection toolbar). `lottie` is legacy alias for the same plate.
   * Default / omitted = normal artboard.
   */
  kind?: 'artboard' | 'animation' | 'lottie';
  /** 动画工作台 composition length (seconds). */
  durationSec?: number;
  /** 动画工作台 frame rate. */
  fps?: number;
  layoutMode?: 'auto' | 'manual';
  /** When true, frame cannot be moved or resized. */
  locked?: boolean;
  /** When true, artboard plate + chrome are hidden (layer panel eye). */
  hidden?: boolean;
  /** When true, drag-resize / W·H edits keep width:height (Shift temporarily unlocks). */
  lockAspect?: boolean;
  /** When true, content outside the frame bounds is clipped (hidden). */
  clipContent?: boolean;
  /** Size before first ratio preset — restored by 「原始」. */
  aspectOriginalWidth?: number;
  aspectOriginalHeight?: number;
  /**
   * Legacy artboard generating chrome. AI overlay now lives in editor
   * `aiOperationState` (ephemeral). Kept so old Yjs/clipboard docs can strip it.
   */
  processStatus?: 'running' | null;
  processLabel?: string;
  processKind?: 'design' | 'import' | string;
};

/** True for 动画工作台 plates (`animation` or legacy `lottie`). */
export function isAnimationArtboardKind(
  kind: ArtboardFrame['kind'] | string | null | undefined
): boolean {
  return kind === 'animation' || kind === 'lottie';
}
