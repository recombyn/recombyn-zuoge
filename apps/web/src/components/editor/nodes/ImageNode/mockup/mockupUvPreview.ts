/**
 * Canvas 2D UV remap preview — design sheet over base with shadow × highlight (screen).
 * Same API as the former WebGL path; CPU ImageData composite (no WebGL).
 */

export type UvPreviewKit = {
  width: number;
  height: number;
  baseUrl: string;
  maskUrl: string;
  uv: Float32Array;
  /** Optional luminance-derived shadow map (RGB data URL). */
  shadowUrl?: string | null;
  /** Optional highlight map (RGB data URL). */
  highlightUrl?: string | null;
};

export type MockupUvPreview = {
  setKit: (kit: UvPreviewKit) => Promise<void>;
  setRegionSurfaces: (
    partial: Pick<UvPreviewKit, 'maskUrl' | 'uv'> &
      Partial<Pick<UvPreviewKit, 'shadowUrl' | 'highlightUrl'>>
  ) => Promise<void>;
  setDesignSheet: (dataUrl: string | null) => Promise<void>;
  /** True only after a design sheet was bound — kit-only frames must not publish/bake. */
  hasDesignBound: () => boolean;
  draw: () => void;
  toDataURL: () => string;
  dispose: () => void;
  canvas: HTMLCanvasElement;
};

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('image load failed'));
    img.src = url;
  });
}

function rasterize(
  source: CanvasImageSource,
  w: number,
  h: number
): ImageData {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const ctx = c.getContext('2d', { willReadFrequently: true });
  if (!ctx) return new ImageData(w, h);
  ctx.drawImage(source, 0, 0, w, h);
  return ctx.getImageData(0, 0, w, h);
}

function sampleRgba(
  data: ImageData,
  u: number,
  v: number
): [number, number, number, number] {
  const w = data.width;
  const h = data.height;
  const x = Math.max(0, Math.min(w - 1, Math.floor(u * w)));
  const y = Math.max(0, Math.min(h - 1, Math.floor(v * h)));
  const i = (y * w + x) * 4;
  const d = data.data;
  return [d[i]!, d[i + 1]!, d[i + 2]!, d[i + 3]!];
}

function solidRgb(w: number, h: number, rgb: [number, number, number]): ImageData {
  const out = new ImageData(w, h);
  const d = out.data;
  for (let i = 0; i < w * h; i += 1) {
    const o = i * 4;
    d[o] = rgb[0];
    d[o + 1] = rgb[1];
    d[o + 2] = rgb[2];
    d[o + 3] = 255;
  }
  return out;
}

export function createMockupUvPreview(canvas?: HTMLCanvasElement): MockupUvPreview {
  const el = canvas || document.createElement('canvas');
  const ctx = el.getContext('2d', { willReadFrequently: true });
  if (!ctx) throw new Error('Canvas 2D unavailable');

  let kitW = 1;
  let kitH = 1;
  let uv = new Float32Array(2);
  let baseData: ImageData | null = null;
  let maskData: ImageData | null = null;
  let designData: ImageData | null = null;
  let shadowData: ImageData | null = null;
  let highlightData: ImageData | null = null;
  let hasDesign = false;
  let hasPbr = false;

  const draw = () => {
    if (!baseData || !maskData) return;
    el.width = kitW;
    el.height = kitH;
    const out = ctx.createImageData(kitW, kitH);
    const od = out.data;
    const bd = baseData.data;
    const md = maskData.data;
    const uvLen = uv.length;

    for (let y = 0; y < kitH; y += 1) {
      for (let x = 0; x < kitW; x += 1) {
        const i = y * kitW + x;
        const o = i * 4;
        const m = md[o]! / 255;
        if (!hasDesign || !designData || m < 0.01) {
          od[o] = bd[o]!;
          od[o + 1] = bd[o + 1]!;
          od[o + 2] = bd[o + 2]!;
          od[o + 3] = 255;
          continue;
        }
        const uvi = i * 2;
        const u = uvi + 1 < uvLen ? uv[uvi]! : 0;
        const v = uvi + 1 < uvLen ? uv[uvi + 1]! : 0;
        const [dr, dg, db, da] = sampleRgba(designData, u, v);
        const a = (da / 255) * m;
        let lr = dr / 255;
        let lg = dg / 255;
        let lb = db / 255;
        if (hasPbr && shadowData && highlightData) {
          const [sr, sg, sb] = sampleRgba(shadowData, x / kitW, y / kitH);
          const [hr, hg, hb] = sampleRgba(highlightData, x / kitW, y / kitH);
          const shadedR = lr * (sr / 255);
          const shadedG = lg * (sg / 255);
          const shadedB = lb * (sb / 255);
          // Screen blend (matches pbr_blend.blend_screen)
          lr = 1 - (1 - shadedR) * (1 - (hr / 255) * 0.85);
          lg = 1 - (1 - shadedG) * (1 - (hg / 255) * 0.85);
          lb = 1 - (1 - shadedB) * (1 - (hb / 255) * 0.85);
        }
        const br = bd[o]! / 255;
        const bg = bd[o + 1]! / 255;
        const bb = bd[o + 2]! / 255;
        od[o] = Math.round((br + (lr - br) * a) * 255);
        od[o + 1] = Math.round((bg + (lg - bg) * a) * 255);
        od[o + 2] = Math.round((bb + (lb - bb) * a) * 255);
        od[o + 3] = 255;
      }
    }
    ctx.putImageData(out, 0, 0);
  };

  const bindPbr = async (shadowUrl?: string | null, highlightUrl?: string | null) => {
    hasPbr = Boolean(shadowUrl || highlightUrl);
    if (shadowUrl) {
      const img = await loadImage(shadowUrl);
      shadowData = rasterize(img, kitW, kitH);
    } else {
      shadowData = solidRgb(kitW, kitH, [255, 255, 255]);
    }
    if (highlightUrl) {
      const img = await loadImage(highlightUrl);
      highlightData = rasterize(img, kitW, kitH);
    } else {
      highlightData = solidRgb(kitW, kitH, [0, 0, 0]);
    }
  };

  return {
    canvas: el,
    async setKit(kit: UvPreviewKit) {
      kitW = Math.max(1, kit.width);
      kitH = Math.max(1, kit.height);
      uv = kit.uv;
      const [baseImg, maskImg] = await Promise.all([
        loadImage(kit.baseUrl),
        loadImage(kit.maskUrl),
      ]);
      baseData = rasterize(baseImg, kitW, kitH);
      maskData = rasterize(maskImg, kitW, kitH);
      designData = null;
      hasDesign = false;
      await bindPbr(kit.shadowUrl, kit.highlightUrl);
      draw();
    },
    async setRegionSurfaces(partial) {
      const maskImg = await loadImage(partial.maskUrl);
      maskData = rasterize(maskImg, kitW, kitH);
      uv = partial.uv;
      if (partial.shadowUrl !== undefined || partial.highlightUrl !== undefined) {
        await bindPbr(partial.shadowUrl, partial.highlightUrl);
      }
      draw();
    },
    async setDesignSheet(dataUrl: string | null) {
      designData = null;
      hasDesign = false;
      if (dataUrl) {
        const img = await loadImage(dataUrl);
        const dw = Math.max(1, img.naturalWidth || img.width || kitW);
        const dh = Math.max(1, img.naturalHeight || img.height || kitH);
        designData = rasterize(img, dw, dh);
        hasDesign = true;
      }
      draw();
    },
    hasDesignBound: () => hasDesign,
    draw,
    toDataURL: () => el.toDataURL('image/png'),
    dispose() {
      baseData = null;
      maskData = null;
      designData = null;
      shadowData = null;
      highlightData = null;
      hasDesign = false;
      el.width = 0;
      el.height = 0;
    },
  };
}
