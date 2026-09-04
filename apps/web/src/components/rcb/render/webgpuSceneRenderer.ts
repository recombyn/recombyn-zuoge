/**
 * WebGPU SoA ink + depth-of-field — color/depth MRT, CoC separable blur, swapchain composite.
 * High-end path when `VITE_GPU_DOF=1` and `VITE_GPU_DOF_BACKEND=webgpu` (or WebGL off).
 */
/// <reference types="@webgpu/types" />
import { rcbCameraCssZoom, rcbCameraScreenOffset, rcbViewportSceneBounds } from '@/components/rcb/core/math';
import { hasNodeTransformPreviews } from '@/components/rcb/core/transformPreview';
import { hasFrameClipRevealOverflow } from '@/components/rcb/frames/frameContentClip';
import {
  buildNormalizedDepthLookup,
  clampDownsample,
  getGpuDepthOfFieldParams,
  shouldRunGpuDepthOfField,
} from '@/components/rcb/render/gpuDepthOfField';
import {
  getSharedSceneRenderBuffer,
  isSoaCanvasShapesEnabled,
  setSoaPaintDocument,
} from '@/components/rcb/render/sceneRenderBuffer';
import {
  ensureSharedSoaWebglAtlas,
  pruneSoaAtlasForBuffer,
  releaseSoaAtlasPrefix,
} from '@/components/rcb/render/webglInstanceAtlas';
import { collectSoaWebglInstances, SOA_WEBGL_NO_CLIP } from '@/components/rcb/render/webglSceneRenderer';
import {
  bumpSceneCanvasIdlePaint,
  hitTestWithSpatialIndex,
  type CanvasSceneRendererDeps,
  type SceneRenderRequest,
  type SceneRenderer,
} from '@/components/rcb/render/sceneRenderer';

const UNIT_QUAD = new Float32Array([0, 0, 1, 0, 1, 1, 0, 0, 1, 1, 0, 1]);
const FULLSCREEN = new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]);

const SCENE_WGSL = /* wgsl */ `
struct Uniforms { pan: vec2f, zoom: f32, stage: vec2f, _pad: f32 };
@group(0) @binding(0) var<uniform> u: Uniforms;
@group(1) @binding(0) var atlasTex: texture_2d<f32>;
@group(1) @binding(1) var atlasSmp: sampler;

struct VsOut {
  @builtin(position) pos: vec4f,
  @location(0) uv: vec2f,
  @location(1) atlasUv: vec2f,
  @location(2) color: vec4f,
  @location(3) kind: f32,
  @location(4) depth: f32,
  @location(5) world: vec2f,
  @location(6) clipRect: vec4f,
};

@vertex fn vs(
  @location(0) corner: vec2f,
  @location(1) rect: vec4f,
  @location(2) color: vec4f,
  @location(3) kind: f32,
  @location(4) angle: f32,
  @location(5) uvRect: vec4f,
  @location(6) depth: f32,
  @location(7) clipRect: vec4f,
) -> VsOut {
  var local: vec2f;
  if (kind > 1.5 && kind < 2.5) {
    local = vec2f(corner.x * rect.z, (corner.y - 0.5) * rect.w);
  } else {
    local = corner * rect.zw;
  }
  let c = cos(angle);
  let s = sin(angle);
  let pos = rect.xy + vec2f(c * local.x - s * local.y, s * local.x + c * local.y);
  let screen = pos * u.zoom + u.pan;
  let clip = vec2f(
    (screen.x / u.stage.x) * 2.0 - 1.0,
    1.0 - (screen.y / u.stage.y) * 2.0
  );
  var o: VsOut;
  o.pos = vec4f(clip, 0.0, 1.0);
  o.uv = corner * 2.0 - 1.0;
  o.atlasUv = mix(uvRect.xy, uvRect.zw, corner);
  o.color = color;
  o.kind = kind;
  o.depth = depth;
  o.world = pos;
  o.clipRect = clipRect;
  return o;
}

struct FragOut {
  @location(0) color: vec4f,
  @location(1) depth: vec4f,
};

@fragment fn fs(in: VsOut) -> FragOut {
  var out: FragOut;
  if (in.world.x < in.clipRect.x || in.world.y < in.clipRect.y || in.world.x > in.clipRect.z || in.world.y > in.clipRect.w) {
    discard;
  }
  if (in.kind > 2.5) {
    let tex = textureSample(atlasTex, atlasSmp, in.atlasUv);
    if (tex.a < 0.01) { discard; }
    out.color = tex;
    out.depth = vec4f(in.depth, 0.0, 0.0, 1.0);
    return out;
  }
  if (in.kind > 0.5 && in.kind < 1.5) {
    if (dot(in.uv, in.uv) > 1.0) { discard; }
  }
  out.color = in.color;
  out.depth = vec4f(in.depth, 0.0, 0.0, 1.0);
  return out;
}
`;

const BLUR_WGSL = /* wgsl */ `
struct BlurU { texel: vec2f, dir: vec2f, focal: f32, maxCoC: f32, aperture: f32, _pad: f32 };
@group(0) @binding(0) var colorTex: texture_2d<f32>;
@group(0) @binding(1) var depthTex: texture_2d<f32>;
@group(0) @binding(2) var smp: sampler;
@group(0) @binding(3) var<uniform> bu: BlurU;

struct VOut { @builtin(position) pos: vec4f, @location(0) uv: vec2f };

@vertex fn vs(@location(0) pos: vec2f) -> VOut {
  var o: VOut;
  o.pos = vec4f(pos, 0.0, 1.0);
  o.uv = pos * 0.5 + 0.5;
  return o;
}

@fragment fn fs(in: VOut) -> @location(0) vec4f {
  let depth = textureSample(depthTex, smp, in.uv).r;
  let coc = min(bu.maxCoC, abs(depth - bu.focal) * bu.aperture * bu.maxCoC);
  if (coc < 0.75) { return textureSample(colorTex, smp, in.uv); }
  var acc = vec4f(0.0);
  var wsum = 0.0;
  let taps = 12;
  for (var i = -taps; i <= taps; i++) {
    let fi = f32(i) / f32(taps);
    let w = exp(-2.5 * fi * fi);
    acc += textureSample(colorTex, smp, in.uv + bu.dir * bu.texel * coc * fi) * w;
    wsum += w;
  }
  return acc / max(wsum, 1e-4);
}
`;

type GpuRuntime = {
  device: GPUDevice;
  context: GPUCanvasContext;
  format: GPUTextureFormat;
  scenePipeline: GPURenderPipeline;
  blurPipeline: GPURenderPipeline;
  sceneBindGroupLayout: GPUBindGroupLayout;
  atlasBindGroupLayout: GPUBindGroupLayout;
  blurBindGroupLayout: GPUBindGroupLayout;
  uniformBuf: GPUBuffer;
  blurUniformBuf: GPUBuffer;
  cornerBuf: GPUBuffer;
  quadBuf: GPUBuffer;
  rectBuf: GPUBuffer;
  colorBuf: GPUBuffer;
  kindBuf: GPUBuffer;
  angleBuf: GPUBuffer;
  uvBuf: GPUBuffer;
  depthBuf: GPUBuffer;
  clipBuf: GPUBuffer;
  sampler: GPUSampler;
  colorTex: GPUTexture | null;
  depthTex: GPUTexture | null;
  pingTex: GPUTexture | null;
  atlasTex: GPUTexture | null;
  atlasBindGroup: GPUBindGroup | null;
  texW: number;
  texH: number;
  instanceCap: number;
  atlasRevision: number;
};

async function initWebgpu(canvas: HTMLCanvasElement): Promise<GpuRuntime | null> {
  if (!navigator.gpu || !shouldRunGpuDepthOfField() || !isSoaCanvasShapesEnabled()) {
    return null;
  }
  const context = canvas.getContext('webgpu') as GPUCanvasContext | null;
  if (!context) return null;
  const adapter = await navigator.gpu.requestAdapter({ powerPreference: 'high-performance' });
  if (!adapter) return null;
  const device = await adapter.requestDevice();
  const format = navigator.gpu.getPreferredCanvasFormat();
  context.configure({ device, format, alphaMode: 'premultiplied' });

  const sceneModule = device.createShaderModule({ code: SCENE_WGSL });
  const blurModule = device.createShaderModule({ code: BLUR_WGSL });

  const sceneBindGroupLayout = device.createBindGroupLayout({
    entries: [{ binding: 0, visibility: GPUShaderStage.VERTEX, buffer: { type: 'uniform' } }],
  });
  const atlasBindGroupLayout = device.createBindGroupLayout({
    entries: [
      { binding: 0, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: 'float' } },
      { binding: 1, visibility: GPUShaderStage.FRAGMENT, sampler: { type: 'filtering' } },
    ],
  });
  const blurBindGroupLayout = device.createBindGroupLayout({
    entries: [
      { binding: 0, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: 'float' } },
      { binding: 1, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: 'float' } },
      { binding: 2, visibility: GPUShaderStage.FRAGMENT, sampler: { type: 'filtering' } },
      { binding: 3, visibility: GPUShaderStage.FRAGMENT, buffer: { type: 'uniform' } },
    ],
  });

  const pipelineLayout = device.createPipelineLayout({
    bindGroupLayouts: [sceneBindGroupLayout, atlasBindGroupLayout],
  });

  const instanceBuffers: GPUVertexBufferLayout[] = [
    {
      arrayStride: 8,
      stepMode: 'vertex',
      attributes: [{ shaderLocation: 0, offset: 0, format: 'float32x2' }],
    },
    {
      arrayStride: 16,
      stepMode: 'instance',
      attributes: [{ shaderLocation: 1, offset: 0, format: 'float32x4' }],
    },
    {
      arrayStride: 16,
      stepMode: 'instance',
      attributes: [{ shaderLocation: 2, offset: 0, format: 'float32x4' }],
    },
    {
      arrayStride: 4,
      stepMode: 'instance',
      attributes: [{ shaderLocation: 3, offset: 0, format: 'float32' }],
    },
    {
      arrayStride: 4,
      stepMode: 'instance',
      attributes: [{ shaderLocation: 4, offset: 0, format: 'float32' }],
    },
    {
      arrayStride: 16,
      stepMode: 'instance',
      attributes: [{ shaderLocation: 5, offset: 0, format: 'float32x4' }],
    },
    {
      arrayStride: 4,
      stepMode: 'instance',
      attributes: [{ shaderLocation: 6, offset: 0, format: 'float32' }],
    },
    {
      arrayStride: 16,
      stepMode: 'instance',
      attributes: [{ shaderLocation: 7, offset: 0, format: 'float32x4' }],
    },
  ];

  const scenePipeline = device.createRenderPipeline({
    layout: pipelineLayout,
    vertex: { module: sceneModule, entryPoint: 'vs', buffers: instanceBuffers },
    fragment: {
      module: sceneModule,
      entryPoint: 'fs',
      targets: [
        { format: 'rgba8unorm', blend: {
          color: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha', operation: 'add' },
          alpha: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha', operation: 'add' },
        }},
        { format: 'rgba8unorm' },
      ],
    },
    primitive: { topology: 'triangle-list' },
  });

  const blurPipeline = device.createRenderPipeline({
    layout: device.createPipelineLayout({ bindGroupLayouts: [blurBindGroupLayout] }),
    vertex: {
      module: blurModule,
      entryPoint: 'vs',
      buffers: [{
        arrayStride: 8,
        attributes: [{ shaderLocation: 0, offset: 0, format: 'float32x2' }],
      }],
    },
    fragment: {
      module: blurModule,
      entryPoint: 'fs',
      targets: [{
        format: 'rgba8unorm',
        blend: {
          color: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha', operation: 'add' },
          alpha: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha', operation: 'add' },
        },
      }],
    },
    primitive: { topology: 'triangle-strip' },
  });

  const sampler = device.createSampler({ magFilter: 'linear', minFilter: 'linear' });
  const uniformBuf = device.createBuffer({ size: 32, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
  const blurUniformBuf = device.createBuffer({ size: 32, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
  const cornerBuf = device.createBuffer({
    size: UNIT_QUAD.byteLength,
    usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
  });
  device.queue.writeBuffer(cornerBuf, 0, UNIT_QUAD);
  const quadBuf = device.createBuffer({
    size: FULLSCREEN.byteLength,
    usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
  });
  device.queue.writeBuffer(quadBuf, 0, FULLSCREEN);

  const atlasTex = device.createTexture({
    size: [1, 1],
    format: 'rgba8unorm',
    usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST | GPUTextureUsage.RENDER_ATTACHMENT,
  });

  return {
    device,
    context,
    format,
    scenePipeline,
    blurPipeline,
    sceneBindGroupLayout,
    atlasBindGroupLayout,
    blurBindGroupLayout,
    uniformBuf,
    blurUniformBuf,
    cornerBuf,
    quadBuf,
    rectBuf: device.createBuffer({ size: 4096, usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST }),
    colorBuf: device.createBuffer({ size: 4096, usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST }),
    kindBuf: device.createBuffer({ size: 1024, usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST }),
    angleBuf: device.createBuffer({ size: 1024, usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST }),
    uvBuf: device.createBuffer({ size: 4096, usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST }),
    depthBuf: device.createBuffer({ size: 1024, usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST }),
    clipBuf: device.createBuffer({ size: 4096, usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST }),
    sampler,
    colorTex: null,
    depthTex: null,
    pingTex: null,
    atlasTex,
    atlasBindGroup: null,
    texW: 0,
    texH: 0,
    instanceCap: 0,
    atlasRevision: -1,
  };
}

function ensureInstanceCapacity(gpu: GpuRuntime, count: number) {
  if (count <= gpu.instanceCap) return;
  gpu.instanceCap = Math.max(256, count * 2);
  const { device } = gpu;
  gpu.rectBuf.destroy();
  gpu.colorBuf.destroy();
  gpu.kindBuf.destroy();
  gpu.angleBuf.destroy();
  gpu.uvBuf.destroy();
  gpu.depthBuf.destroy();
  gpu.clipBuf.destroy();
  gpu.rectBuf = device.createBuffer({
    size: gpu.instanceCap * 16,
    usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
  });
  gpu.colorBuf = device.createBuffer({
    size: gpu.instanceCap * 16,
    usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
  });
  gpu.kindBuf = device.createBuffer({
    size: gpu.instanceCap * 4,
    usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
  });
  gpu.angleBuf = device.createBuffer({
    size: gpu.instanceCap * 4,
    usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
  });
  gpu.uvBuf = device.createBuffer({
    size: gpu.instanceCap * 16,
    usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
  });
  gpu.depthBuf = device.createBuffer({
    size: gpu.instanceCap * 4,
    usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
  });
  gpu.clipBuf = device.createBuffer({
    size: gpu.instanceCap * 16,
    usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
  });
}

function ensureRenderTargets(gpu: GpuRuntime, w: number, h: number) {
  if (gpu.texW === w && gpu.texH === h && gpu.colorTex) return;
  gpu.colorTex?.destroy();
  gpu.depthTex?.destroy();
  gpu.pingTex?.destroy();
  gpu.texW = w;
  gpu.texH = h;
  const size = { width: w, height: h };
  const usage = GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING;
  gpu.colorTex = gpu.device.createTexture({ size, format: 'rgba8unorm', usage });
  gpu.depthTex = gpu.device.createTexture({ size, format: 'rgba8unorm', usage });
  gpu.pingTex = gpu.device.createTexture({ size, format: 'rgba8unorm', usage });
}

function uploadAtlas(
  gpu: GpuRuntime,
  atlasCanvas: HTMLCanvasElement | OffscreenCanvas,
  revision: number
) {
  if (gpu.atlasRevision === revision) return;
  gpu.atlasRevision = revision;
  const w = Math.max(1, atlasCanvas.width);
  const h = Math.max(1, atlasCanvas.height);
  if (gpu.atlasTex) gpu.atlasTex.destroy();
  gpu.atlasTex = gpu.device.createTexture({
    size: [w, h],
    format: 'rgba8unorm',
    usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
  });
  gpu.device.queue.copyExternalImageToTexture(
    { source: atlasCanvas },
    { texture: gpu.atlasTex },
    [w, h]
  );
  gpu.atlasBindGroup = gpu.device.createBindGroup({
    layout: gpu.atlasBindGroupLayout,
    entries: [
      { binding: 0, resource: gpu.atlasTex.createView() },
      { binding: 1, resource: gpu.sampler },
    ],
  });
}

function drawFrame(gpu: GpuRuntime, canvas: HTMLCanvasElement, req: SceneRenderRequest) {
  const dpr = req.dpr && req.dpr > 0 ? req.dpr : 1;
  const sw = Math.max(1, req.stage.width);
  const sh = Math.max(1, req.stage.height);
  const bw = Math.max(1, Math.round(sw * dpr));
  const bh = Math.max(1, Math.round(sh * dpr));
  if (canvas.width !== bw || canvas.height !== bh) {
    canvas.width = bw;
    canvas.height = bh;
    gpu.context.configure({ device: gpu.device, format: gpu.format, alphaMode: 'premultiplied' });
  }
  canvas.style.width = `${sw}px`;
  canvas.style.height = `${sh}px`;

  const ds = clampDownsample(getGpuDepthOfFieldParams().downsample);
  const tw = Math.max(1, Math.floor(bw / ds));
  const th = Math.max(1, Math.floor(bh / ds));
  ensureRenderTargets(gpu, tw, th);

  const z = rcbCameraCssZoom(req.camera);
  const pan = rcbCameraScreenOffset(req.camera, dpr);
  const view = rcbViewportSceneBounds(req.camera, { width: sw, height: sh }, dpr);
  const buf = getSharedSceneRenderBuffer();
  setSoaPaintDocument(req.document);

  const atlas = ensureSharedSoaWebglAtlas();
  if (!atlas) {
    throw new Error('SoA WebGL atlas unavailable — atlas is required for product ink');
  }
  pruneSoaAtlasForBuffer(atlas, buf);
  releaseSoaAtlasPrefix(atlas, 'bake:');
  uploadAtlas(gpu, atlas.canvas, atlas.revision);

  const rects: number[] = [];
  const colors: number[] = [];
  const kinds: number[] = [];
  const angles: number[] = [];
  const uvs: number[] = [];
  const clips: number[] = [];
  const depths: number[] = [];

  const ids: string[] = [];
  for (let i = 0; i < buf.count; i += 1) {
    const id = buf.ids[i];
    if (id) ids.push(id);
  }
  const depthLookup = buildNormalizedDepthLookup(req.document, ids);

  if (!hasNodeTransformPreviews() && !hasFrameClipRevealOverflow()) {
    collectSoaWebglInstances(buf, view, rects, colors, kinds, angles, uvs, {
      atlas,
      bufferRevision: buf.revision,
      depths,
      depthForId: (id) => depthLookup.depthForId(id),
      clips,
      document: req.document,
      skipFrameBound: true,
    });
  }

  const count = kinds.length;
  const { device } = gpu;
  const queue = device.queue;

  const uniformData = new Float32Array([pan.x, pan.y, z, 0, sw, sh, 0, 0]);
  queue.writeBuffer(gpu.uniformBuf, 0, uniformData);

  const sceneBindGroup = device.createBindGroup({
    layout: gpu.sceneBindGroupLayout,
    entries: [{ binding: 0, resource: { buffer: gpu.uniformBuf } }],
  });

  const encoder = device.createCommandEncoder();

  if (!count || !gpu.colorTex || !gpu.depthTex || !gpu.pingTex) {
    const pass = encoder.beginRenderPass({
      colorAttachments: [{
        view: gpu.context.getCurrentTexture().createView(),
        clearValue: { r: 0, g: 0, b: 0, a: 0 },
        loadOp: 'clear',
        storeOp: 'store',
      }],
    });
    pass.end();
    queue.submit([encoder.finish()]);
    return;
  }

  ensureInstanceCapacity(gpu, count);
  queue.writeBuffer(gpu.rectBuf, 0, new Float32Array(rects));
  queue.writeBuffer(gpu.colorBuf, 0, new Float32Array(colors));
  queue.writeBuffer(gpu.kindBuf, 0, new Float32Array(kinds));
  queue.writeBuffer(gpu.angleBuf, 0, new Float32Array(angles));
  queue.writeBuffer(gpu.uvBuf, 0, new Float32Array(uvs));
  const depthFill = depths.length === count ? depths : Array.from({ length: count }, () => 0.5);
  queue.writeBuffer(gpu.depthBuf, 0, new Float32Array(depthFill));
  const clipFill =
    clips.length === count * 4
      ? clips
      : Array.from({ length: count * 4 }, (_, i) => SOA_WEBGL_NO_CLIP[i % 4]);
  queue.writeBuffer(gpu.clipBuf, 0, new Float32Array(clipFill));

  const scenePass = encoder.beginRenderPass({
    colorAttachments: [
      {
        view: gpu.colorTex.createView(),
        clearValue: { r: 0, g: 0, b: 0, a: 0 },
        loadOp: 'clear',
        storeOp: 'store',
      },
      {
        view: gpu.depthTex.createView(),
        clearValue: { r: 0, g: 0, b: 0, a: 0 },
        loadOp: 'clear',
        storeOp: 'store',
      },
    ],
  });
  scenePass.setPipeline(gpu.scenePipeline);
  scenePass.setBindGroup(0, sceneBindGroup);
  if (gpu.atlasBindGroup) scenePass.setBindGroup(1, gpu.atlasBindGroup);
  scenePass.setVertexBuffer(0, gpu.cornerBuf);
  scenePass.setVertexBuffer(1, gpu.rectBuf);
  scenePass.setVertexBuffer(2, gpu.colorBuf);
  scenePass.setVertexBuffer(3, gpu.kindBuf);
  scenePass.setVertexBuffer(4, gpu.angleBuf);
  scenePass.setVertexBuffer(5, gpu.uvBuf);
  scenePass.setVertexBuffer(6, gpu.depthBuf);
  scenePass.setVertexBuffer(7, gpu.clipBuf);
  scenePass.draw(6, count);
  scenePass.end();

  const dofParams = getGpuDepthOfFieldParams();
  const maxCoC = dofParams.maxCoCPx / ds;
  const blurData = new Float32Array([
    1 / tw, 1 / th, 1, 0, dofParams.focalDepth, maxCoC, dofParams.aperture, 0,
  ]);
  queue.writeBuffer(gpu.blurUniformBuf, 0, blurData);

  function blurBindGroup(colorView: GPUTextureView, depthView: GPUTextureView) {
    return device.createBindGroup({
      layout: gpu.blurBindGroupLayout,
      entries: [
        { binding: 0, resource: colorView },
        { binding: 1, resource: depthView },
        { binding: 2, resource: gpu.sampler },
        { binding: 3, resource: { buffer: gpu.blurUniformBuf } },
      ],
    });
  }

  const blurH = encoder.beginRenderPass({
    colorAttachments: [{
      view: gpu.pingTex.createView(),
      loadOp: 'clear',
      storeOp: 'store',
    }],
  });
  blurH.setPipeline(gpu.blurPipeline);
  blurH.setBindGroup(0, blurBindGroup(gpu.colorTex.createView(), gpu.depthTex.createView()));
  blurH.setVertexBuffer(0, gpu.quadBuf);
  blurH.draw(4);
  blurH.end();

  blurData[2] = 0;
  blurData[3] = 1;
  queue.writeBuffer(gpu.blurUniformBuf, 0, blurData);

  const blurV = encoder.beginRenderPass({
    colorAttachments: [{
      view: gpu.context.getCurrentTexture().createView(),
      clearValue: { r: 0, g: 0, b: 0, a: 0 },
      loadOp: 'clear',
      storeOp: 'store',
    }],
  });
  blurV.setPipeline(gpu.blurPipeline);
  blurV.setBindGroup(0, blurBindGroup(gpu.pingTex.createView(), gpu.depthTex.createView()));
  blurV.setVertexBuffer(0, gpu.quadBuf);
  blurV.draw(4);
  blurV.end();

  queue.submit([encoder.finish()]);
}

export function createWebgpuSceneRenderer(deps: CanvasSceneRendererDeps): SceneRenderer | null {
  const canvas = deps.canvas;
  if (!canvas || !isSoaCanvasShapesEnabled()) return null;
  if (!shouldRunGpuDepthOfField()) return null;
  if (typeof navigator === 'undefined' || !('gpu' in navigator)) return null;

  let disposed = false;
  let gpu: GpuRuntime | null = null;
  let initInflight: Promise<GpuRuntime | null> | null = null;
  let pendingReq: SceneRenderRequest | null = null;
  let bootScheduled = false;

  async function ensureGpu(): Promise<GpuRuntime | null> {
    if (gpu) return gpu;
    if (!initInflight) {
      initInflight = (async () => {
        try {
          const ctx = await initWebgpu(canvas);
          if (disposed) {
            ctx?.device.destroy();
            return null;
          }
          gpu = ctx;
          return ctx;
        } catch {
          return null;
        } finally {
          initInflight = null;
        }
      })();
    }
    return initInflight;
  }

  return {
    backend: 'webgpu',
    render(req: SceneRenderRequest) {
      if (disposed) return;
      if (gpu) {
        pendingReq = null;
        drawFrame(gpu, canvas, req);
        return;
      }
      pendingReq = req;
      if (bootScheduled) return;
      bootScheduled = true;
      async function bootAndDraw() {
        try {
          const ctx = await ensureGpu();
          if (!ctx || disposed) return;
          const latest = pendingReq;
          pendingReq = null;
          if (latest) drawFrame(ctx, canvas, latest);
          bumpSceneCanvasIdlePaint();
        } finally {
          bootScheduled = false;
        }
      }
      bootAndDraw();
    },
    hitTest(point, screen) {
      return hitTestWithSpatialIndex(deps, point, screen);
    },
    dispose() {
      disposed = true;
      pendingReq = null;
      gpu?.colorTex?.destroy();
      gpu?.depthTex?.destroy();
      gpu?.pingTex?.destroy();
      gpu?.atlasTex?.destroy();
      gpu?.device.destroy();
      gpu = null;
    },
  };
}

export { SCENE_WGSL, BLUR_WGSL };
