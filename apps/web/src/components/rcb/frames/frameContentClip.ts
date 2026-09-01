import type { ArtboardFrame } from '@/components/rcb/frames/types';
import { getLiveArtboardFrameGeometry } from '@/components/rcb/frames/HtmlArtboardFrame';
import { ensureDefs, setAttrs, svgEl, urlRef } from '@/components/rcb/scene/paint/svgDom';

function num(v: unknown, fallback = 0): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

let clipSeq = 0;
function nextClipId(prefix: string) {
  clipSeq += 1;
  return `${prefix}-${clipSeq}`;
}

/**
 * Owning clipContent artboard for a node (`attrs.frameId`).
 * Live plate geometry overrides x/y/w/h while the frame is being dragged.
 */
export function findClippingFrameForNode(
  document: { frames?: ArtboardFrame[]; x?: number; y?: number } | null | undefined,
  node: Record<string, unknown> | null | undefined
): ArtboardFrame | null {
  if (!node || !document) return null;
  const frames = Array.isArray(document.frames) ? document.frames : [];
  if (!frames.length) return null;

  const explicitOwner = String(
    (node.attrs as Record<string, unknown> | undefined)?.frameId || ''
  ).trim();
  if (!explicitOwner) return null;
  const ownedFrame = frames.find((frame) => String(frame.id) === explicitOwner);
  if (!ownedFrame || !ownedFrame.clipContent || ownedFrame.hidden) return null;
  const live = getLiveArtboardFrameGeometry(String(ownedFrame.id || ''));
  const fx = num(live?.x ?? ownedFrame.x);
  const fy = num(live?.y ?? ownedFrame.y);
  const fw = Math.max(1, num(live?.width ?? ownedFrame.width, 1));
  const fh = Math.max(1, num(live?.height ?? ownedFrame.height, 1));
  // Always clip to the owning plate — even when the node AABB is fully outside
  // (otherwise idle SoA / mid-drag ink "runs out" of the workbench).
  if (!live) return ownedFrame;
  return {
    ...ownedFrame,
    x: fx,
    y: fy,
    width: fw,
    height: fh,
  };
}

/** Scene-space origin (matches nodeLeftTop / shape paint). */
function sceneOrigin(document: { x?: number; y?: number } | null | undefined) {
  return { ox: num(document?.x, 0), oy: num(document?.y, 0) };
}

function unwrapFrameClip(el: SVGElement) {
  let current: Element = el;
  // A preview can apply a new clip while React is reconciling the shared SVG.
  // Remove every stale wrapper around the node, including when another SVG
  // group sits between the host element and the wrapper.
  while (current.parentElement) {
    const wrapper = current.closest('[data-frame-clip-wrap="1"]');
    if (!wrapper || !wrapper.contains(current)) break;
    const parent = wrapper.parentNode;
    if (!parent) break;
    parent.insertBefore(current, wrapper);
    wrapper.remove();
  }
  current.removeAttribute('clip-path');
}

/**
 * Untransformed paint layer (`data-rcb-shape-id`). Clip here — not on a nested
 * wrap — so rotated paint stays correct and mix-blend on the paint node still
 * composites against sibling artboard plates.
 */
function resolveClipHost(el: SVGElement): SVGElement {
  let parent: Element | null = el.parentElement;
  while (parent?.getAttribute?.('data-frame-clip-wrap') === '1') {
    parent = parent.parentElement;
  }
  if (
    parent instanceof SVGElement &&
    (parent.hasAttribute('data-rcb-shape-id') ||
      parent.hasAttribute('data-rcb-shape-layer') ||
      parent.hasAttribute('data-rcb-frame-layer'))
  ) {
    return parent;
  }
  return el;
}

function clearHostClip(host: SVGElement) {
  host.removeAttribute('clip-path');
  try {
    host.style.removeProperty('clip-path');
  } catch {
    /* ignore */
  }
}

/** Remove any artboard clip without changing the painted node. */
export function clearFrameContentClip(el: SVGElement | null | undefined) {
  if (!el) return;
  const host = resolveClipHost(el);
  unwrapFrameClip(el);
  clearHostClip(host);
}

/** Remove a painted node (and its frame-clip wrap, if any). */
export function detachSceneNodeEl(el: Element | null | undefined) {
  if (!el) return;
  const wrap = el.parentElement;
  try {
    if (wrap?.getAttribute('data-frame-clip-wrap') === '1') wrap.remove();
    else el.remove();
  } catch {
    /* ignore */
  }
}

/**
 * Clip a shape host to its owning clipContent frame, or clear clip when the
 * host is selection-revealed (ink must match unclipped selection chrome).
 */
export function syncFrameContentClip(
  root: SVGSVGElement | null | undefined,
  el: SVGElement | null | undefined,
  document: { frames?: ArtboardFrame[]; x?: number; y?: number } | null | undefined,
  node: Record<string, unknown> | null | undefined,
  opts?: { zoom?: number; revealOverflow?: boolean }
): void {
  if (!el) return;
  if (opts?.revealOverflow) {
    clearFrameContentClip(el);
    return;
  }
  if (!root) return;
  applyFrameContentClip(root, el, document, node, opts);
}

/**
 * Clip a shape host to its owning clipContent frame.
 *
 * Clip sits on the **untransformed paint layer** (same lattice as
 * `HtmlArtboardFrame` plate) with a **scene-absolute** rect — not on the
 * rotated node `g`, and not on a nested wrap.
 */
export function applyFrameContentClip(
  root: SVGSVGElement,
  el: SVGElement | null | undefined,
  document: { frames?: ArtboardFrame[]; x?: number; y?: number } | null | undefined,
  node: Record<string, unknown> | null | undefined,
  opts?: { zoom?: number }
): void {
  if (!el || !root) return;
  const host = resolveClipHost(el);
  unwrapFrameClip(el);

  const frame = findClippingFrameForNode(document, node);
  if (!frame) {
    clearHostClip(host);
    return;
  }
  try {
    const { ox, oy } = sceneOrigin(document);
    const fx = num(frame.x) - ox;
    const fy = num(frame.y) - oy;
    const fw = Math.max(1, num(frame.width, 1));
    const fh = Math.max(1, num(frame.height, 1));
    // ~½ CSS px in scene space — kills AA bleed past the sibling plate SVG.
    // Cap inset so far zoom (z≪1) cannot collapse the clip rect to empty.
    const z = Math.max(0.05, Number(opts?.zoom) || 1);
    const inset = Math.min(2, 0.5 / z);

    const id = nextClipId('frame-clip');
    const defs = ensureDefs(root);
    const clip = svgEl('clipPath', {
      id,
      clipPathUnits: 'userSpaceOnUse',
    });
    clip.appendChild(
      svgEl('rect', {
        x: fx + inset,
        y: fy + inset,
        width: Math.max(1, fw - inset * 2),
        height: Math.max(1, fh - inset * 2),
      })
    );
    defs.appendChild(clip);

    setAttrs(host, { 'clip-path': urlRef(id) });
    if (host !== el) el.removeAttribute('clip-path');
  } catch {
    /* ignore */
  }
}
