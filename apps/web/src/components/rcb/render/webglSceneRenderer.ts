/**
 * WebGL2 backend for SoA rect + ellipse + line + path (ADR 0027 Phase 4).
 * Unit-quad instancing; dense paths may stamp into a texture atlas (kind=3).
 */
import { rcbCameraCssZoom, rcbCameraScreenOffset, rcbViewportSceneBounds } from '@/components/rcb/core/math';
import { getNodeTransformPreview, hasNodeTransformPreviews } from '@/components/rcb/core/transformPreview';
import {
  getSharedSceneRenderBuffer,
  isSoaCanvasShapesEnabled,
  resolveSoaPaintBox,
  setSoaPaintDocument,
  SOA_FLAG_CANVAS_IDLE,
  SOA_FLAG_DIRTY,
  SOA_FLAG_VISIBLE,
  SOA_KIND_ELLIPSE,
  SOA_KIND_LINE,
  SOA_KIND_PATH,
  SOA_KIND_RECT,
  soaStrokeWidth,
  unpackCssColor,
  type SceneRenderBuffer,
} from '@/components/rcb/render/sceneRenderBuffer';
import {
  collectSoaBakeTilesIntoAtlas,
  ensureSharedSoaWebglAtlas,
  getSoaAtlasStats,
  isSoaWebglAtlasEnabled,
  pruneSoaAtlasForBuffer,
  pushAtlasRegionInstance,
  releaseSoaAtlasPrefix,
  releaseSoaAtlasRegion,
  SOA_ATLAS_SEG_THRESHOLD,
  stampSoaPathToAtlas,
  stampSoaRoundedRectToAtlas,
  type SoaWebglAtlas,
} from '@/components/rcb/render/webglInstanceAtlas';
import {
  createSoaBakeCache,
  ensureSoaBakeTile,
  getSharedSoaBakeCache,
  invalidateSoaBakeTilesForDirty,
  setSharedSoaBakeCache,
  shouldUseSoaBake,
  tileKey,
  tilesForView,
  unionSoaDirtyAabb,
} from '@/components/rcb/render/soaBakeLayer';
import {
  hitTestWithSpatialIndex,
  type CanvasSceneRendererDeps,
  type SceneRenderRequest,
  type SceneRenderer,
} from '@/components/rcb/render/sceneRenderer';
import { hasFrameClipRevealOverflow, hasSelectionPaintRaise } from '@/components/rcb/frames/frameContentClip';
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
out vec2 vUv;
out vec2 vAtlasUv;
out vec4 vColor;
out float vKind;
void main() {
  vec2 local;
  if (aKind > 1.5 && aKind < 2.5) {
    local = vec2(aCorner.x * aRect.z, (aCorner.y - 0.5) * aRect.w);
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
}`;

const FS = `#version 300 es
precision mediump float;
uniform sampler2D uAtlas;
in vec2 vUv;
in vec2 vAtlasUv;
in vec4 vColor;
in float vKind;
out vec4 outColor;
void main() {
  if (vKind > 2.5) {
    vec4 tex = texture(uAtlas, vAtlasUv);
    if (tex.a < 0.01) discard;
    outColor = tex;
    return;
  }
  if (vKind > 0.5 && vKind < 1.5) {
    if (dot(vUv, vUv) > 1.0) discard;
  }
  outColor = vColor;
}`;

const UNIT_QUAD = new Float32Array([0, 0, 1, 0, 1, 1, 0, 0, 1, 1, 0, 1]);
/** Default line thickness in scene units (used when SoA stroke width is unset). */
export const SOA_WEBGL_LINE_THICKNESS = 2;
/** Cap segments emitted per path so one dense stroke cannot explode the instance batch. */
export const SOA_WEBGL_PATH_MAX_SEGS = 48;

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
  depth: number
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

/** Closed paths must atlas-stamp (segment instances are stroke-only). */
export function soaPathPrefersAtlasStamp(closed: boolean, segCount: number): boolean {
  return closed || segCount >= SOA_ATLAS_SEG_THRESHOLD;
}

export type CollectSoaWebglOpts = {
  atlas?: SoaWebglAtlas | null;
  bufferRevision?: number;
  /** Parallel depth [0,1] per instance when GPU DOF is active. */
  depths?: number[];
  depthForId?: (id: string) => number;
};

/**
 * Pack visible rect / ellipse / line / path instances intersecting the view.
 * kinds: 0=rect, 1=ellipse, 2=line-or-path-segment, 3=atlas path stamp.
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
      kind !== SOA_KIND_PATH
    ) {
      continue;
    }
    const { x, y, w, h, dx: odx, dy: ody } = resolveSoaPaintBox(buf, i);
    if (x + w < vl || y + h < vt || x > vr || y > vb) continue;
    const rgba = argbToRgba(buf.colors[i]);
    const lineW = soaStrokeWidth(buf, i);
    const forceStamp = (flags & SOA_FLAG_DIRTY) !== 0;
    const nodeId = buf.ids[i] || '';
    const slotDepth = depthForId ? depthForId(nodeId) : 0.5;

    if (kind === SOA_KIND_PATH) {
      const start = buf.pathStart[i];
      const len = buf.pathLen[i];
      if (start < 0 || len < 2) continue;
      const closed = buf.pathClosed[i] !== 0;
      const segCount = countPathSegments(buf, i);
      const canStamp =
        Boolean(atlas) && odx === 0 && ody === 0 && soaPathPrefersAtlasStamp(closed, segCount);
      if (canStamp && atlas) {
        const id = buf.ids[i] || String(i);
        const region = stampSoaPathToAtlas(
          atlas,
          `path:${id}`,
          buf.pathXY,
          start,
          len,
          unpackCssColor(buf.colors[i]),
          closed,
          lineW,
          {
            force: forceStamp,
            strokeCss: unpackCssColor(buf.strokeColors[i] || 0xff333333),
          }
        );
        if (region) {
          pushAtlasRegionInstance(atlas, region, rects, colors, kinds, angles, uvs);
          if (depthOut) depthOut.push(slotDepth);
          if (forceStamp) buf.flags[i] = (flags & ~SOA_FLAG_DIRTY) >>> 0;
          continue;
        }
      }
      // Closed fill cannot use stroke segments (border-only idle ghost).
      if (closed) {
        if (forceStamp) buf.flags[i] = (flags & ~SOA_FLAG_DIRTY) >>> 0;
        continue;
      }
      const base = start * 2;
      let lastFinite = -1;
      let emitted = 0;
      const emitSeg = (a: number, b: number) => {
        if (emitted >= SOA_WEBGL_PATH_MAX_SEGS) return;
        pushLineInstance(
          buf.pathXY[a] + odx,
          buf.pathXY[a + 1] + ody,
          buf.pathXY[b] + odx,
          buf.pathXY[b + 1] + ody,
          rgba,
          lineW,
          rects,
          colors,
          kinds,
          angles,
          uvs,
          depthOut,
          slotDepth
        );
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

    if (kind === SOA_KIND_LINE) {
      const start = buf.pathStart[i];
      const len = buf.pathLen[i];
      if (start >= 0 && len >= 2) {
        const base = start * 2;
        let lastFinite = -1;
        let emitted = 0;
        const emitSeg = (a: number, b: number) => {
          if (emitted >= SOA_WEBGL_PATH_MAX_SEGS) return;
          pushLineInstance(
            buf.pathXY[a] + odx,
            buf.pathXY[a + 1] + ody,
            buf.pathXY[b] + odx,
            buf.pathXY[b + 1] + ody,
            rgba,
            lineW,
            rects,
            colors,
            kinds,
            angles,
            uvs,
            depthOut,
            slotDepth
          );
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
      pushLineInstance(x, y, x1, y1, rgba, lineW, rects, colors, kinds, angles, uvs, depthOut, slotDepth);
      if (forceStamp) buf.flags[i] = (flags & ~SOA_FLAG_DIRTY) >>> 0;
      continue;
    }

    const id = buf.ids[i];
    const liveAngle = id ? getNodeTransformPreview(id)?.angle : undefined;
    const rotDeg =
      Number.isFinite(liveAngle) && Math.abs(Number(liveAngle)) > 0.5
        ? Number(liveAngle)
        : 0;

    // Rounded rects: stamp into atlas (sharp instanced quads cannot round).
    if (kind === SOA_KIND_RECT && atlas && odx === 0 && ody === 0) {
      const ro = i * 4;
      const tl = buf.radii[ro] || 0;
      const tr = buf.radii[ro + 1] || 0;
      const br = buf.radii[ro + 2] || 0;
      const bl = buf.radii[ro + 3] || 0;
      if (tl > 0.5 || tr > 0.5 || br > 0.5 || bl > 0.5) {
        const key = `round:${id || i}`;
        const region = stampSoaRoundedRectToAtlas(
          atlas,
          key,
          { left: x, top: y, width: w, height: h },
          unpackCssColor(buf.colors[i]),
          { tl, tr, br, bl },
          { force: forceStamp }
        );
        if (region) {
          pushAtlasRegionInstance(
            atlas,
            region,
            rects,
            colors,
            kinds,
            angles,
            uvs,
            (rotDeg * Math.PI) / 180
          );
          if (depthOut) depthOut.push(slotDepth);
          if (forceStamp) buf.flags[i] = (flags & ~SOA_FLAG_DIRTY) >>> 0;
          continue;
        }
      }
    }

    rects.push(x, y, w, h);
    colors.push(rgba[0], rgba[1], rgba[2], rgba[3]);
    kinds.push(kind === SOA_KIND_ELLIPSE ? 1 : 0);
    angles.push((rotDeg * Math.PI) / 180);
    uvs.push(0, 0, 1, 1);
    if (depthOut) depthOut.push(slotDepth);
    if (forceStamp) buf.flags[i] = (flags & ~SOA_FLAG_DIRTY) >>> 0;
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
    antialias: true,
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
  const depthBuf = gl.createBuffer();
  const atlasTex = gl.createTexture();
  let disposed = false;
  let instanceCap = 0;
  let atlasUploadedRevision = -1;
  let atlasBufferRevision = -1;
  let dofPass: WebglDepthOfFieldPass | null = null;
  let dofVao: WebGLVertexArrayObject | null = null;

  function ensureDofPass(): WebglDepthOfFieldPass | null {
    if (dofPass) return dofPass;
    dofPass = createWebglDepthOfFieldPass(gl);
    if (!dofPass) return null;
    dofVao = gl.createVertexArray();
    gl.bindVertexArray(dofVao);
    bindWebglDofSceneAttributes(gl, cornerBuf, rectBuf, colorBuf, kindBuf, angleBuf, uvBuf, depthBuf);
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
      const atlas = isSoaWebglAtlasEnabled() ? ensureSharedSoaWebglAtlas() : null;
      if (atlas && atlasBufferRevision !== buf.revision) {
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
      // Bake tiles stamp locked z-order — skip while selection raise / reveal.
      if (
        !skipBake &&
        atlas &&
        shouldUseSoaBake(buf) &&
        !hasNodeTransformPreviews() &&
        !hasFrameClipRevealOverflow() &&
        !hasSelectionPaintRaise()
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
        const tileList: Array<{
          key: string;
          canvas: CanvasImageSource;
          bounds: { left: number; top: number; width: number; height: number };
          force?: boolean;
        }> = [];
        for (const { tx, ty, bounds } of tilesForView(view, cache.tileWorld)) {
          const key = tileKey(tx, ty);
          const wasCached = Boolean(
            cache.tiles.get(key) && cache.tiles.get(key)!.bufferRevision === buf.revision
          );
          const tile = ensureSoaBakeTile(buf, cache, tx, ty, bounds);
          if (!tile) continue;
          tileList.push({
            key: tile.key,
            canvas: tile.canvas as CanvasImageSource,
            bounds: tile.bounds,
            force: !wasCached,
          });
        }
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
      gl.bindBuffer(gl.ARRAY_BUFFER, rectBuf);
      gl.bufferSubData(gl.ARRAY_BUFFER, 0, new Float32Array(rects));
      gl.bindBuffer(gl.ARRAY_BUFFER, colorBuf);
      gl.bufferSubData(gl.ARRAY_BUFFER, 0, new Float32Array(colors));
      gl.bindBuffer(gl.ARRAY_BUFFER, kindBuf);
      gl.bufferSubData(gl.ARRAY_BUFFER, 0, new Float32Array(kinds));
      gl.bindBuffer(gl.ARRAY_BUFFER, angleBuf);
      gl.bufferSubData(gl.ARRAY_BUFFER, 0, new Float32Array(angles));
      gl.bindBuffer(gl.ARRAY_BUFFER, uvBuf);
      gl.bufferSubData(gl.ARRAY_BUFFER, 0, new Float32Array(uvs));
      if (useDof) {
        const depthFill =
          depths.length === count
            ? depths
            : Array.from({ length: count }, () => 0.5);
        gl.bindBuffer(gl.ARRAY_BUFFER, depthBuf);
        gl.bufferSubData(gl.ARRAY_BUFFER, 0, new Float32Array(depthFill));
      }

      if (atlas && atlas.revision !== atlasUploadedRevision) {
        gl.bindTexture(gl.TEXTURE_2D, atlasTex);
        gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, 1);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, atlas.canvas as TexImageSource);
        atlasUploadedRevision = atlas.revision;
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
      gl.deleteBuffer(depthBuf);
      gl.deleteTexture(atlasTex);
      gl.deleteVertexArray(vao);
      if (dofVao) gl.deleteVertexArray(dofVao);
    },
  };
}
