/**
 * Editor undo/redo history stack (snap + node-patch COW + paste-add entries).
 */
import {
  addNodesToDocument,
  flattenDeltaSetLike,
  patchDeltaSetLike,
  removeNodesFromDocument,
} from '@/components/rcb/scene/document/sceneDocument';
import type { ArtboardFrame } from '@/components/rcb/frames/types';
import type { SceneDocument, SceneNode, SceneNodeInput, ScenePage } from '@/components/rcb/sceneNode';

/** Soft cap — prefer bytes over entry count for heavy path docs. */
export const HISTORY_MAX_ENTRIES = 24;
export const HISTORY_MAX_BYTES = 32 * 1024 * 1024;
/** Large scenes: fewer full snaps so undo does not multiply O(N) heap. */
export const HISTORY_MAX_ENTRIES_LARGE = 8;
export const HISTORY_MAX_ENTRIES_HUGE = 4;
export const HISTORY_LARGE_NODE_THRESHOLD = 2000;
export const HISTORY_HUGE_NODE_THRESHOLD = 5000;

/** Full-doc snapshot (structural ops) or before-nodes for patch undo. */
export type HistorySnap = { kind: 'snap'; doc: SceneDocument };
export type HistoryNodes = { kind: 'nodes'; before: Record<string, SceneNode> };
/**
 * Paste / duplicate add — store only inserted nodes (+ frames).
 * Undo removes ids (O(paste)); redo re-inserts. Avoids O(doc) full snaps at 10k.
 */
export type HistoryAdd = {
  kind: 'add';
  nodes: Record<string, SceneNode>;
  frames?: ArtboardFrame[];
};
/**
 * Cut / delete — store only removed nodes (+ frames).
 * Undo re-inserts (O(cut)); redo removes again. Same payload shape as add.
 */
export type HistoryRemove = {
  kind: 'remove';
  nodes: Record<string, SceneNode>;
  frames?: ArtboardFrame[];
};
export type HistoryEntry = HistorySnap | HistoryNodes | HistoryAdd | HistoryRemove;

/** Minimal state shape history helpers mutate. */
export type EditorHistoryHost = {
  document: SceneDocument | null;
  historyPast: HistoryEntry[];
  historyFuture: HistoryEntry[];
};

export function isHistoryEntry(x: unknown): x is HistoryEntry {
  if (!x || typeof x !== 'object') return false;
  const kind = (x as HistoryEntry).kind;
  return kind === 'snap' || kind === 'nodes' || kind === 'add' || kind === 'remove';
}

/** Accept raw-document entries still sitting in session state. */
export function asHistoryEntry(x: unknown): HistoryEntry {
  if (isHistoryEntry(x)) return x;
  return { kind: 'snap', doc: x as SceneDocument };
}

export function cloneNodeForHistory(node: SceneNodeInput): SceneNode {
  if (!node || typeof node !== 'object') {
    return node as SceneNode;
  }
  const attrs = node.attrs;
  return {
    ...(node as SceneNode),
    attrs: attrs && typeof attrs === 'object' ? { ...attrs } : (attrs as SceneNode['attrs']),
    children: Array.isArray(node.children) ? [...node.children] : ((node.children as string[]) || []),
  };
}

function cloneFrameForHistory(frame: ArtboardFrame): ArtboardFrame {
  return { ...frame };
}

function sharedStringBytes(raw: unknown, seenPaths: Set<string> | undefined, cap = 0): number {
  const s = raw != null ? String(raw) : '';
  if (!s) return 0;
  const len = cap > 0 ? Math.min(s.length, cap) : s.length;
  if (!seenPaths) return len;
  if (seenPaths.has(s)) return 0;
  seenPaths.add(s);
  return len;
}

/** Rough node payload; `seenPaths` dedupes shared path / media strings across the stack. */
export function estimateNodeBytes(
  node: SceneNodeInput | null | undefined,
  seenPaths?: Set<string>
): number {
  if (!node) return 0;
  const attrs = node.attrs;
  if (!attrs) return 128;
  let n = 192;
  n += sharedStringBytes(attrs.path, seenPaths);
  n += sharedStringBytes(attrs.markdown, seenPaths);
  n += sharedStringBytes(attrs.DATA, seenPaths);
  // data: URLs are huge and often shared across stress injects — count once.
  n += sharedStringBytes(attrs.src, seenPaths, 4096);
  n += sharedStringBytes(attrs.poster, seenPaths, 4096);
  return n;
}

function historyEntryCapForLiveNodes(liveNodes: number): number {
  if (liveNodes >= HISTORY_HUGE_NODE_THRESHOLD) return HISTORY_MAX_ENTRIES_HUGE;
  if (liveNodes >= HISTORY_LARGE_NODE_THRESHOLD) return HISTORY_MAX_ENTRIES_LARGE;
  return HISTORY_MAX_ENTRIES;
}

export function estimateDocumentBytes(
  doc: SceneDocument | null | undefined,
  seenPaths?: Set<string>
): number {
  if (!doc?.deltaSetLike) return 0;
  let n = 0;
  for (const id of Object.keys(doc.deltaSetLike)) {
    n += estimateNodeBytes(doc.deltaSetLike[id], seenPaths);
  }
  return n;
}

export function estimateHistoryEntryBytes(entry: unknown, seenPaths?: Set<string>): number {
  const e = asHistoryEntry(entry);
  if (e.kind === 'nodes') {
    let n = 64;
    for (const id of Object.keys(e.before)) {
      n += estimateNodeBytes(e.before[id], seenPaths);
    }
    return n;
  }
  if (e.kind === 'add' || e.kind === 'remove') {
    let n = 64;
    for (const id of Object.keys(e.nodes)) {
      n += estimateNodeBytes(e.nodes[id], seenPaths);
    }
    n += (e.frames?.length || 0) * 96;
    return n;
  }
  return estimateDocumentBytes(e.doc, seenPaths);
}

function clonePageForHistory(page: ScenePage): ScenePage {
  return {
    ...page,
    children: Array.isArray(page.children) ? [...page.children] : page.children,
  };
}

/**
 * History snapshot with structural sharing of immutable path strings.
 * Avoids JSON.parse(JSON.stringify) which dominated edit cost at 5k–10k nodes.
 */
export function cloneDocumentForHistory(
  doc: SceneDocument | null | undefined
): SceneDocument | null {
  if (!doc) return null;
  const delta = flattenDeltaSetLike(doc.deltaSetLike || {});
  const nextDelta: Record<string, SceneNode> = {};
  for (const key of Object.keys(delta)) {
    const node = delta[key];
    if (!node || typeof node !== 'object') continue;
    nextDelta[key] = cloneNodeForHistory(node as SceneNode);
  }
  const frames = Array.isArray(doc.frames)
    ? doc.frames.map((f) => (f && typeof f === 'object' ? { ...f } : f))
    : doc.frames;
  const pages = Array.isArray(doc.pages)
    ? doc.pages.map((p) => (p && typeof p === 'object' ? clonePageForHistory(p) : p))
    : doc.pages;
  return {
    ...doc,
    frames,
    pages,
    stackOrder: Array.isArray(doc.stackOrder) ? [...doc.stackOrder] : doc.stackOrder,
    deltaSetLike: nextDelta,
  };
}

export function cloneDocument(doc: SceneDocument | null | undefined): SceneDocument | null {
  return cloneDocumentForHistory(doc);
}

export function trimHistoryPast(state: EditorHistoryHost) {
  const liveNodes = Object.keys(state.document?.deltaSetLike || {}).length;
  const entryCap = historyEntryCapForLiveNodes(liveNodes);
  while (state.historyPast.length > entryCap) state.historyPast.shift();
  const seen = new Set<string>();
  let bytes = 0;
  for (let i = state.historyPast.length - 1; i >= 0; i -= 1) {
    bytes += estimateHistoryEntryBytes(state.historyPast[i], seen);
    if (bytes > HISTORY_MAX_BYTES && i > 0) {
      state.historyPast.splice(0, i);
      break;
    }
  }
}

export function pushHistory(state: EditorHistoryHost) {
  if (!state.document) return;
  const snap = cloneDocument(state.document);
  if (!snap) return;
  state.historyPast.push({ kind: 'snap', doc: snap } satisfies HistorySnap);
  trimHistoryPast(state);
  state.historyFuture = [];
}

/** Patch undo: store only touched nodes (share path strings with live doc). */
export function pushNodePatchHistory(state: EditorHistoryHost, nodeIds: string[]) {
  if (!state.document) return;
  const before: Record<string, SceneNode> = {};
  for (const raw of nodeIds) {
    const id = String(raw || '');
    if (!id) continue;
    const node = state.document.deltaSetLike?.[id];
    if (!node) continue;
    before[id] = cloneNodeForHistory(node);
  }
  if (!Object.keys(before).length) {
    pushHistory(state);
    return;
  }
  state.historyPast.push({ kind: 'nodes', before } satisfies HistoryNodes);
  trimHistoryPast(state);
  state.historyFuture = [];
}

/**
 * Paste / duplicate: snapshot only the inserted nodes (+ frames).
 * Falls back to full snap when there is nothing to record.
 */
export function pushAddHistory(
  state: EditorHistoryHost,
  opts: {
    nodeIds: readonly string[];
    frameIds?: readonly string[];
    /** Document that already contains the adds (usually post-paste). */
    fromDocument?: SceneDocument | null;
  }
) {
  const doc = opts.fromDocument ?? state.document;
  if (!doc?.deltaSetLike) {
    pushHistory(state);
    return;
  }
  const nodes: Record<string, SceneNode> = {};
  for (const raw of opts.nodeIds) {
    const id = String(raw || '').trim();
    if (!id) continue;
    const node = doc.deltaSetLike[id];
    if (!node) continue;
    nodes[id] = cloneNodeForHistory(node);
  }
  const frameIdSet = new Set(
    (opts.frameIds || []).map((id) => String(id || '').trim()).filter(Boolean)
  );
  const frames: ArtboardFrame[] = [];
  if (frameIdSet.size && Array.isArray(doc.frames)) {
    for (const f of doc.frames) {
      const id = String(f?.id || '').trim();
      if (!id || !frameIdSet.has(id)) continue;
      frames.push(cloneFrameForHistory(f as ArtboardFrame));
    }
  }
  if (!Object.keys(nodes).length && !frames.length) {
    pushHistory(state);
    return;
  }
  state.historyPast.push({
    kind: 'add',
    nodes,
    ...(frames.length ? { frames } : {}),
  } satisfies HistoryAdd);
  trimHistoryPast(state);
  state.historyFuture = [];
}

/**
 * Cut / delete: snapshot only the removed nodes (+ frames) before they leave the doc.
 * Falls back to full snap when there is nothing to record.
 */
export function pushRemoveHistory(
  state: EditorHistoryHost,
  opts: {
    nodeIds: readonly string[];
    frameIds?: readonly string[];
    /** Document that still contains the removals (pre-delete). */
    fromDocument?: SceneDocument | null;
  }
) {
  const doc = opts.fromDocument ?? state.document;
  if (!doc?.deltaSetLike) {
    pushHistory(state);
    return;
  }
  const nodes: Record<string, SceneNode> = {};
  for (const raw of opts.nodeIds) {
    const id = String(raw || '').trim();
    if (!id) continue;
    const node = doc.deltaSetLike[id];
    if (!node) continue;
    nodes[id] = cloneNodeForHistory(node);
  }
  const frameIdSet = new Set(
    (opts.frameIds || []).map((id) => String(id || '').trim()).filter(Boolean)
  );
  const frames: ArtboardFrame[] = [];
  if (frameIdSet.size && Array.isArray(doc.frames)) {
    for (const f of doc.frames) {
      const id = String(f?.id || '').trim();
      if (!id || !frameIdSet.has(id)) continue;
      frames.push(cloneFrameForHistory(f as ArtboardFrame));
    }
  }
  if (!Object.keys(nodes).length && !frames.length) {
    pushHistory(state);
    return;
  }
  state.historyPast.push({
    kind: 'remove',
    nodes,
    ...(frames.length ? { frames } : {}),
  } satisfies HistoryRemove);
  trimHistoryPast(state);
  state.historyFuture = [];
}

export function restoreNodesIntoDocument(
  doc: SceneDocument,
  nodes: Record<string, SceneNode>
): SceneDocument {
  if (!doc?.deltaSetLike || !nodes) return doc;
  return {
    ...doc,
    deltaSetLike: patchDeltaSetLike(doc.deltaSetLike, nodes),
  };
}

/** Undo a paste-add entry: drop inserted nodes + frames. */
export function undoAddHistoryEntry(
  doc: SceneDocument,
  entry: HistoryAdd
): SceneDocument {
  const ids = Object.keys(entry.nodes || {});
  let next = ids.length ? (removeNodesFromDocument(doc, ids) as SceneDocument) : doc;
  const frameIds = (entry.frames || [])
    .map((f) => String(f?.id || '').trim())
    .filter(Boolean);
  if (!frameIds.length) return next;
  const idSet = new Set(frameIds);
  const frames = (Array.isArray(next.frames) ? next.frames : []).filter(
    (f) => f && !idSet.has(String(f.id))
  );
  let stackOrder = Array.isArray(next.stackOrder) ? next.stackOrder : undefined;
  if (stackOrder) {
    stackOrder = stackOrder.filter((key) => {
      const k = String(key);
      if (!k.startsWith('frame:')) return true;
      return !idSet.has(k.slice(6));
    });
  }
  let activeFrameId = next.activeFrameId;
  if (activeFrameId && idSet.has(String(activeFrameId))) {
    activeFrameId = frames[0]?.id ?? null;
  }
  return {
    ...next,
    frames,
    ...(stackOrder ? { stackOrder } : {}),
    activeFrameId,
  };
}

/** Redo a paste-add entry: re-insert nodes + frames. */
export function redoAddHistoryEntry(
  doc: SceneDocument,
  entry: HistoryAdd
): SceneDocument {
  const list = Object.entries(entry.nodes || {}).map(([id, node]) => ({ id, node }));
  let next = list.length ? (addNodesToDocument(doc, list) as SceneDocument) : doc;
  const framesIn = entry.frames || [];
  if (!framesIn.length) return next;
  const existing = new Set(
    (Array.isArray(next.frames) ? next.frames : []).map((f) => String(f?.id || ''))
  );
  const toAdd = framesIn.filter((f) => {
    const id = String(f?.id || '').trim();
    return id && !existing.has(id);
  });
  if (!toAdd.length) return next;
  const frames = [
    ...(Array.isArray(next.frames) ? next.frames : []),
    ...toAdd.map(cloneFrameForHistory),
  ];
  let stackOrder = Array.isArray(next.stackOrder) ? [...next.stackOrder] : [];
  const orderSet = new Set(stackOrder.map(String));
  for (const f of toAdd) {
    const key = `frame:${f.id}`;
    if (!orderSet.has(key)) {
      stackOrder.push(key);
      orderSet.add(key);
    }
  }
  return { ...next, frames, stackOrder };
}

/** Strip nodes from every history entry so Undo cannot revive them. */
export function scrubNodeIdsFromHistory(state: EditorHistoryHost, ids: string[]) {
  if (!ids.length) return;
  const idSet = new Set(ids.map(String));
  const scrub = (raw: HistoryEntry): HistoryEntry => {
    const entry = asHistoryEntry(raw);
    if (entry.kind === 'nodes') {
      let changed = false;
      const before: Record<string, SceneNode> = { ...entry.before };
      for (const id of idSet) {
        if (id in before) {
          delete before[id];
          changed = true;
        }
      }
      return changed ? { kind: 'nodes' as const, before } : entry;
    }
    if (entry.kind === 'add' || entry.kind === 'remove') {
      let changed = false;
      const nodes: Record<string, SceneNode> = { ...entry.nodes };
      for (const id of idSet) {
        if (id in nodes) {
          delete nodes[id];
          changed = true;
        }
      }
      return changed
        ? { kind: entry.kind, nodes, frames: entry.frames }
        : entry;
    }
    const doc = entry.doc;
    if (!doc?.deltaSetLike) return entry;
    const hit = ids.some((id) => Boolean(doc.deltaSetLike[id]));
    if (!hit) return entry;
    return {
      kind: 'snap' as const,
      doc: removeNodesFromDocument(doc, [...idSet]) as SceneDocument,
    };
  };
  state.historyPast = state.historyPast.map(scrub);
  state.historyFuture = state.historyFuture.map(scrub);
}
