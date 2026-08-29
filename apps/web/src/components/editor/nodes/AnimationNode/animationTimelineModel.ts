/**
 * Parse Bodymovin/Lottie JSON into timeline scenes, layers, and keyframe marks.
 */

export type LottieTimelineScene = {
  id: string;
  label: string;
  /** Root composition vs precomp asset id */
  kind: 'main' | 'precomp';
  assetId?: string;
  fr: number;
  ip: number;
  op: number;
  durationSec: number;
  layers: LottieTimelineLayer[];
};

export type LottieTimelineLayer = {
  id: string;
  ind: number;
  name: string;
  /** Scene node id when layered from 动画工作台 (`ln` on Bodymovin layer). */
  sceneNodeId?: string;
  /** Timeline clip chrome: image vs vector/element (only two colors). */
  clipKind: 'image' | 'element';
  /** Layer in/out in seconds (relative to scene). */
  inSec: number;
  outSec: number;
  props: LottieTimelineProp[];
};

export type LottieTimelineProp = {
  id: string;
  label: string;
  /** Bodymovin transform key: p/s/r/o/a/sk/sa */
  key: string;
  /** Keyframe times in seconds. */
  times: number[];
};

type AnimLike = Record<string, unknown>;

function asObj(v: unknown): AnimLike | null {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return null;
  return v as AnimLike;
}

function num(v: unknown, fallback = 0): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

export function frameToSec(frame: number, fr: number): number {
  const fps = Math.max(1, fr);
  return Math.max(0, (Number(frame) || 0) / fps);
}

/** Collect keyframe times from a Bodymovin animated property. */
function propKeyframeTimes(prop: unknown, fr: number): number[] {
  const o = asObj(prop);
  if (!o) return [];
  const animated = o.a === 1 || o.a === true || o.a === '1';
  if (!animated) return [];
  const k = o.k;
  if (!Array.isArray(k)) return [];
  const times: number[] = [];
  for (const item of k) {
    const row = asObj(item);
    if (!row) continue;
    if (!('t' in row)) continue;
    times.push(frameToSec(num(row.t), fr));
  }
  return times;
}

const TRANSFORM_PROPS: Array<{ key: string; label: string }> = [
  { key: 'p', label: 'Position' },
  { key: 's', label: 'Scale' },
  { key: 'r', label: 'Rotation' },
  { key: 'o', label: 'Opacity' },
  { key: 'a', label: 'Anchor' },
  { key: 'sk', label: 'Skew' },
  { key: 'sa', label: 'Skew Axis' },
];

/** Trim path channels — only listed once keyed (never via includeEmptyProps). */
const OPTIONAL_PROPS: Array<{ key: string; label: string }> = [
  { key: 'ts', label: 'Trim Start' },
  { key: 'te', label: 'Trim End' },
  { key: 'to', label: 'Trim Offset' },
  { key: 'rd', label: 'Roundness' },
];

function parseLayer(
  raw: unknown,
  fr: number,
  sceneIp: number,
  opts?: { includeEmptyProps?: boolean }
): LottieTimelineLayer | null {
  const layer = asObj(raw);
  if (!layer) return null;
  const ind = num(layer.ind, 0);
  const name = String(layer.nm || `Layer ${ind}` || 'Layer');
  const sceneNodeId = String(layer.ln || '').trim() || undefined;
  // Bodymovin ty 2 = image; everything else is element (shape / text / null / precomp).
  const clipKind: 'image' | 'element' = num(layer.ty, 4) === 2 ? 'image' : 'element';
  const ip = num(layer.ip, sceneIp);
  const op = Math.max(ip + 1, num(layer.op, ip + fr));
  const props: LottieTimelineProp[] = [];
  const ks = asObj(layer.ks);
  const includeEmpty = Boolean(opts?.includeEmptyProps);
  for (const { key, label } of TRANSFORM_PROPS) {
    const times = ks ? propKeyframeTimes(ks[key], fr) : [];
    if (times.length || includeEmpty) {
      props.push({ id: `${ind}:${key}`, label, key, times });
    }
  }
  for (const { key, label } of OPTIONAL_PROPS) {
    const times = ks ? propKeyframeTimes(ks[key], fr) : [];
    if (times.length) {
      props.push({ id: `${ind}:${key}`, label, key, times });
    }
  }
  return {
    id: `layer-${ind}-${name}`,
    ind,
    name,
    sceneNodeId,
    clipKind,
    inSec: frameToSec(ip, fr),
    outSec: frameToSec(op, fr),
    props,
  };
}

function parseCompLayers(
  layersRaw: unknown,
  fr: number,
  ip: number,
  opts?: { includeEmptyProps?: boolean }
): LottieTimelineLayer[] {
  if (!Array.isArray(layersRaw)) return [];
  const out: LottieTimelineLayer[] = [];
  for (const raw of layersRaw) {
    const layer = parseLayer(raw, fr, ip, opts);
    if (layer) out.push(layer);
  }
  // Bodymovin paints top of array last — show stack top-first like editors.
  return out;
}

function sceneFromComp(
  id: string,
  label: string,
  kind: 'main' | 'precomp',
  comp: AnimLike,
  assetId?: string,
  opts?: { includeEmptyProps?: boolean }
): LottieTimelineScene {
  const fr = Math.max(1, num(comp.fr, 30));
  const ip = num(comp.ip, 0);
  const op = Math.max(ip + 1, num(comp.op, ip + fr * 2));
  return {
    id,
    label,
    kind,
    assetId,
    fr,
    ip,
    op,
    durationSec: Math.max(0.1, (op - ip) / fr),
    layers: parseCompLayers(comp.layers, fr, ip, opts),
  };
}

/**
 * Build timeline scenes: Main Scene + precomp assets that have layers.
 */
export function buildLottieTimelineScenes(
  animationData: unknown,
  _plateName?: string,
  opts?: { includeEmptyProps?: boolean }
): LottieTimelineScene[] {
  const root = asObj(animationData);
  if (!root || !Array.isArray(root.layers)) return [];

  const scenes: LottieTimelineScene[] = [
    sceneFromComp('main', 'Main Scene', 'main', root, undefined, opts),
  ];

  const assets = Array.isArray(root.assets) ? root.assets : [];
  for (const raw of assets) {
    const asset = asObj(raw);
    if (!asset || !Array.isArray(asset.layers)) continue;
    const assetId = String(asset.id || '').trim();
    if (!assetId) continue;
    const nm = String(asset.nm || assetId).trim() || assetId;
    scenes.push(
      sceneFromComp(
        `precomp:${assetId}`,
        nm,
        'precomp',
        {
          ...asset,
          fr: num(asset.fr, num(root.fr, 30)),
          ip: num(asset.ip, 0),
          op: num(asset.op, num(root.op, 60)),
        },
        assetId,
        opts
      )
    );
  }
  return scenes;
}

export function rulerMarks(duration: number): number[] {
  const marks: number[] = [];
  const step = duration <= 3 ? 0.5 : duration <= 8 ? 1 : 2;
  for (let t = 0; t <= duration + 1e-6; t += step) {
    marks.push(Math.round(t * 10) / 10);
  }
  const end = Math.round(duration * 10) / 10;
  if (marks[marks.length - 1] !== end) marks.push(end);
  return marks;
}

/**
 * Pick a ruler major-label step so labels stay ~minPx apart across the visible track.
 * Prevents ticks collapsing into a solid bar when spanSec is long / zoom is low.
 */
export function rulerStepForWidth(duration: number, widthPx: number, minPx = 56): number {
  const dur = Math.max(0.1, duration);
  const w = Math.max(1, widthPx);
  const raw = (dur * Math.max(24, minPx)) / w;
  const candidates = [0.1, 0.2, 0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300, 600];
  for (const s of candidates) {
    if (s >= raw - 1e-9) return s;
  }
  return Math.ceil(raw / 60) * 60;
}

/** Snap seconds onto the nearest whole frame. */
export function snapSecToFrame(sec: number, fr: number, maxSec?: number): number {
  const fps = Math.max(1, fr);
  const frame = Math.round(Math.max(0, sec) * fps);
  const snapped = frame / fps;
  if (maxSec == null) return snapped;
  return Math.max(0, Math.min(maxSec, snapped));
}

export function secToFrame(sec: number, fr: number): number {
  return Math.round(Math.max(0, sec) * Math.max(1, fr));
}
