import {
  canAttachNodeToChat
} from '@/components/rcb/scene/document/mediaLifecycle';
import {
  expandSelectionWithGroups,
  readNodeGroupId
} from '@/components/rcb/scene/document/sceneGroups';
import { frameForFullBleedPlate as frameForFullBleedPlateId } from '@/components/rcb/scene/document/sceneHitBridge';
import type { SceneDocument } from '@/components/rcb/sceneNode';

/** Near-full-bleed plate covering an artboard — treat click as frame select.
 *  Rect / path / image backgrounds all count (vector artboards often use a path fill). */
export function frameForFullBleedPlate(doc: SceneDocument, nodeId: string): { id: string } | null {
  const id = frameForFullBleedPlateId(doc, nodeId);
  return id ? { id } : null;
}

/** Drop generator plates + process-shimmer (+ videos when images-only) from attach targets. */
export function filterChatAttachNodeIds(
  doc: SceneDocument,
  ids: string[],
  opts?: { imagesOnly?: boolean }
): string[] {
  const delta = doc?.deltaSetLike || {};
  return ids.filter((id) => canAttachNodeToChat(delta[id], opts));
}

/** Prefer live selection; fall back to the node under the context menu. */
export function ctxMenuSeedNodeIds(selectedIds: string[], menuNodeId?: string | null): string[] {
  if (selectedIds.length) return selectedIds;
  if (menuNodeId) return [menuNodeId];
  return [];
}

/** Prefer live artboard selection; fall back to the frame under the context menu. */
export function ctxMenuSeedFrameIds(selectedFrameIds: string[], menuFrameId?: string | null): string[] {
  if (selectedFrameIds.length) return selectedFrameIds;
  if (menuFrameId) return [menuFrameId];
  return [];
}

export type AttachPickOpts = { imagesOnly?: boolean };

/** Resolve a pick click into an attach payload, or null if empty / only blocked nodes. */
export function resolveAttachPickPayload(
  doc: SceneDocument,
  nodeIds: string[],
  frameId?: string | null,
  opts?: AttachPickOpts
): { payload: string | string[]; blockedOnly: boolean } | null {
  const raw = (nodeIds || []).filter(Boolean);
  // Ungrouped media: attach that file alone. Grouped members expand to the whole 编组
  // so the composer can attach one composite (not peel siblings into separate thumbs).
  if (raw.length === 1) {
    const hitId = raw[0]!;
    const hit = doc?.deltaSetLike?.[hitId];
    if (!readNodeGroupId(hit)) {
      const src = String(hit?.attrs?.src || '').trim();
      const mediaKey = hit?.key === 'video' || hit?.key === 'image';
      if (
        mediaKey &&
        src &&
        canAttachNodeToChat(hit, opts) &&
        !(opts?.imagesOnly && hit?.key === 'video')
      ) {
        return { payload: hitId, blockedOnly: false };
      }
    }
  }
  const seed = expandSelectionWithGroups(doc, raw);
  const attachable = filterChatAttachNodeIds(doc, seed, opts);
  if (attachable.length) {
    return {
      payload: attachable.length === 1 ? attachable[0]! : attachable,
      blockedOnly: false,
    };
  }
  if (seed.length) return { payload: '', blockedOnly: true };
  const fid = String(frameId || '').trim();
  if (fid) return { payload: `frame:${fid}`, blockedOnly: false };
  return null;
}

export function attachPickFilterOpts(
  pick: null | { target: string; accept?: 'image' | 'media' }
): AttachPickOpts | undefined {
  return pick?.accept === 'image' ? { imagesOnly: true } : undefined;
}
