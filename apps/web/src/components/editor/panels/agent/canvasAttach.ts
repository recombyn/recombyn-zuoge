import {
  buildComposerContext,
  enrichComposerContextThumb,
  rasterizeNodesToPngDataUrl,
  type ComposerContext,
} from '@/components/editor/panels/AgentComposerInput';
import {
  canAttachNodeToChat
} from '@/components/rcb/scene/document/mediaLifecycle';
import {
  captureVideoPosterFrame
} from '@/components/rcb/scene/document/nodeFactories';
import {
  listGroupMemberIds,
  readNodeGroupId
} from '@/components/rcb/scene/document/sceneGroups';
import { imageSrcToFile } from '@/utils/uploadImage';
import type { SceneDocument } from '@/components/rcb/sceneNode';

/**
 * Canvas → composer:
 * - single image / video → attachment strip (not inline input chip)
 * - multi-select (incl. ad-hoc) → one「组」chip + composite preview (not per-image uploads)
 * - formal groupId → same「组」chip
 * - single shape / frame → context chip with thumb
 */
export function canvasAttachToken(payload: string | string[]): string {
  return Array.isArray(payload) ? `arr:${payload.map(String).join('\0')}` : `one:${payload}`;
}

/** Full member ids when every selected id shares one groupId; otherwise null. */
function sharedGroupAttachIds(doc: SceneDocument, ids: string[]): string[] | null {
  if (!doc || !ids || ids.length < 2) return null;
  const first = readNodeGroupId(doc?.deltaSetLike?.[ids[0]]);
  if (!first) return null;
  if (!ids.every((id) => readNodeGroupId(doc?.deltaSetLike?.[id]) === first)) return null;
  const members = listGroupMemberIds(doc, first);
  return members.length >= 2 ? members : ids;
}

async function buildCanvasVideoAttachment(
  doc: SceneDocument,
  id: string,
  existingChips: ComposerContext[]
): Promise<ComposerContext | null> {
  const node = doc?.deltaSetLike?.[id];
  const src = String(node?.attrs?.src || '').trim();
  if (node?.key !== 'video' || !src) return null;
  const labeled = buildComposerContext(doc, [id], null, existingChips);
  let thumb = String(node?.attrs?.poster || '').trim();
  if (!thumb) {
    try {
      thumb = await captureVideoPosterFrame(src);
    } catch {
      /* thumb optional */
    }
  }
  return {
    key: `attach:canvas:${id}:${Date.now()}`,
    label: labeled?.label || id,
    kind: 'attachment',
    payload: `[Canvas video]\nid: ${id}${labeled?.payload ? `\n${labeled.payload}` : ''}`,
    dataUrl: src,
    thumbUrl: thumb || undefined,
    uploadStatus: 'ready',
  };
}

async function attachGroupAsComposerChip(opts: {
  doc: SceneDocument;
  groupIds: string[];
  existingChips: ComposerContext[];
  insertChip: (ctx: ComposerContext) => void;
}): Promise<boolean> {
  const { doc, groupIds, existingChips, insertChip } = opts;
  if (groupIds.length < 2) return false;
  const base = buildComposerContext(doc, groupIds, null, existingChips);
  if (!base) return false;
  let ctx = await enrichComposerContextThumb(doc, base, { nodeIds: groupIds });
  if (ctx && !String(ctx.dataUrl || '').trim()) {
    const dataUrl = await rasterizeNodesToPngDataUrl(doc, groupIds);
    if (dataUrl) {
      ctx = { ...ctx, dataUrl, thumbUrl: String(ctx.thumbUrl || '').trim() || dataUrl };
    }
  }
  insertChip(ctx || base);
  return true;
}

export async function applyCanvasAttachPayload(opts: {
  document: SceneDocument;
  payload: string | string[];
  existingChips: ComposerContext[];
  onAttachFiles: (files: File[], opts?: { mention?: boolean }) => void | Promise<void>;
  insertChip: (ctx: ComposerContext) => void;
  /** Canvas video → strip attachment without re-upload / file-type gates. */
  pushAttachment?: (att: ComposerContext) => void;
  /** Image chat mode — reject video nodes (same as image generator pick). */
  imagesOnly?: boolean;
}) {
  const {
    document: doc,
    payload,
    existingChips,
    onAttachFiles,
    insertChip,
    pushAttachment,
    imagesOnly = false,
  } = opts;
  let ids: string[] = [];
  let frameId: string | null = null;
  if (Array.isArray(payload)) {
    ids = payload.map(String).filter(Boolean);
  } else if (String(payload).startsWith('frame:')) {
    frameId = String(payload).slice('frame:'.length);
  } else {
    ids = [String(payload)];
  }

  if (frameId) {
    const base = buildComposerContext(doc, [], frameId, existingChips);
    const ctx = await enrichComposerContextThumb(doc, base, { frameId });
    if (ctx) insertChip(ctx);
    return;
  }

  const attachable = ids.filter((id) =>
    canAttachNodeToChat(doc?.deltaSetLike?.[id], { imagesOnly })
  );
  if (!attachable.length) return;

  const attachOneVideo = async (id: string) => {
    const att = await buildCanvasVideoAttachment(doc, id, existingChips);
    if (!att) return;
    if (pushAttachment) {
      pushAttachment(att);
      return;
    }
    const src = String(att.dataUrl || '').trim();
    if (!src) return;
    try {
      await onAttachFiles([await imageSrcToFile(src, `canvas-${id}.mp4`)]);
    } catch {
      /* ignore */
    }
  };

  // Formal groupId → one「组」chip.
  const groupIds = sharedGroupAttachIds(doc, attachable);
  if (groupIds) {
    await attachGroupAsComposerChip({
      doc,
      groupIds,
      existingChips,
      insertChip,
    });
    return;
  }

  // Ad-hoc multi-select → one「组」chip; peel videos only (never rasterize video into group PNG).
  if (attachable.length > 1) {
    const videos: string[] = [];
    const rest: string[] = [];
    for (const id of attachable) {
      const node = doc?.deltaSetLike?.[id];
      const src = String(node?.attrs?.src || '').trim();
      if (!imagesOnly && node?.key === 'video' && src) videos.push(id);
      else rest.push(id);
    }

    for (const id of videos) {
      await attachOneVideo(id);
    }

    if (rest.length > 1) {
      await attachGroupAsComposerChip({
        doc,
        groupIds: rest,
        existingChips,
        insertChip,
      });
      return;
    }

    if (rest.length === 1) {
      const id = rest[0]!;
      const node = doc?.deltaSetLike?.[id];
      if (imagesOnly && node?.key === 'video') return;
      const src = String(node?.attrs?.src || '').trim();
      if (node?.key === 'image' && src) {
        try {
          await onAttachFiles([await imageSrcToFile(src, `canvas-${id}.png`)]);
          return;
        } catch {
          /* fall through to chip */
        }
      }
      const base = buildComposerContext(doc, [id], null, existingChips);
      const ctx = await enrichComposerContextThumb(doc, base, { nodeIds: [id] });
      if (ctx) insertChip(ctx);
      return;
    }

    return;
  }

  const id = attachable[0]!;
  const node = doc?.deltaSetLike?.[id];
  if (imagesOnly && node?.key === 'video') return;
  const src = String(node?.attrs?.src || '').trim();
  if (node?.key === 'image' && src) {
    try {
      await onAttachFiles([await imageSrcToFile(src, `canvas-${id}.png`)]);
      return;
    } catch {
      /* fall through to chip */
    }
  }

  if (!imagesOnly && node?.key === 'video' && src) {
    await attachOneVideo(id);
    return;
  }

  const base = buildComposerContext(doc, [id], null, existingChips);
  const ctx = await enrichComposerContextThumb(doc, base, { nodeIds: [id] });
  if (ctx) insertChip(ctx);
}
