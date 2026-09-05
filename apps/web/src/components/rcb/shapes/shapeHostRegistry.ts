import { replaceSvgNode, dedupeSceneNode } from '@/components/rcb/scene/paint/sceneToSvg';
import { invalidateNodePath2D } from '@/components/rcb/scene/document/sceneShapes';
import type { SceneDocument } from '@/components/rcb/sceneNode';

/** Paint element for one scene node (SVG under the camera layer). */
export type SceneHostEl = SVGElement;

/** One paint host per scene node (SVG mini-board under the camera layer). */
export type ShapeHostHandle = {
  nodeId: string;
  root: SVGSVGElement | null;
  layer: SVGGElement | null;
  el: SceneHostEl | null;
  kind: 'svg';
  /**
   * Selected: host owns frame clip and keeps ink past the artboard edge.
   * Preview / replaceSvgNode must read this instead of re-applying clip blindly.
   */
  revealOverflow?: boolean;
};

const hosts = new Map<string, ShapeHostHandle>();
const hostListeners = new Set<() => void>();
const nodeHostListeners = new Map<string, Set<() => void>>();
const nodeHostEpochs = new Map<string, number>();
let hostEpoch = 0;

/** Shared nodeId → paint element map used by preview/replace. */
let sharedNodeEls: Map<string, SceneHostEl> | null = null;

function notifyListeners(listeners: Iterable<() => void>) {
  for (const fn of listeners) {
    try {
      fn();
    } catch {
      /* ignore */
    }
  }
}

function bumpNodeEpoch(nodeId: string) {
  nodeHostEpochs.set(nodeId, (nodeHostEpochs.get(nodeId) || 0) + 1);
}

function bumpHostEpoch(nodeId?: string) {
  hostEpoch += 1;
  notifyListeners(hostListeners);
  if (nodeId) {
    bumpNodeEpoch(nodeId);
    notifyListeners(nodeHostListeners.get(nodeId) || []);
    return;
  }
  for (const [id, listeners] of nodeHostListeners) {
    bumpNodeEpoch(id);
    notifyListeners(listeners);
  }
}

/** Notify when a shape host registers / remounts / unregisters (paintToken remount). */
export function subscribeShapeHosts(fn: () => void) {
  hostListeners.add(fn);
  return () => {
    hostListeners.delete(fn);
  };
}

/** Subscribe to one host only; title chrome must not rerender for unrelated nodes. */
export function subscribeShapeHost(nodeId: string, fn: () => void) {
  const id = String(nodeId || '');
  if (!id) return () => {};
  const listeners = nodeHostListeners.get(id) || new Set<() => void>();
  listeners.add(fn);
  nodeHostListeners.set(id, listeners);
  return () => {
    listeners.delete(fn);
    if (!listeners.size) nodeHostListeners.delete(id);
  };
}

/**
 * Live DOM geometry preview (corner radius / star tip) changed `d` without remount.
 * Bump listeners so HostPathChrome re-reads the baseline path.
 */
export function notifyShapeHostGeometry(nodeId?: string) {
  if (nodeId) invalidateNodePath2D(nodeId);
  bumpHostEpoch(nodeId);
}

/** Per-node epoch for media portals — unrelated host remounts must not tear WaveSurfer. */
export function getShapeHostNodeEpoch(nodeId: string) {
  return nodeHostEpochs.get(String(nodeId || '')) || 0;
}

export function setSharedNodeEls(map: Map<string, SceneHostEl> | null) {
  sharedNodeEls = map;
}

export function getSharedNodeEls() {
  return sharedNodeEls;
}

export function registerShapeHost(handle: ShapeHostHandle) {
  hosts.set(handle.nodeId, handle);
  if (sharedNodeEls && handle.el) {
    sharedNodeEls.set(handle.nodeId, handle.el);
  }
  // createSvgBoard appends at mount end — re-sort immediately so a remounted
  // frame plate cannot paint over existing shape layers (click-through still works
  // because the world SVG is pointer-events: none).
  if (handle.layer && sceneShapesMount && handle.layer.parentNode === sceneShapesMount) {
    syncSharedMountPaintOrder(sceneShapesMount);
  }
  bumpHostEpoch(handle.nodeId);
}

export function updateShapeHostElement(nodeId: string, el: SceneHostEl | null) {
  const h = hosts.get(nodeId);
  if (h) h.el = el;
  if (sharedNodeEls) {
    if (el) sharedNodeEls.set(nodeId, el);
    else sharedNodeEls.delete(nodeId);
  }
  // Paint remount → drop Path2D binding so the next hit rebuilds from current `d`.
  invalidateNodePath2D(nodeId);
  bumpHostEpoch(nodeId);
}

/** Selection-owned frame clip: preview/replace must not fight this flag. */
export function setShapeHostRevealOverflow(nodeId: string, reveal: boolean) {
  const h = hosts.get(nodeId);
  if (!h) return;
  if (h.revealOverflow === reveal) return;
  h.revealOverflow = reveal;
}

export function shapeHostRevealsOverflow(nodeId: string): boolean {
  return Boolean(hosts.get(nodeId)?.revealOverflow);
}

export function unregisterShapeHost(nodeId: string) {
  hosts.delete(nodeId);
  sharedNodeEls?.delete(nodeId);
  invalidateNodePath2D(nodeId);
  bumpHostEpoch(nodeId);
}

export function getShapeHost(nodeId: string) {
  return hosts.get(nodeId) ?? null;
}

export function listShapeHosts() {
  return [...hosts.values()];
}

export function clearShapeHosts() {
  hosts.clear();
  nodeHostEpochs.clear();
  nodeHostListeners.clear();
}

/** One screen-surface SVG — shape layers share the canonical camera matrix. */
let sceneWorldRoot: SVGSVGElement | null = null;
/**
 * Artboard plates + DOM hosts share `sceneShapesMount`, ordered by `data-z`
 * (`stackOrder`). SoA/WebGL ink sits under that SVG; nodes that must interleave
 * with plates paint as hosts on this mount.
 */
let sceneFramesRoot: SVGSVGElement | null = null;
let sceneShapesMount: SVGGElement | null = null;
let sceneFramesMount: SVGGElement | null = null;
let sceneDrawPreviewMount: SVGGElement | null = null;
let sceneSmartGuidesMount: SVGGElement | null = null;
let sceneSelectionChromeMount: SVGGElement | null = null;
let sceneWorldEpoch = 0;

export function setSceneWorldRoot(
  root: SVGSVGElement | null,
  shapesMount: SVGGElement | null,
  drawPreviewMount: SVGGElement | null = null,
  smartGuidesMount: SVGGElement | null = null,
  selectionChromeMount: SVGGElement | null = null,
  /** @deprecated Plates share the shapes SVG; ignored when null — aliased to root/mount. */
  _framesRoot: SVGSVGElement | null = null,
  _framesMount: SVGGElement | null = null
) {
  sceneWorldRoot = root;
  sceneShapesMount = shapesMount;
  // Unified stack: plates + hosts on one mount (stackOrder / data-z).
  sceneFramesRoot = root;
  sceneFramesMount = shapesMount;
  sceneDrawPreviewMount = drawPreviewMount;
  sceneSmartGuidesMount = smartGuidesMount;
  sceneSelectionChromeMount = selectionChromeMount;
  sceneWorldEpoch += 1;
  bumpHostEpoch();
}

export function getSceneWorldRoot() {
  return sceneWorldRoot;
}

/** Same SVG as the scene world root — plates share the host surface. */
export function getSceneFramesRoot() {
  return sceneFramesRoot ?? sceneWorldRoot;
}

export function getSceneShapesMount() {
  return sceneShapesMount;
}

/** Same mount as shapes — plates interleave with hosts by data-z. */
export function getSceneFramesMount() {
  return sceneFramesMount ?? sceneShapesMount;
}

/**
 * Sort mount children by data-z (`stackOrder`).
 * Artboard plates and node hosts share this mount so stackOrder is physical.
 */
export function syncSharedMountPaintOrder(mount?: SVGGElement | null) {
  const root = mount ?? sceneShapesMount;
  if (!root) return;
  const siblings: Element[] = [];
  for (let i = 0; i < root.children.length; i += 1) {
    const child = root.children[i];
    if (!(child instanceof Element)) continue;
    if (
      child.hasAttribute('data-rcb-frame-layer') ||
      child.hasAttribute('data-rcb-shape-layer')
    ) {
      siblings.push(child);
    }
  }
  if (siblings.length < 2) return;

  const zOf = (el: Element): number => Number(el.getAttribute('data-z')) || 0;

  let ordered = true;
  for (let i = 1; i < siblings.length; i += 1) {
    const prev = siblings[i - 1]!;
    const cur = siblings[i]!;
    if (zOf(prev) > zOf(cur)) {
      ordered = false;
      break;
    }
  }
  if (ordered) return;

  siblings.sort((a, b) => zOf(a) - zOf(b));
  for (const g of siblings) root.appendChild(g);
}

/** In-progress draw ink — chrome SVG above SoA canvas ink. */
export function getSceneDrawPreviewMount() {
  return sceneDrawPreviewMount;
}

/** Align/gap guides — chrome SVG; same CameraTransform. */
export function getSceneSmartGuidesMount() {
  return sceneSmartGuidesMount;
}

/** Selection paint — chrome SVG; same CameraTransform as scene. */
export function getSceneSelectionChromeMount() {
  return sceneSelectionChromeMount;
}

export function getSceneWorldEpoch() {
  return sceneWorldEpoch;
}

/**
 * Recover a host after HMR / race cleared the module Map but the DOM mini-board remains.
 */
function recoverShapeHost(nodeId: string): ShapeHostHandle | null {
  if (typeof document === 'undefined') return null;
  const hostEl = document.querySelector(`[data-rcb-shape-host="${CSS.escape(nodeId)}"]`);
  if (!(hostEl instanceof HTMLElement)) return null;

  const root = hostEl.querySelector('svg');
  const layer = root?.querySelector('#scene-layer');
  if (!(root instanceof SVGSVGElement) || !(layer instanceof SVGGElement)) return null;
  const handle: ShapeHostHandle = {
    nodeId,
    root,
    layer,
    el:
      (layer.querySelector(`[data-scene-node-id="${CSS.escape(nodeId)}"]`) as SVGElement | null) ||
      null,
    kind: 'svg',
  };
  registerShapeHost(handle);
  return handle;
}

/**
 * Rebuild one node's paint. Prefers per-shape SVG host; falls back to mono board.
 */
export async function replaceShapePaint(
  document: SceneDocument,
  nodeEls: Map<string, SceneHostEl>,
  nodeId: string,
  mono?: { root: SVGSVGElement; layer: SVGElement } | null
) {
  const host = hosts.get(nodeId) || recoverShapeHost(nodeId);

  if (host?.root && host.layer) {
    await replaceSvgNode(
      host.root,
      host.layer,
      document,
      nodeEls as Map<string, SVGElement>,
      nodeId,
      // Host owns frame clip via revealOverflow — do not re-clip here.
      { applyFrameClip: false }
    );
    const el = (nodeEls.get(nodeId) as SVGElement | undefined) ?? null;
    if (el) {
      el.style.opacity = '1';
      el.setAttribute('opacity', '1');
    }
    updateShapeHostElement(nodeId, el);
    dedupeSceneNode(host.layer, nodeId, el);
    return;
  }
  if (mono?.root && mono?.layer) {
    await replaceSvgNode(
      mono.root,
      mono.layer,
      document,
      nodeEls as Map<string, SVGElement>,
      nodeId
    );
  }
}
