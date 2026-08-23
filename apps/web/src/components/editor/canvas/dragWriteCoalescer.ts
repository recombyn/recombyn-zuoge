import type { VideoGeomOverride } from '@/components/editor/nodes/VideoNode/VideoNodeOverlay';

/** Stores the latest synchronous HTML-media geometry during an SVG drag. */
export function createDragWriteCoalescer(
  apply: (batch: { videoGeom: Record<string, VideoGeomOverride> | null }) => void
) {
  /** Latest intended video overrides (kept for merge-on-move / angle preview). */
  let pendingVideo: Record<string, VideoGeomOverride> | null = null;

  return {
    queueVideoGeom(next: Record<string, VideoGeomOverride> | null) {
      pendingVideo = next;
      apply({ videoGeom: next });
    },
    getPendingVideoGeom() {
      return pendingVideo;
    },
    /** Drop pending work without applying (commit owns the final document). */
    cancel() {
      pendingVideo = null;
    },
  };
}
