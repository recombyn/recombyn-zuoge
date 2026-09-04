/**
 * WebGL2 backend for SoA rect + ellipse + line + path (ADR 0027).
 * Unit-quad instancing; dense / outlined shapes stamp into the atlas (kind=3).
 */
import { rcbCameraCssZoom, rcbCameraScreenOffset, rcbViewportSceneBounds } from '@/components/rcb/core/math';
import { getNodeTransformPreview } from '@/components/rcb/core/transformPreview';
import {
  getSharedSceneRenderBuffer,
  isSoaCanvasShapesEnabled,
  resolveSoaPaintBox,
  getSoaPaintDocument,
  setSoaPaintDocument,
  mapSoaPathSampleToLive,
  soaPathLiveMapFromSlot,
  SOA_FLAG_CANVAS_IDLE,
  SOA_FLAG_DIRTY,
  SOA_FLAG_VISIBLE,
  SOA_FLAG_BASIC_GEOM,
  SOA_KIND_ELLIPSE,
  SOA_KIND_IMAGE,
  SOA_KIND_LINE,
  SOA_KIND_PATH,
  SOA_KIND_POLY,
  SOA_KIND_RECT,
  SOA_KIND_TEXT,
  soaStrokeWidth,
  unpackCssColor,
  type SceneRenderBuffer,
} from '@/components/rcb/render/sceneRenderBuffer';
import { getLiveCornerRadiusPreviewRadii } from '@/components/rcb/scene/document/sceneRadii';
import type { SceneDocument, SceneNodeInput } from '@/components/rcb/sceneNode';
import {
  collectSoaBakeTilesIntoAtlas,
  ensureSharedSoaWebglAtlas,
  recreateSharedSoaWebglAtlas,
  getSoaAtlasStats,
  pruneSoaAtlasForBuffer,
  pushAtlasRegionInstance,
  releaseSoaAtlasPrefix,
  releaseSoaAtlasRegion,
  stampImageToAtlas,
  stampSoaPathToAtlas,
  stampSoaEllipseToAtlas,
  type SoaAtlasRegion,
  type SoaWebglAtlas,
} from '@/components/rcb/render/webglInstanceAtlas';
import {
  bakeAudioInkForAtlas,
  bakeMediaInkForAtlas,
  bakeShapeInkForAtlas,
  bakeTextInkForAtlas,
  bumpSceneCanvasIdlePaint,
  isFillImageWebglUnsafe,
  hitTestWithSpatialIndex,
  mediaPaintSrc,
  type CanvasSceneRendererDeps,
  type SceneRenderRequest,
  type SceneRenderer,
} from '@/components/rcb/render/sceneRenderer';
import {
  collectReadySoaBakeTilesForView,
  createSoaBakeCache,
  getSharedSoaBakeCache,
  invalidateSoaBakeTilesForDirty,
  isSoaBakePathAllowed,
  setSharedSoaBakeCache,
  shouldUseSoaBake,
  unionSoaDirtyAabb,
} from '@/components/rcb/render/soaBakeLayer';
import {
  findClippingFrameForNode,
  frameClipRevealsOverflow,
  hasFrameClipRevealOverflow,
} from '@/components/rcb/frames/frameContentClip';
import {
  buildNormalizedDepthLookup,
  gpuDofSkipsSoaTileBake,
  shouldRunGpuDepthOfField,
} from '@/components/rcb/render/gpuDepthOfField';
import {
  bindWebglDofSceneAttributes,
  createWebglDepthOfFieldPass,
  type WebglDepthOfFieldPass,
} from '@/components/rcb/render/webglDepthOfFieldPass';
import {
  adaptivePathStrokeMaxSegs,
  floorContentStrokeSceneWidth,
} from '@/components/rcb/render/strokeScreenFloor';

/** Scene-space LTRB when the slot has no clipContent owner (or reveal-overflow). */
export const SOA_WEBGL_NO_CLIP: [number, number, number, number] = [-1e8, -1e8, 1e8, 1e8];

const VS = `#version 300 es
uniform vec2 uPan;
uniform float uZoom;
uniform vec2 uStage;
layout(location = 0) in vec2 aCorner;
layout(location = 1) in vec4 aRect;
layout(location = 2) in vec4 aColor;
layout(location = 3) in float aKind;
layout(location = 4) in float aAngle;
layout(location = 5) in vec4 aUv;
layout(location = 6) in vec4 aClip;
layout(location = 7) in vec4 aStroke;
out vec2 vUv;
out vec2 vAtlasUv;
out vec4 vColor;
out float vKind;
out vec2 vWorld;
out vec4 vClip;
out vec2 vHalf;
out vec4 vRadii;
out vec4 vStroke;
void main() {
  vec2 local;
  if (aKind > 1.5 && aKind < 2.5) {
    local = vec2(aCorner.x * aRect.z, (aCorner.y - 0.5) * aRect.w);
  } else if (aKind > 3.5) {
    // Grow the quad so center-aligned stroke is not clipped by the fill AABB.
    float pad = aStroke.w * 0.5;
    vec2 size = aRect.zw + vec2(pad * 2.0);
    local = aCorner * size - vec2(pad);
  } else {
    local = aCorner * aRect.zw;
  }
  float c = cos(aAngle);
  float s = sin(aAngle);
  vec2 pos = aRect.xy + vec2(c * local.x - s * local.y, s * local.x + c * local.y);
  vec2 screen = pos * uZoom + uPan;
  vec2 clip = vec2(
    (screen.x / uStage.x) * 2.0 - 1.0,
    1.0 - (screen.y / uStage.y) * 2.0
  );
  gl_Position = vec4(clip, 0.0, 1.0);
  vUv = aCorner * 2.0 - 1.0;
  vAtlasUv = mix(aUv.xy, aUv.zw, aCorner);
  vColor = aColor;
  vKind = aKind;
  vWorld = pos;
  vClip = aClip;
  vHalf = aRect.zw * 0.5;
  vRadii = aUv;
  vStroke = aStroke;
}`;

/** IQ rounded-box SDF; r = (tr, br, tl, bl). */
const FS_ROUND_SDF = `
float sdRoundBox(vec2 p, vec2 b, vec4 r) {
  r.xy = (p.x > 0.0) ? r.xy : r.zw;
  r.x = (p.y > 0.0) ? r.x : r.y;
  vec2 q = abs(p) - b + r.x;
  return min(max(q.x, q.y), 0.0) + length(max(q, 0.0)) - r.x;
}
`;

const FS = `#version 300 es
precision mediump float;
uniform sampler2D uAtlas;
uniform float uZoom;
in vec2 vUv;
in vec2 vAtlasUv;
in vec4 vColor;
in float vKind;
in vec2 vWorld;
in vec4 vClip;
in vec2 vHalf;
in vec4 vRadii;
in vec4 vStroke;
out vec4 outColor;
${FS_ROUND_SDF}
void main() {
  if (vWorld.x < vClip.x || vWorld.y < vClip.y || vWorld.x > vClip.z || vWorld.y > vClip.w) {
    discard;
  }
  // Atlas stamp (paths / bake tiles).
  if (vKind > 2.5 && vKind < 3.5) {
    vec4 tex = texture(uAtlas, vAtlasUv);
    if (tex.a < 0.01) discard;
    outColor = tex;
    return;
  }
  // Shader rounded rect — scene-space fill ± center stroke.
  // UV spans the padded quad so SDF samples match the expanded vertex size.
  // AA is half-fwidth + half-pixel stroke expand so 1px strokes keep SVG-like
  // optical weight (full fwidth smoothstep alone looks thin/虚 vs selected SVG).
  // Cap AA vs stroke pad / screen px so zoom-out fwidth cannot erase the ring.
  if (vKind > 3.5) {
    float sw = max(0.0, vStroke.w);
    float pad = sw * 0.5;
    vec2 p = vUv * (vHalf + vec2(pad));
    // aUv/vRadii stored as tl,tr,br,bl → IQ order tr,br,tl,bl
    vec4 r = vec4(vRadii.y, vRadii.z, vRadii.x, vRadii.w);
    float d = sdRoundBox(p, vHalf, r);
    float aa = max(0.5 * fwidth(d), 0.0005);
    float maxAa = max(pad * 0.85, 0.35 / max(uZoom, 0.05));
    aa = min(aa, maxAa);
    float halfW = pad + aa * 0.5;
    float cover = 1.0 - smoothstep(-aa, aa, d - halfW);
    if (cover < 0.004) discard;
    vec3 rgb = vColor.rgb;
    if (sw > 0.001) {
      float inFill = 1.0 - smoothstep(-aa, aa, d + halfW);
      rgb = mix(vStroke.rgb, vColor.rgb, inFill);
    }
    outColor = vec4(rgb, vColor.a * cover);
    return;
  }
  if (vKind > 0.5 && vKind < 1.5) {
    if (dot(vUv, vUv) > 1.0) discard;
  }
  outColor = vColor;
}`;

const UNIT_QUAD = new Float32Array([0, 0, 1, 0, 1, 1, 0, 0, 1, 1, 0, 1]);
/** Instanced kind: shader SDF rounded rect (fill ± center stroke). */
export const SOA_WEBGL_KIND_ROUNDED = 4;
/** Default line thickness in scene units (used when SoA stroke width is unset). */
export const SOA_WEBGL_LINE_THICKNESS = 2;
/** Cap segments emitted per path so one dense stroke cannot explode the instance batch. */
export const SOA_WEBGL_PATH_MAX_SEGS = 96;

function compile(gl: WebGL2RenderingContext, type: number, src: string) {
  const sh = gl.createShader(type);
  if (!sh) return null;
  gl.shaderSource(sh, src);
  gl.compileShader(sh);
  if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
    gl.deleteShader(sh);
    return null;
  }
  return sh;
}

function link(gl: WebGL2RenderingContext, vs: WebGLShader, fs: WebGLShader) {
  const prog = gl.createProgram();
  if (!prog) return null;
  gl.attachShader(prog, vs);
  gl.attachShader(prog, fs);
  gl.linkProgram(prog);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
    gl.deleteProgram(prog);
    return null;
  }
  return prog;
}

function argbToRgba(argb: number): [number, number, number, number] {
  const a = ((argb >>> 24) & 0xff) / 255;
  const r = ((argb >>> 16) & 0xff) / 255;
  const g = ((argb >>> 8) & 0xff) / 255;
  const b = (argb & 0xff) / 255;
  return [r, g, b, a];
}

/** Stroke ink for line/path segments (open pens store stroke in strokeColors, fill in colors=0). */
function soaWebglStrokeRgba(buf: SceneRenderBuffer, index: number): [number, number, number, number] {
  const stroke = buf.strokeColors[index] >>> 0;
  if (stroke) return argbToRgba(stroke);
  const fill = buf.colors[index] >>> 0;
  if (fill) return argbToRgba(fill);
  return argbToRgba(0xff333333);
}

function pushInstanceClip(
  clips: number[] | undefined,
  clip: readonly [number, number, number, number]
) {
  if (!clips) return;
  clips.push(clip[0], clip[1], clip[2], clip[3]);
}

/** Owning clipContent plate in scene space, or {@link SOA_WEBGL_NO_CLIP}. */
export function resolveSoaWebglSlotClip(
  buf: SceneRenderBuffer,
  index: number,
  doc: SceneDocument | null | undefined
): [number, number, number, number] {
  if (!doc) return SOA_WEBGL_NO_CLIP;
  const id = buf.ids[index];
  if (!id || frameClipRevealsOverflow(id)) return SOA_WEBGL_NO_CLIP;
  const node = doc.deltaSetLike?.[id] as Record<string, unknown> | undefined;
  if (!node) return SOA_WEBGL_NO_CLIP;
  const frame = findClippingFrameForNode(doc, { ...node, id });
  if (!frame) return SOA_WEBGL_NO_CLIP;
  const ox = Number(doc.x) || 0;
  const oy = Number(doc.y) || 0;
  const left = Number(frame.x) - ox;
  const top = Number(frame.y) - oy;
  const right = left + Math.max(1, Number(frame.width) || 1);
  const bottom = top + Math.max(1, Number(frame.height) || 1);
  return [left, top, right, bottom];
}

function pushInstanceStroke(
  strokes: number[] | undefined,
  rgba: [number, number, number, number] | null,
  width: number
) {
  if (!strokes) return;
  if (!rgba || width <= 0) {
    strokes.push(0, 0, 0, 0);
    return;
  }
  strokes.push(rgba[0], rgba[1], rgba[2], width);
}

function pushLineInstance(
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  rgba: [number, number, number, number],
  thickness: number,
  rects: number[],
  colors: number[],
  kinds: number[],
  angles: number[],
  uvs: number[],
  depths: number[] | undefined,
  depth: number,
  clips: number[] | undefined,
  clip: readonly [number, number, number, number],
  strokes?: number[]
) {
  const dx = x1 - x0;
  const dy = y1 - y0;
  const len = Math.hypot(dx, dy) || 0.01;
  const thr = thickness > 0 ? thickness : SOA_WEBGL_LINE_THICKNESS;
  rects.push(x0, y0, len, thr);
  colors.push(rgba[0], rgba[1], rgba[2], rgba[3]);
  kinds.push(2);
  angles.push(Math.atan2(dy, dx));
  uvs.push(0, 0, 1, 1);
  if (depths) depths.push(depth);
  pushInstanceClip(clips, clip);
  pushInstanceStroke(strokes, null, 0);
}

/**
 * Emit crisp stroke quads along a densified polyline.
 * When `closeContours` is set, each finite run closes back to its first point
 * (boolean / evenodd holes use NaN breaks between contours).
 */
export function emitPathStrokeSegments(opts: {
  xy: Float32Array;
  start: number;
  len: number;
  ox?: number;
  oy?: number;
  rgba: [number, number, number, number];
  thickness: number;
  closeContours?: boolean;
  rects: number[];
  colors: number[];
  kinds: number[];
  angles: number[];
  uvs: number[];
  depths?: number[];
  depth: number;
  clips?: number[];
  paintClips: Array<readonly [number, number, number, number]>;
  strokes?: number[];
  maxSegs?: number;
}): number {
  const {
    xy,
    start,
    len,
    rgba,
    thickness,
    closeContours = false,
    rects,
    colors,
    kinds,
    angles,
    uvs,
    depths,
    depth,
    clips,
    paintClips,
    strokes,
  } = opts;
  const ox = opts.ox || 0;
  const oy = opts.oy || 0;
  const maxSegs = opts.maxSegs ?? SOA_WEBGL_PATH_MAX_SEGS;
  const base = start * 2;
  let contourFirst = -1;
  let lastFinite = -1;
  let emitted = 0;
  const emitSeg = (a: number, b: number) => {
    if (emitted >= maxSegs) return;
    for (const activeClip of paintClips) {
      pushLineInstance(
        xy[a] + ox,
        xy[a + 1] + oy,
        xy[b] + ox,
        xy[b + 1] + oy,
        rgba,
        thickness,
        rects,
        colors,
        kinds,
        angles,
        uvs,
        depths,
        depth,
        clips,
        activeClip,
        strokes
      );
    }
    emitted += 1;
  };
  const endContour = () => {
    if (
      closeContours &&
      contourFirst >= 0 &&
      lastFinite >= 0 &&
      contourFirst !== lastFinite
    ) {
      emitSeg(lastFinite, contourFirst);
    }
    contourFirst = -1;
    lastFinite = -1;
  };
  for (let p = 0; p < len; p += 1) {
    const fo = base + p * 2;
    const px = xy[fo];
    const py = xy[fo + 1];
    if (!Number.isFinite(px) || !Number.isFinite(py)) {
      endContour();
      continue;
    }
    if (lastFinite < 0) {
      contourFirst = fo;
      lastFinite = fo;
      continue;
    }
    emitSeg(lastFinite, fo);
    lastFinite = fo;
  }
  endContour();
  return emitted;
}

function countPathSegments(buf: SceneRenderBuffer, index: number): number {
  const start = buf.pathStart[index];
  const len = buf.pathLen[index];
  if (start < 0 || len < 2) return 0;
  const closed = buf.pathClosed[index] !== 0;
  const base = start * 2;
  let segs = 0;
  let last = -1;
  let first = -1;
  for (let p = 0; p < len; p += 1) {
    const fo = base + p * 2;
    if (!Number.isFinite(buf.pathXY[fo]) || !Number.isFinite(buf.pathXY[fo + 1])) {
      if (closed && first >= 0 && last >= 0 && first !== last) segs += 1;
      last = -1;
      first = -1;
      continue;
    }
    if (last < 0) {
      first = fo;
      last = fo;
      continue;
    }
    segs += 1;
    last = fo;
  }
  if (closed && first >= 0 && last >= 0 && first !== last) segs += 1;
  return segs;
}

/** Closed paths must atlas-stamp (segment instances are stroke-only). Open strokes stay crisp segments. */
export function soaPathPrefersAtlasStamp(closed: boolean, _segCount: number): boolean {
  return closed;
}

/** Live-mapped path samples for atlas (document pathXY stays at slot pose). */
function buildLiveMappedPathStampXy(
  buf: SceneRenderBuffer,
  index: number,
  live: { x: number; y: number; w: number; h: number }
): { xy: Float32Array; start: number; len: number } | null {
  const start = buf.pathStart[index];
  const len = buf.pathLen[index];
  if (start < 0 || len < 2) return null;
  const liveMap = soaPathLiveMapFromSlot(buf, index, live);
  const samePose =
    Math.abs(liveMap.liveX - liveMap.baseX) < 1e-4 &&
    Math.abs(liveMap.liveY - liveMap.baseY) < 1e-4 &&
    Math.abs(liveMap.liveW - liveMap.baseW) < 1e-4 &&
    Math.abs(liveMap.liveH - liveMap.baseH) < 1e-4;
  if (samePose) {
    return { xy: buf.pathXY, start, len };
  }
  const xy = new Float32Array(len * 2);
  const base = start * 2;
  for (let p = 0; p < len; p += 1) {
    const fo = base + p * 2;
    const mapped = mapSoaPathSampleToLive(buf.pathXY[fo], buf.pathXY[fo + 1], liveMap);
    xy[p * 2] = mapped.x;
    xy[p * 2 + 1] = mapped.y;
  }
  return { xy, start: 0, len };
}

function clearSoaDirtyFlag(buf: SceneRenderBuffer, index: number, flags: number, force: boolean) {
  if (!force) return;
  buf.flags[index] = (flags & ~SOA_FLAG_DIRTY) >>> 0;
}

function commitAtlasRegionInstance(
  atlas: SoaWebglAtlas,
  region: SoaAtlasRegion,
  rects: number[],
  colors: number[],
  kinds: number[],
  angles: number[],
  uvs: number[],
  rotRad: number,
  depthOut: number[] | undefined,
  slotDepth: number,
  clips: number[] | undefined,
  clip: readonly [number, number, number, number],
  strokes: number[] | undefined,
  offsetX = 0,
  offsetY = 0
) {
  pushAtlasRegionInstance(atlas, region, rects, colors, kinds, angles, uvs, rotRad, offsetX, offsetY);
  if (depthOut) depthOut.push(slotDepth);
  pushInstanceClip(clips, clip);
  pushInstanceStroke(strokes, null, 0);
}

export type CollectSoaWebglOpts = {
  atlas?: SoaWebglAtlas | null;
  bufferRevision?: number;
  /** Parallel depth [0,1] per instance when GPU DOF is active. */
  depths?: number[];
  depthForId?: (id: string) => number;
  /** Parallel scene-space LTRB clip per instance (clipContent artboards). */
  clips?: number[];
  /** Parallel stroke rgba+width for rounded SDF (kind 4); zeros for other kinds. */
  strokes?: number[];
  /** Document for clip resolve; defaults to {@link getSoaPaintDocument}. */
  document?: SceneDocument | null;
  /** Camera zoom — text atlas greeking threshold. */
  zoom?: number;
};

/**
 * Pack visible rect / ellipse / line / path instances intersecting the view.
 * kinds: 0=rect, 1=ellipse, 2=line-or-path-segment, 3=atlas path stamp, 4=rounded SDF.
 */
export function collectSoaWebglInstances(
  buf: SceneRenderBuffer,
  view: { left?: number; top?: number; x?: number; y?: number; width: number; height: number },
  rects: number[],
  colors: number[],
  kinds: number[],
  angles: number[] = [],
  uvs: number[] = [],
  opts?: CollectSoaWebglOpts
) {
  const atlas = opts?.atlas ?? null;
  const depthOut = opts?.depths;
  const depthForId = opts?.depthForId;
  const clips = opts?.clips;
  const strokes = opts?.strokes;
  const paintDoc = opts?.document ?? getSoaPaintDocument();
  const zoom = Math.max(0.05, Number(opts?.zoom) || 1);
  const vl = view.left ?? view.x ?? 0;
  const vt = view.top ?? view.y ?? 0;
  const vr = vl + view.width;
  const vb = vt + view.height;
  for (let i = 0; i < buf.count; i += 1) {
    const flags = buf.flags[i];
    if (!(flags & SOA_FLAG_VISIBLE) || !(flags & SOA_FLAG_CANVAS_IDLE)) continue;
    const idEarly = buf.ids[i];
    if (idEarly && getNodeTransformPreview(idEarly)?.hidden) continue;
    const kind = buf.kinds[i];
    if (
      kind !== SOA_KIND_RECT &&
      kind !== SOA_KIND_ELLIPSE &&
      kind !== SOA_KIND_LINE &&
      kind !== SOA_KIND_PATH &&
      kind !== SOA_KIND_POLY &&
      kind !== SOA_KIND_IMAGE &&
      kind !== SOA_KIND_TEXT
    ) {
      continue;
    }
    const { x, y, w, h, dx: odx, dy: ody } = resolveSoaPaintBox(buf, i);
    if (x + w < vl || y + h < vt || x > vr || y > vb) continue;
    const rgba = argbToRgba(buf.colors[i]);
    const strokeRgba = soaWebglStrokeRgba(buf, i);
    const lineW = floorContentStrokeSceneWidth(soaStrokeWidth(buf, i), zoom);
    const pathMaxSegs = adaptivePathStrokeMaxSegs(zoom, SOA_WEBGL_PATH_MAX_SEGS);
    const forceStamp = (flags & SOA_FLAG_DIRTY) !== 0;
    const nodeId = buf.ids[i] || '';
    const id = nodeId;
    const slotDepth = depthForId ? depthForId(nodeId) : 0.5;
    const slotClip = resolveSoaWebglSlotClip(buf, i, paintDoc);
    const paintClips: Array<[number, number, number, number]> = [
      [slotClip[0], slotClip[1], slotClip[2], slotClip[3]],
    ];

    if (kind === SOA_KIND_IMAGE) {
      const node = paintDoc?.deltaSetLike?.[id];
      if (!node || !atlas) {
        clearSoaDirtyFlag(buf, i, flags, forceStamp);
        continue;
      }
      const isAudio = String(node.key || '') === 'audio';
      const baked = isAudio
        ? bakeAudioInkForAtlas(node, w, h, zoom)
        : bakeMediaInkForAtlas(node, w, h, id);
      if (!baked) {
        if (!isAudio) {
          const src = mediaPaintSrc(node, id);
          // Pending decode → bump. CORS/tainted → stop retrying; host will paint.
          // Empty src should bake a plate — if bake still failed, clear dirty
          // (do not eternal-bump; that burned CPU and never drew).
          if (!src || (src && isFillImageWebglUnsafe(src))) {
            clearSoaDirtyFlag(buf, i, flags, forceStamp);
          } else {
            bumpSceneCanvasIdlePaint();
          }
        } else clearSoaDirtyFlag(buf, i, flags, forceStamp);
        continue;
      }
      const region = stampImageToAtlas(
        atlas,
        isAudio ? `aud:${id}` : `img:${id}`,
        baked as CanvasImageSource,
        { left: x, top: y, width: w, height: h },
        { force: forceStamp }
      );
      if (region) {
        for (const activeClip of paintClips) {
          pushAtlasRegionInstance(atlas, region, rects, colors, kinds, angles, uvs, 0, odx, ody);
          if (depthOut) depthOut.push(slotDepth);
          pushInstanceClip(clips, activeClip);
          pushInstanceStroke(strokes, null, 0);
        }
        if (forceStamp) buf.flags[i] = (flags & ~SOA_FLAG_DIRTY) >>> 0;
      }
      continue;
    }

    if (kind === SOA_KIND_TEXT) {
      const node = paintDoc?.deltaSetLike?.[id];
      if (!node || !atlas) {
        clearSoaDirtyFlag(buf, i, flags, forceStamp);
        continue;
      }
      const baked = bakeTextInkForAtlas(node, w, h, zoom);
      if (!baked) {
        clearSoaDirtyFlag(buf, i, flags, forceStamp);
        continue;
      }
      const region = stampImageToAtlas(
        atlas,
        `txt:${id}`,
        baked as CanvasImageSource,
        { left: x, top: y, width: w, height: h },
        { force: forceStamp }
      );
      if (region) {
        for (const activeClip of paintClips) {
          pushAtlasRegionInstance(atlas, region, rects, colors, kinds, angles, uvs, 0, odx, ody);
          if (depthOut) depthOut.push(slotDepth);
          pushInstanceClip(clips, activeClip);
          pushInstanceStroke(strokes, null, 0);
        }
        if (forceStamp) buf.flags[i] = (flags & ~SOA_FLAG_DIRTY) >>> 0;
      }
      continue;
    }

    // Gradient / rotated / poly / donut — Canvas bake → atlas (not BASIC_GEOM).
    if (
      (flags & SOA_FLAG_BASIC_GEOM) === 0 &&
      (kind === SOA_KIND_RECT ||
        kind === SOA_KIND_ELLIPSE ||
        kind === SOA_KIND_PATH ||
        kind === SOA_KIND_POLY)
    ) {
      const node = paintDoc?.deltaSetLike?.[id];
      if (!node || !atlas) {
        clearSoaDirtyFlag(buf, i, flags, forceStamp);
        continue;
      }
      const baked = bakeShapeInkForAtlas(node, w, h);
      if (!baked) {
        clearSoaDirtyFlag(buf, i, flags, forceStamp);
        continue;
      }
      const region = stampImageToAtlas(
        atlas,
        `rich:${id}`,
        baked as CanvasImageSource,
        { left: x, top: y, width: w, height: h },
        { force: forceStamp }
      );
      if (region) {
        for (const activeClip of paintClips) {
          pushAtlasRegionInstance(atlas, region, rects, colors, kinds, angles, uvs, 0, odx, ody);
          if (depthOut) depthOut.push(slotDepth);
          pushInstanceClip(clips, activeClip);
          pushInstanceStroke(strokes, null, 0);
        }
        if (forceStamp) buf.flags[i] = (flags & ~SOA_FLAG_DIRTY) >>> 0;
      }
      continue;
    }

    if (kind === SOA_KIND_PATH) {
      const start = buf.pathStart[i];
      const len = buf.pathLen[i];
      if (start < 0 || len < 2) continue;
      // Fill lives in colors[]; treat solid fill as closed even if pathClosed lagged.
      const closed = buf.pathClosed[i] !== 0 || buf.colors[i] !== 0;
      const segCount = countPathSegments(buf, i);
      // Frame-local live left/top can yield odx/ody — still atlas-stamp (offset the quad).
      // Blocking stamp on odx≠0 previously skipped closed fills entirely → stroke-only ghost.
      const canStamp = Boolean(atlas) && soaPathPrefersAtlasStamp(closed, segCount);
      const strokeW = Math.max(0, lineW);
      if (canStamp && atlas) {
        const id = buf.ids[i] || String(i);
        // Stamp in live scene space so frame-local / TransformPreview never
        // yields a translated AABB ghost (odx on an unmapped stamp).
        const mapped = buildLiveMappedPathStampXy(buf, i, { x, y, w, h });
        if (!mapped) {
          if (forceStamp) buf.flags[i] = (flags & ~SOA_FLAG_DIRTY) >>> 0;
          continue;
        }
        const fillCss = unpackCssColor(buf.colors[i]);
        const fillRuleAttr = String(
          paintDoc?.deltaSetLike?.[id]?.attrs?.['fill-rule'] || ''
        ).toLowerCase();
        // Fill-only atlas stamp: baked stroke AA + 256px downsample looks 虚.
        // Crisp outline is emitted as kind=2 segments on top (same as open pens).
        const region = stampSoaPathToAtlas(
          atlas,
          `path:${id}`,
          mapped.xy,
          mapped.start,
          mapped.len,
          fillCss,
          true,
          0,
          {
            force: forceStamp,
            strokeCss: unpackCssColor(buf.strokeColors[i] || 0xff333333),
            fillRule: fillRuleAttr === 'evenodd' ? 'evenodd' : 'nonzero',
          }
        );
        if (region) {
          for (const activeClip of paintClips) {
            pushAtlasRegionInstance(atlas, region, rects, colors, kinds, angles, uvs, 0, 0, 0);
            if (depthOut) depthOut.push(slotDepth);
            pushInstanceClip(clips, activeClip);
            pushInstanceStroke(strokes, null, 0);
          }
          if (strokeW > 0) {
            emitPathStrokeSegments({
              xy: mapped.xy,
              start: mapped.start,
              len: mapped.len,
              rgba: strokeRgba,
              thickness: strokeW,
              closeContours: true,
              rects,
              colors,
              kinds,
              angles,
              uvs,
              depths: depthOut,
              depth: slotDepth,
              clips,
              paintClips,
              strokes,
              maxSegs: pathMaxSegs,
            });
          }
          if (forceStamp) buf.flags[i] = (flags & ~SOA_FLAG_DIRTY) >>> 0;
          continue;
        }
      }
      // Closed fill without atlas cannot use stroke-only segments (border ghost).
      // Stroke-only closed paths (no fill) still get crisp segments.
      if (closed && buf.colors[i] !== 0) {
        if (forceStamp) buf.flags[i] = (flags & ~SOA_FLAG_DIRTY) >>> 0;
        continue;
      }
      emitPathStrokeSegments({
        xy: buf.pathXY,
        start,
        len,
        ox: odx,
        oy: ody,
        rgba: strokeRgba,
        thickness: strokeW > 0 ? strokeW : SOA_WEBGL_LINE_THICKNESS,
        closeContours: closed,
        rects,
        colors,
        kinds,
        angles,
        uvs,
        depths: depthOut,
        depth: slotDepth,
        clips,
        paintClips,
        strokes,
        maxSegs: pathMaxSegs,
      });
      if (forceStamp) buf.flags[i] = (flags & ~SOA_FLAG_DIRTY) >>> 0;
      continue;
    }

    if (kind === SOA_KIND_LINE) {
      const start = buf.pathStart[i];
      const len = buf.pathLen[i];
      if (start >= 0 && len >= 2) {
        const base = start * 2;
        let lastFinite = -1;
        let emitted = 0;
        const emitSeg = (a: number, b: number) => {
          if (emitted >= pathMaxSegs) return;
          for (const activeClip of paintClips) {
            pushLineInstance(
              buf.pathXY[a] + odx,
              buf.pathXY[a + 1] + ody,
              buf.pathXY[b] + odx,
              buf.pathXY[b + 1] + ody,
              strokeRgba,
              lineW,
              rects,
              colors,
              kinds,
              angles,
              uvs,
              depthOut,
              slotDepth,
              clips,
              activeClip,
              strokes
            );
          }
          emitted += 1;
        };
        for (let p = 0; p < len; p += 1) {
          const fo = base + p * 2;
          const px = buf.pathXY[fo];
          const py = buf.pathXY[fo + 1];
          if (!Number.isFinite(px) || !Number.isFinite(py)) {
            lastFinite = -1;
            continue;
          }
          if (lastFinite < 0) {
            lastFinite = fo;
            continue;
          }
          emitSeg(lastFinite, fo);
          lastFinite = fo;
        }
        if (forceStamp) buf.flags[i] = (flags & ~SOA_FLAG_DIRTY) >>> 0;
        continue;
      }
      const x1 = x + w;
      const y1 = y + h;
      const minX = Math.min(x, x1) - lineW;
      const minY = Math.min(y, y1) - lineW;
      const maxX = Math.max(x, x1) + lineW;
      const maxY = Math.max(y, y1) + lineW;
      if (maxX < vl || maxY < vt || minX > vr || minY > vb) continue;
      for (const activeClip of paintClips) {
        pushLineInstance(
          x,
          y,
          x1,
          y1,
          strokeRgba,
          lineW,
          rects,
          colors,
          kinds,
          angles,
          uvs,
          depthOut,
          slotDepth,
          clips,
          activeClip,
          strokes
        );
      }
      if (forceStamp) buf.flags[i] = (flags & ~SOA_FLAG_DIRTY) >>> 0;
      continue;
    }

    const liveAngle = id ? getNodeTransformPreview(id)?.angle : undefined;
    let rotDeg = 0;
    if (Number.isFinite(liveAngle) && Math.abs(Number(liveAngle)) > 0.5) {
      rotDeg = Number(liveAngle);
    }
    const rotRad = (rotDeg * Math.PI) / 180;

    const outlineW = floorContentStrokeSceneWidth(buf.strokeWidths[i] || 0, zoom);
    const outlineArgb = buf.strokeColors[i] || 0;
    const hasOutline = outlineW > 0 && outlineArgb !== 0;
    const outlineCss = hasOutline ? unpackCssColor(outlineArgb) : '';
    const fillCss = unpackCssColor(buf.colors[i]);
    const worldBox = { left: x, top: y, width: w, height: h };

    // Rounded rects → shader SDF (atlas 256px cell softens large/zoomed idle ink).
    if (kind === SOA_KIND_RECT) {
      const ro = i * 4;
      const liveR = id ? getLiveCornerRadiusPreviewRadii(id) : null;
      const tl = liveR ? liveR.tl : buf.radii[ro] || 0;
      const tr = liveR ? liveR.tr : buf.radii[ro + 1] || 0;
      const br = liveR ? liveR.br : buf.radii[ro + 2] || 0;
      const bl = liveR ? liveR.bl : buf.radii[ro + 3] || 0;
      const rounded = tl > 0.5 || tr > 0.5 || br > 0.5 || bl > 0.5;
      if (rounded || hasOutline) {
        const outlineRgba = hasOutline ? argbToRgba(outlineArgb) : null;
        for (const activeClip of paintClips) {
          rects.push(x, y, w, h);
          colors.push(rgba[0], rgba[1], rgba[2], rgba[3]);
          kinds.push(SOA_WEBGL_KIND_ROUNDED);
          angles.push(rotRad);
          uvs.push(tl, tr, br, bl);
          if (depthOut) depthOut.push(slotDepth);
          pushInstanceClip(clips, activeClip);
          pushInstanceStroke(strokes, outlineRgba, hasOutline ? outlineW : 0);
        }
        clearSoaDirtyFlag(buf, i, flags, forceStamp);
        continue;
      }
    }

    // Stroked ellipses → atlas (instanced ellipse has no outline).
    if (kind === SOA_KIND_ELLIPSE && atlas && odx === 0 && ody === 0 && hasOutline) {
      const region = stampSoaEllipseToAtlas(
        atlas,
        `ellipse:${id || i}`,
        worldBox,
        fillCss,
        {
          force: forceStamp,
          strokeCss: outlineCss,
          strokeWidth: outlineW,
        }
      );
      if (region) {
        for (const activeClip of paintClips) {
          commitAtlasRegionInstance(
            atlas,
            region,
            rects,
            colors,
            kinds,
            angles,
            uvs,
            rotRad,
            depthOut,
            slotDepth,
            clips,
            activeClip,
            strokes
          );
        }
        clearSoaDirtyFlag(buf, i, flags, forceStamp);
        continue;
      }
    }

    for (const activeClip of paintClips) {
      rects.push(x, y, w, h);
      colors.push(rgba[0], rgba[1], rgba[2], rgba[3]);
      kinds.push(kind === SOA_KIND_ELLIPSE ? 1 : 0);
      angles.push(rotRad);
      uvs.push(0, 0, 1, 1);
      if (depthOut) depthOut.push(slotDepth);
      pushInstanceClip(clips, activeClip);
      pushInstanceStroke(strokes, null, 0);
    }
    clearSoaDirtyFlag(buf, i, flags, forceStamp);
  }
}

/** WebGL ink for SoA axis-aligned rects, ellipses, lines, and path stamps. */
export function createWebglSceneRenderer(
  deps: CanvasSceneRendererDeps
): SceneRenderer | null {
  const canvas = deps.canvas;
  const gl = canvas.getContext('webgl2', {
    alpha: true,
    premultipliedAlpha: true,
    // SDF already feathers edges — MSAA double-softens 1px strokes vs SVG.
    antialias: false,
  });
  if (!gl || !isSoaCanvasShapesEnabled()) return null;

  const vs = compile(gl, gl.VERTEX_SHADER, VS);
  const fs = compile(gl, gl.FRAGMENT_SHADER, FS);
  const prog = vs && fs ? link(gl, vs, fs) : null;
  if (!prog || !vs || !fs) return null;

  const vao = gl.createVertexArray();
  const cornerBuf = gl.createBuffer();
  const rectBuf = gl.createBuffer();
  const colorBuf = gl.createBuffer();
  const kindBuf = gl.createBuffer();
  const angleBuf = gl.createBuffer();
  const uvBuf = gl.createBuffer();
  const clipBuf = gl.createBuffer();
  const strokeBuf = gl.createBuffer();
  const depthBuf = gl.createBuffer();
  const atlasTex = gl.createTexture();
  let disposed = false;
  let instanceCap = 0;
  let atlasUploadedRevision = -1;
  let atlasBufferRevision = -1;
  let dofPass: WebglDepthOfFieldPass | null = null;
  let dofVao: WebGLVertexArrayObject | null = null;
  /** Scratch typed views — avoid per-frame `new Float32Array(arr)` GC. */
  let scratchRect = new Float32Array(0);
  let scratchColor = new Float32Array(0);
  let scratchKind = new Float32Array(0);
  let scratchAngle = new Float32Array(0);
  let scratchUv = new Float32Array(0);
  let scratchClip = new Float32Array(0);
  let scratchStroke = new Float32Array(0);
  let scratchDepth = new Float32Array(0);

  function copyToScratch(src: ArrayLike<number>, prev: Float32Array): Float32Array {
    const n = src.length;
    const out = prev.length >= n ? prev : new Float32Array(Math.max(n, prev.length * 2 || 64));
    out.set(src, 0);
    return out;
  }

  function ensureDofPass(): WebglDepthOfFieldPass | null {
    if (dofPass) return dofPass;
    dofPass = createWebglDepthOfFieldPass(gl);
    if (!dofPass) return null;
    dofVao = gl.createVertexArray();
    gl.bindVertexArray(dofVao);
    bindWebglDofSceneAttributes(
      gl,
      cornerBuf,
      rectBuf,
      colorBuf,
      kindBuf,
      angleBuf,
      uvBuf,
      depthBuf,
      clipBuf,
      strokeBuf
    );
    gl.bindVertexArray(null);
    return dofPass;
  }

  gl.bindVertexArray(vao);
  gl.bindBuffer(gl.ARRAY_BUFFER, cornerBuf);
  gl.bufferData(gl.ARRAY_BUFFER, UNIT_QUAD, gl.STATIC_DRAW);
  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
  gl.vertexAttribDivisor(0, 0);

  gl.bindBuffer(gl.ARRAY_BUFFER, rectBuf);
  gl.enableVertexAttribArray(1);
  gl.vertexAttribPointer(1, 4, gl.FLOAT, false, 0, 0);
  gl.vertexAttribDivisor(1, 1);

  gl.bindBuffer(gl.ARRAY_BUFFER, colorBuf);
  gl.enableVertexAttribArray(2);
  gl.vertexAttribPointer(2, 4, gl.FLOAT, false, 0, 0);
  gl.vertexAttribDivisor(2, 1);

  gl.bindBuffer(gl.ARRAY_BUFFER, kindBuf);
  gl.enableVertexAttribArray(3);
  gl.vertexAttribPointer(3, 1, gl.FLOAT, false, 0, 0);
  gl.vertexAttribDivisor(3, 1);

  gl.bindBuffer(gl.ARRAY_BUFFER, angleBuf);
  gl.enableVertexAttribArray(4);
  gl.vertexAttribPointer(4, 1, gl.FLOAT, false, 0, 0);
  gl.vertexAttribDivisor(4, 1);

  gl.bindBuffer(gl.ARRAY_BUFFER, uvBuf);
  gl.enableVertexAttribArray(5);
  gl.vertexAttribPointer(5, 4, gl.FLOAT, false, 0, 0);
  gl.vertexAttribDivisor(5, 1);

  gl.bindBuffer(gl.ARRAY_BUFFER, clipBuf);
  gl.enableVertexAttribArray(6);
  gl.vertexAttribPointer(6, 4, gl.FLOAT, false, 0, 0);
  gl.vertexAttribDivisor(6, 1);

  gl.bindBuffer(gl.ARRAY_BUFFER, strokeBuf);
  gl.enableVertexAttribArray(7);
  gl.vertexAttribPointer(7, 4, gl.FLOAT, false, 0, 0);
  gl.vertexAttribDivisor(7, 1);
  gl.bindVertexArray(null);

  gl.bindTexture(gl.TEXTURE_2D, atlasTex);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([0, 0, 0, 0]));
  gl.bindTexture(gl.TEXTURE_2D, null);

  function ensureInstanceCapacity(n: number) {
    if (n <= instanceCap) return;
    instanceCap = Math.max(1024, n * 2);
    gl.bindBuffer(gl.ARRAY_BUFFER, rectBuf);
    gl.bufferData(gl.ARRAY_BUFFER, instanceCap * 4 * 4, gl.DYNAMIC_DRAW);
    gl.bindBuffer(gl.ARRAY_BUFFER, colorBuf);
    gl.bufferData(gl.ARRAY_BUFFER, instanceCap * 4 * 4, gl.DYNAMIC_DRAW);
    gl.bindBuffer(gl.ARRAY_BUFFER, kindBuf);
    gl.bufferData(gl.ARRAY_BUFFER, instanceCap * 4, gl.DYNAMIC_DRAW);
    gl.bindBuffer(gl.ARRAY_BUFFER, angleBuf);
    gl.bufferData(gl.ARRAY_BUFFER, instanceCap * 4, gl.DYNAMIC_DRAW);
    gl.bindBuffer(gl.ARRAY_BUFFER, uvBuf);
    gl.bufferData(gl.ARRAY_BUFFER, instanceCap * 4 * 4, gl.DYNAMIC_DRAW);
    gl.bindBuffer(gl.ARRAY_BUFFER, clipBuf);
    gl.bufferData(gl.ARRAY_BUFFER, instanceCap * 4 * 4, gl.DYNAMIC_DRAW);
    gl.bindBuffer(gl.ARRAY_BUFFER, strokeBuf);
    gl.bufferData(gl.ARRAY_BUFFER, instanceCap * 4 * 4, gl.DYNAMIC_DRAW);
    gl.bindBuffer(gl.ARRAY_BUFFER, depthBuf);
    gl.bufferData(gl.ARRAY_BUFFER, instanceCap * 4, gl.DYNAMIC_DRAW);
  }

  return {
    backend: 'webgl',
    render(req: SceneRenderRequest) {
      if (disposed) return;
      const dpr = req.dpr && req.dpr > 0 ? req.dpr : 1;
      const sw = Math.max(1, req.stage.width);
      const sh = Math.max(1, req.stage.height);
      const bw = Math.max(1, Math.round(sw * dpr));
      const bh = Math.max(1, Math.round(sh * dpr));
      if (canvas.width !== bw || canvas.height !== bh) {
        canvas.width = bw;
        canvas.height = bh;
      }
      canvas.style.width = `${sw}px`;
      canvas.style.height = `${sh}px`;

      const useDof = shouldRunGpuDepthOfField();
      const dof = useDof ? ensureDofPass() : null;
      if (dof) dof.resize(bw, bh);

      if (dof) {
        dof.bindSceneFbo();
      } else {
        gl.viewport(0, 0, bw, bh);
        gl.clearColor(0, 0, 0, 0);
        gl.clear(gl.COLOR_BUFFER_BIT);
      }
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);

      const z = rcbCameraCssZoom(req.camera);
      const pan = rcbCameraScreenOffset(req.camera, dpr);
      const view = rcbViewportSceneBounds(req.camera, { width: sw, height: sh }, dpr);
      const buf = getSharedSceneRenderBuffer();
      setSoaPaintDocument(req.document);
      const atlas = ensureSharedSoaWebglAtlas();
      if (!atlas) {
        throw new Error('SoA WebGL atlas unavailable — atlas is required for product ink');
      }
      if (atlasBufferRevision !== buf.revision) {
        // Drop orphans; dirty path/round stamps restamp in-place via force.
        pruneSoaAtlasForBuffer(atlas, buf);
        releaseSoaAtlasPrefix(atlas, 'bake:');
        atlasBufferRevision = buf.revision;
        atlasUploadedRevision = -1;
      }
      const rects: number[] = [];
      const colors: number[] = [];
      const kinds: number[] = [];
      const angles: number[] = [];
      const uvs: number[] = [];
      const clips: number[] = [];
      const strokes: number[] = [];
      const depths: number[] = [];

      let depthLookup: ReturnType<typeof buildNormalizedDepthLookup> | null = null;
      if (useDof) {
        const ids: string[] = [];
        for (let i = 0; i < buf.count; i += 1) {
          const id = buf.ids[i];
          if (id) ids.push(id);
        }
        depthLookup = buildNormalizedDepthLookup(req.document, ids);
      }

      let usedBakeAtlas = false;
      const skipBake = gpuDofSkipsSoaTileBake();
      // Keep viewport bake during selection raise — chrome / raised ink sit above.
      if (
        !skipBake &&
        shouldUseSoaBake(buf) &&
        isSoaBakePathAllowed() &&
        !hasFrameClipRevealOverflow()
      ) {
        let cache = getSharedSoaBakeCache();
        if (!cache || cache.bufferRevision !== buf.revision) {
          cache = createSoaBakeCache();
          cache.bufferRevision = buf.revision;
          setSharedSoaBakeCache(cache);
          releaseSoaAtlasPrefix(atlas, 'bake:');
        }
        const dirty = unionSoaDirtyAabb(buf);
        if (dirty) {
          const dropped = invalidateSoaBakeTilesForDirty(buf, cache, dirty);
          for (const key of dropped) {
            releaseSoaAtlasRegion(atlas, `bake:${key}`);
          }
        }
        const { tiles: readyTiles, pending: tilesPending } = collectReadySoaBakeTilesForView(
          buf,
          view
        );
        if (tilesPending) bumpSceneCanvasIdlePaint();
        // Only switch off live instances when the full viewport tile map is ready.
        // Partial stamps previously skipped live draw → blank holes / empty board.
        if (!tilesPending && readyTiles.length > 0) {
          const tileList: Array<{
            key: string;
            canvas: CanvasImageSource;
            bounds: { left: number; top: number; width: number; height: number };
            force?: boolean;
          }> = readyTiles.map((tile) => ({
            key: tile.key,
            canvas: tile.canvas as CanvasImageSource,
            bounds: tile.bounds,
            force: false,
          }));
          const stamped = collectSoaBakeTilesIntoAtlas(
            atlas,
            tileList,
            rects,
            colors,
            kinds,
            angles,
            uvs
          );
          usedBakeAtlas = stamped > 0;
          // Bake tiles already clip per slot in Canvas2D; disable shader clip.
          for (let t = 0; t < stamped; t += 1) {
            clips.push(
              SOA_WEBGL_NO_CLIP[0],
              SOA_WEBGL_NO_CLIP[1],
              SOA_WEBGL_NO_CLIP[2],
              SOA_WEBGL_NO_CLIP[3]
            );
            strokes.push(0, 0, 0, 0);
          }
        }
        if (import.meta.env.DEV && atlas.stats.misses + atlas.stats.hits > 0) {
          // Lightweight telemetry for QA — avoid spamming: only when restamps happen.
          if (atlas.stats.restamps > 0 && atlas.stats.restamps % 8 === 0) {
            // eslint-disable-next-line no-console
            console.debug('[soa-atlas]', getSoaAtlasStats(atlas));
          }
        }
      }

      if (!usedBakeAtlas) {
        collectSoaWebglInstances(buf, view, rects, colors, kinds, angles, uvs, {
          atlas,
          bufferRevision: buf.revision,
          depths: useDof ? depths : undefined,
          depthForId: depthLookup ? (id) => depthLookup!.depthForId(id) : undefined,
          clips,
          strokes,
          document: req.document,
          zoom: z,
        });
      }
      const count = kinds.length;
      if (!count) {
        if (dof) {
          dof.unbindSceneFbo();
          gl.bindFramebuffer(gl.FRAMEBUFFER, null);
          gl.viewport(0, 0, bw, bh);
          gl.clearColor(0, 0, 0, 0);
          gl.clear(gl.COLOR_BUFFER_BIT);
        }
        return;
      }

      ensureInstanceCapacity(count);
      scratchRect = copyToScratch(rects, scratchRect);
      scratchColor = copyToScratch(colors, scratchColor);
      scratchKind = copyToScratch(kinds, scratchKind);
      scratchAngle = copyToScratch(angles, scratchAngle);
      scratchUv = copyToScratch(uvs, scratchUv);
      gl.bindBuffer(gl.ARRAY_BUFFER, rectBuf);
      gl.bufferSubData(gl.ARRAY_BUFFER, 0, scratchRect.subarray(0, rects.length));
      gl.bindBuffer(gl.ARRAY_BUFFER, colorBuf);
      gl.bufferSubData(gl.ARRAY_BUFFER, 0, scratchColor.subarray(0, colors.length));
      gl.bindBuffer(gl.ARRAY_BUFFER, kindBuf);
      gl.bufferSubData(gl.ARRAY_BUFFER, 0, scratchKind.subarray(0, kinds.length));
      gl.bindBuffer(gl.ARRAY_BUFFER, angleBuf);
      gl.bufferSubData(gl.ARRAY_BUFFER, 0, scratchAngle.subarray(0, angles.length));
      gl.bindBuffer(gl.ARRAY_BUFFER, uvBuf);
      gl.bufferSubData(gl.ARRAY_BUFFER, 0, scratchUv.subarray(0, uvs.length));
      const clipFill =
        clips.length === count * 4
          ? clips
          : Array.from({ length: count * 4 }, (_, i) => SOA_WEBGL_NO_CLIP[i % 4]);
      scratchClip = copyToScratch(clipFill, scratchClip);
      gl.bindBuffer(gl.ARRAY_BUFFER, clipBuf);
      gl.bufferSubData(gl.ARRAY_BUFFER, 0, scratchClip.subarray(0, count * 4));
      const strokeFill =
        strokes.length === count * 4
          ? strokes
          : Array.from({ length: count * 4 }, () => 0);
      scratchStroke = copyToScratch(strokeFill, scratchStroke);
      gl.bindBuffer(gl.ARRAY_BUFFER, strokeBuf);
      gl.bufferSubData(gl.ARRAY_BUFFER, 0, scratchStroke.subarray(0, count * 4));
      if (useDof) {
        const depthFill =
          depths.length === count
            ? depths
            : Array.from({ length: count }, () => 0.5);
        scratchDepth = copyToScratch(depthFill, scratchDepth);
        gl.bindBuffer(gl.ARRAY_BUFFER, depthBuf);
        gl.bufferSubData(gl.ARRAY_BUFFER, 0, scratchDepth.subarray(0, count));
      }

      if (atlas.revision !== atlasUploadedRevision) {
        gl.bindTexture(gl.TEXTURE_2D, atlasTex);
        gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, 1);
        try {
          gl.texImage2D(
            gl.TEXTURE_2D,
            0,
            gl.RGBA,
            gl.RGBA,
            gl.UNSIGNED_BYTE,
            atlas.canvas as TexImageSource
          );
          atlasUploadedRevision = atlas.revision;
        } catch {
          // Tainted atlas (cross-origin draw without CORS). Replace surface so
          // later stamps can recover; this frame draws with the last good tex.
          recreateSharedSoaWebglAtlas();
          atlasUploadedRevision = -1;
        }
      }

      const drawProg = dof ? dof.sceneProgram : prog;
      gl.useProgram(drawProg);
      gl.uniform2f(gl.getUniformLocation(drawProg, 'uPan'), pan.x, pan.y);
      gl.uniform1f(gl.getUniformLocation(drawProg, 'uZoom'), z);
      gl.uniform2f(gl.getUniformLocation(drawProg, 'uStage'), sw, sh);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, atlasTex);
      gl.uniform1i(gl.getUniformLocation(drawProg, 'uAtlas'), 0);
      gl.bindVertexArray(useDof && dofVao ? dofVao : vao);
      gl.drawArraysInstanced(gl.TRIANGLES, 0, 6, count);
      gl.bindVertexArray(null);

      if (dof) {
        dof.unbindSceneFbo();
        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
        gl.viewport(0, 0, bw, bh);
        dof.compositeToScreen();
      }
    },
    hitTest(point, screen) {
      return hitTestWithSpatialIndex(deps, point, screen);
    },
    dispose() {
      disposed = true;
      dofPass?.dispose();
      dofPass = null;
      gl.deleteProgram(prog);
      gl.deleteShader(vs);
      gl.deleteShader(fs);
      gl.deleteBuffer(cornerBuf);
      gl.deleteBuffer(rectBuf);
      gl.deleteBuffer(colorBuf);
      gl.deleteBuffer(kindBuf);
      gl.deleteBuffer(angleBuf);
      gl.deleteBuffer(uvBuf);
      gl.deleteBuffer(clipBuf);
      gl.deleteBuffer(strokeBuf);
      gl.deleteBuffer(depthBuf);
      gl.deleteTexture(atlasTex);
      gl.deleteVertexArray(vao);
      if (dofVao) gl.deleteVertexArray(dofVao);
    },
  };
}
