import type { SceneDocument, SceneNode, SceneNodeInput } from '@/components/rcb/sceneNode';
/**
 * Canvas stress micro-benchmarks (Node/jsdom) — post-optimization suite.
 *
 * Measures COW history / patch undo / spatial cull / Canvas idle host budget on
 * homogeneous + mixed “design-like” scenes (rect / text / path / heavy outline).
 *
 * Run: `npm run test:stress --workspace=apps/web`
 */
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  createEmptyDocument,
  normalizeDocument,
  stackNodeKey,
  updateNodeInDocument
} from '@/components/rcb/scene/document/sceneDocument';
import {
  RcbSpatialIndex,
  SceneSpatialRuntime,
  boxesIntersect,
  nodeSceneAabb,
} from '@/components/rcb/core/spatialIndex';
import {
  HEAVY_PATH_D_CHARS,
  distPointToPathD,
  pathDContainsPoint,
} from '@/components/rcb/scene/document/sceneShapes';
import { pickFullAndCanvasIds } from '@/components/rcb/shapes/RcbShapesLayer';

type Kind = 'rect' | 'path' | 'heavyPath' | 'mixed';

type Row = {
  n: number;
  kind: Kind;
  buildMs: number;
  jsonBytes: number;
  jsonCloneMs: number;
  cowCloneMs: number;
  cowVsJson: number;
  indexBuildMs: number;
  indexCullMs: number;
  indexCullVisible: number;
  linearCullMs: number;
  hitNearbyMs: number;
  hitNearbyCandAvg: number;
  pathSampleMs: number | null;
  /** Naive 50× JSON snapshots (pre-opt ceiling). */
  history50JsonMb: number;
  /** 50× COW snaps with path-string dedup across stack. */
  history50CowDedupMb: number;
  /** 50× single-node patch undos (current patchDocumentNode path). */
  history50PatchMb: number;
  hostFullAt1x: number;
  hostCanvasAt1x: number;
  hostFullAtMotion: number;
  hostCanvasAtFar: number;
};

const RESULTS: Row[] = [];

function smallPathD() {
  return 'M 0 0 L 40 0 L 40 40 L 0 40 Z';
}

function heavyPathD() {
  const parts: string[] = ['M 0 0'];
  for (let i = 1; i <= 800; i += 1) {
    parts.push(`L ${(i % 40) * 1.1} ${(i % 37) * 0.9}`);
  }
  parts.push('Z');
  const d = parts.join(' ');
  return d.length < HEAVY_PATH_D_CHARS ? `${d} ${d}` : d;
}

function kindForMixed(i: number): 'rect' | 'text' | 'path' | 'heavyPath' {
  const m = i % 20;
  if (m < 10) return 'rect';
  if (m < 14) return 'text';
  if (m < 18) return 'path';
  return 'heavyPath';
}

function makeNode(id: string, i: number, kind: Kind | 'text', cols: number) {
  const col = i % cols;
  const row = Math.floor(i / cols);
  const x = col * 48;
  const y = row * 48;
  const base = {
    id,
    key: 'shape' as const,
    x,
    y,
    z: i,
    width: 40,
    height: 40,
    children: [] as string[],
  };
  if (kind === 'text') {
    return {
      ...base,
      key: 'text' as const,
      width: 120,
      height: 28,
      attrs: {
        markdown: `Label ${i}`,
        DATA: `Label ${i}`,
        fontSize: 14,
        fontFamily: 'Inter',
        'fill-color': '#111827',
      },
    };
  }
  if (kind === 'rect' || (kind === 'mixed' && kindForMixed(i) === 'rect')) {
    return {
      ...base,
      attrs: {
        shapeType: 'rect',
        'fill-color': i % 3 === 0 ? '#EEF2FF' : '#F8FAFC',
        'fill-enabled': 'true',
        'border-color': '#334155',
        'border-width': 1,
        'stroke-enabled': 'true',
        cornerRadius: i % 7 === 0 ? 8 : 0,
      },
    };
  }
  const resolved =
    kind === 'mixed' ? kindForMixed(i) : kind === 'heavyPath' ? 'heavyPath' : 'path';
  if (resolved === 'text') return makeNode(id, i, 'text', cols);
  if (resolved === 'rect') return makeNode(id, i, 'rect', cols);
  const d = resolved === 'heavyPath' ? heavyPathD() : smallPathD();
  return {
    ...base,
    attrs: {
      shapeType: 'path',
      path: d,
      closed: 'true',
      'fill-color': '#FEE2E2',
      'fill-enabled': 'true',
      'border-width': 0,
      'stroke-enabled': 'false',
    },
  };
}

function buildStressDocument(n: number, kind: Kind) {
  const t0 = performance.now();
  const doc = createEmptyDocument({ emptyWorld: true, width: 4000, height: 4000 });
  const cols = Math.ceil(Math.sqrt(n));
  const children: string[] = [];
  for (let i = 0; i < n; i += 1) {
    const id = `n${i}`;
    children.push(id);
    doc.deltaSetLike[id] = makeNode(id, i, kind, cols);
  }
  const page = doc.pages[0];
  page.children = children;
  doc.deltaSetLike.ROOT = {
    ...doc.deltaSetLike.ROOT,
    children: [...children],
  };
  doc.stackOrder = children.map((id) => stackNodeKey(id));
  return { doc, buildMs: performance.now() - t0, cols };
}

/** Mirror editor.ts structural history clone (share path strings). */
function cloneDocumentCow(doc: SceneDocument): SceneDocument {
  const delta = doc.deltaSetLike || {};
  const nextDelta: Record<string, unknown> = {};
  for (const key of Object.keys(delta)) {
    const node = delta[key];
    if (!node || typeof node !== 'object') {
      nextDelta[key] = node;
      continue;
    }
    const attrs = (node as any).attrs;
    nextDelta[key] = {
      ...(node as object),
      attrs: attrs && typeof attrs === 'object' ? { ...attrs } : attrs,
      children: Array.isArray((node as any).children)
        ? [...(node as any).children]
        : (node as any).children,
    };
  }
  return {
    ...doc,
    stackOrder: Array.isArray(doc.stackOrder) ? [...doc.stackOrder] : doc.stackOrder,
    pages: Array.isArray(doc.pages)
      ? doc.pages.map((p: any) =>
          p && typeof p === 'object'
            ? { ...p, children: Array.isArray(p.children) ? [...p.children] : p.children }
            : p
        )
      : doc.pages,
    deltaSetLike: nextDelta as SceneDocument['deltaSetLike'],
  };
}

function estimateNodeBytes(node: SceneNodeInput, seenPaths?: Set<string>): number {
  if (!node) return 0;
  const attrs = node.attrs;
  if (!attrs) return 128;
  const path = attrs.path != null ? String(attrs.path) : '';
  let n = 192;
  if (path) {
    if (!seenPaths) n += path.length;
    else if (!seenPaths.has(path)) {
      seenPaths.add(path);
      n += path.length;
    }
  }
  return n;
}

function estimateDocBytes(doc: SceneDocument, seen?: Set<string>) {
  let n = 0;
  for (const id of Object.keys(doc?.deltaSetLike || {})) {
    n += estimateNodeBytes(doc.deltaSetLike[id], seen);
  }
  return n;
}

function median(xs: number[]) {
  const a = [...xs].sort((x, y) => x - y);
  const mid = Math.floor(a.length / 2);
  return a.length % 2 ? a[mid] : (a[mid - 1] + a[mid]) / 2;
}

function timeMs(fn: () => void, runs: number) {
  const samples: number[] = [];
  fn();
  for (let i = 0; i < runs; i += 1) {
    const t0 = performance.now();
    fn();
    samples.push(performance.now() - t0);
  }
  return median(samples);
}

function measureLinearCull(doc: SceneDocument, view: { minX: number; minY: number; maxX: number; maxY: number }) {
  const ids: string[] = doc.deltaSetLike?.ROOT?.children || [];
  let visible = 0;
  const t0 = performance.now();
  for (const id of ids) {
    const box = nodeSceneAabb(doc, id, 8);
    if (!box) continue;
    if (boxesIntersect(box, view)) visible += 1;
  }
  return { ms: performance.now() - t0, visible };
}

function measureIndexCull(
  idx: RcbSpatialIndex,
  view: { minX: number; minY: number; maxX: number; maxY: number }
) {
  const t0 = performance.now();
  const hits = idx.search(view.minX, view.minY, view.maxX, view.maxY);
  return { ms: performance.now() - t0, visible: hits.length, ids: hits.map((h) => h.id) };
}

function measureHitNearby(doc: SceneDocument, _idx: RcbSpatialIndex, points: Array<[number, number]>) {
  const allIds: string[] = doc.deltaSetLike?.ROOT?.children || [];
  const runtime = new SceneSpatialRuntime(256);
  runtime.sync({ document: doc, childrenIds: allIds, reloadToken: 1 });
  let candSum = 0;
  const t0 = performance.now();
  for (const [x, y] of points) {
    const order = runtime.hitCandidateIds({ x, y, pad: 48 });
    for (const id of order) {
      const box = nodeSceneAabb(doc, id, 8);
      candSum += 1;
      if (!box) continue;
      if (x >= box.minX && x <= box.maxX && y >= box.minY && y <= box.maxY) break;
    }
  }
  return {
    ms: performance.now() - t0,
    candidatesAvg: candSum / Math.max(1, points.length),
  };
}

function hostBudgetFor(doc: SceneDocument, visibleIds: string[], zoom: number, moving: boolean) {
  const { fullIds, canvasIds } = pickFullAndCanvasIds({
    document: doc,
    visibleIds,
    keepSet: new Set(visibleIds.slice(0, 2)),
    zoom,
    moving,
  });
  return { full: fullIds.length, canvas: canvasIds.length };
}

function runSuite(n: number, kind: Kind): Row {
  const { doc, buildMs, cols } = buildStressDocument(n, kind);
  const json = JSON.stringify(doc);
  const jsonBytes = json.length;

  const jsonCloneMs = timeMs(() => {
    normalizeDocument(doc);
  }, n >= 5000 ? 3 : 5);

  const cowCloneMs = timeMs(() => {
    cloneDocumentCow(doc);
  }, n >= 5000 ? 3 : 5);

  const indexBuildMs = timeMs(() => {
    const idx = new RcbSpatialIndex(256);
    const ids: string[] = doc.deltaSetLike?.ROOT?.children || [];
    for (const id of ids) {
      const box = nodeSceneAabb(doc, id, 32);
      if (!box) continue;
      idx.upsert({ id, ...box });
    }
  }, 5);

  const idx = new RcbSpatialIndex(256);
  {
    const ids: string[] = doc.deltaSetLike?.ROOT?.children || [];
    for (const id of ids) {
      const box = nodeSceneAabb(doc, id, 32);
      if (!box) continue;
      idx.upsert({ id, ...box });
    }
  }

  const view = { minX: 0, minY: 0, maxX: 960, maxY: 960 };
  const linearCullMs = median(
    Array.from({ length: 5 }, () => measureLinearCull(doc, view).ms)
  );

  let indexCullVisible = 0;
  let visibleIds: string[] = [];
  const indexCullMs = median(
    Array.from({ length: 5 }, () => {
      const r = measureIndexCull(idx, view);
      indexCullVisible = r.visible;
      visibleIds = r.ids;
      return r.ms;
    })
  );

  const points: Array<[number, number]> = [];
  for (let i = 0; i < 200; i += 1) {
    const col = i % Math.min(cols, 40);
    const row = Math.floor(i / Math.min(cols, 40)) % Math.min(cols, 40);
    points.push([col * 48 + 20, row * 48 + 20]);
  }
  const hitNearby = measureHitNearby(doc, idx, points);
  const hitNearbyMs = median(
    Array.from({ length: 5 }, () => measureHitNearby(doc, idx, points).ms)
  );

  let pathSampleMs: number | null = null;
  if (kind === 'path' || kind === 'heavyPath' || kind === 'mixed') {
    const sampleId =
      (doc.deltaSetLike?.ROOT?.children || []).find((id: string) => {
        const d = String(doc.deltaSetLike[id]?.attrs?.path || '');
        return d.length > 20;
      }) || 'n0';
    const d = String(doc.deltaSetLike[sampleId]?.attrs?.path || '');
    if (d) {
      pathSampleMs = timeMs(() => {
        for (let i = 0; i < 50; i += 1) pathDContainsPoint(20, 20, d, 'nonzero');
        if (d.length < HEAVY_PATH_D_CHARS) {
          for (let i = 0; i < 10; i += 1) distPointToPathD(20, 20, d);
        }
      }, 3);
    }
  }

  // History: 50 full JSON snaps vs 50 COW snaps (dedup paths) vs 50 node patches.
  const history50JsonMb = (jsonBytes * 50) / (1024 * 1024);
  const seen = new Set<string>();
  let cowStack = 0;
  for (let i = 0; i < 50; i += 1) {
    const snap = cloneDocumentCow(doc);
    cowStack += estimateDocBytes(snap, seen);
  }
  const history50CowDedupMb = cowStack / (1024 * 1024);

  let patchStack = 0;
  const patchSeen = new Set<string>();
  let live = doc;
  const targetId = 'n0';
  for (let i = 0; i < 50; i += 1) {
    const before = live.deltaSetLike[targetId];
    patchStack += estimateNodeBytes(before, patchSeen);
    live = updateNodeInDocument(live, targetId, {
      attrs: { 'fill-color': i % 2 ? '#ff0000' : '#00ff00' },
    });
  }
  const history50PatchMb = patchStack / (1024 * 1024);

  // If index returned ids use those; else rebuild from linear scan list.
  if (!visibleIds.length) {
    const ids: string[] = doc.deltaSetLike?.ROOT?.children || [];
    for (const id of ids) {
      const box = nodeSceneAabb(doc, id, 8);
      if (box && boxesIntersect(box, view)) visibleIds.push(id);
    }
  }
  const host1 = hostBudgetFor(doc, visibleIds, 1, false);
  const hostFar = hostBudgetFor(doc, visibleIds, 0.25, true);

  return {
    n,
    kind,
    buildMs: Math.round(buildMs * 100) / 100,
    jsonBytes,
    jsonCloneMs: Math.round(jsonCloneMs * 100) / 100,
    cowCloneMs: Math.round(cowCloneMs * 100) / 100,
    cowVsJson: Math.round((cowCloneMs / Math.max(0.01, jsonCloneMs)) * 100) / 100,
    indexBuildMs: Math.round(indexBuildMs * 100) / 100,
    indexCullMs: Math.round(indexCullMs * 100) / 100,
    indexCullVisible,
    linearCullMs: Math.round(linearCullMs * 100) / 100,
    hitNearbyMs: Math.round(hitNearbyMs * 100) / 100,
    hitNearbyCandAvg: Math.round(hitNearby.candidatesAvg * 100) / 100,
    pathSampleMs: pathSampleMs == null ? null : Math.round(pathSampleMs * 100) / 100,
    history50JsonMb: Math.round(history50JsonMb * 100) / 100,
    history50CowDedupMb: Math.round(history50CowDedupMb * 100) / 100,
    history50PatchMb: Math.round(history50PatchMb * 100) / 100,
    hostFullAt1x: host1.full,
    hostCanvasAt1x: host1.canvas,
    hostFullAtMotion: hostFar.full,
    hostCanvasAtFar: hostFar.canvas,
  };
}

describe('canvas stress bench (post-opt)', () => {
  it(
    'homogeneous + mixed design-like scenes up to 10k',
    () => {
      const cases: Array<{ n: number; kind: Kind }> = [
        { n: 1000, kind: 'rect' },
        { n: 1000, kind: 'mixed' },
        { n: 1000, kind: 'heavyPath' },
        { n: 5000, kind: 'rect' },
        { n: 5000, kind: 'mixed' },
        { n: 10000, kind: 'rect' },
        { n: 10000, kind: 'mixed' },
      ];

      for (const c of cases) {
        const row = runSuite(c.n, c.kind);
        RESULTS.push(row);
        expect(row.cowCloneMs).toBeLessThan(c.n >= 10000 ? 4000 : 2000);
        expect(row.indexCullMs).toBeLessThan(c.n >= 10000 ? 50 : 20);
        expect(row.indexBuildMs).toBeLessThan(c.n >= 10000 ? 500 : 200);
        // Dense motion must not mount every visible node as a full SVG host.
        if (row.indexCullVisible > 96) {
          expect(row.hostFullAtMotion).toBeLessThanOrEqual(96);
          expect(row.hostCanvasAtFar).toBeGreaterThan(0);
        }
      }

      const payload = { when: new Date().toISOString(), suite: 'post-opt', rows: RESULTS };
      const out = resolve(__dirname, 'canvasStress.results.json');
      writeFileSync(out, JSON.stringify(payload, null, 2), 'utf8');
      // eslint-disable-next-line no-console
      console.log('\nCANVAS_STRESS_RESULTS written →', out);
      // eslint-disable-next-line no-console
      console.log(JSON.stringify(payload, null, 2));
    },
    180_000
  );
});
