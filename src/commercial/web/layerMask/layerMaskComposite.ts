import { imageSrcToFile } from '@/utils/uploadImage';

const MAX_MASK_EDGE = 8192;

function loadImageFromUrl(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    if (!src) {
      reject(new Error('empty image src'));
      return;
    }
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('图片加载失败'));
    img.src = src;
  });
}

async function loadImageForMask(
  src: string,
  uploadKey?: string | null
): Promise<HTMLImageElement> {
  const s = (src || '').trim();
  if (s.startsWith('data:') || s.startsWith('blob:')) {
    return loadImageFromUrl(s);
  }
  const file = await imageSrcToFile(s, 'mask-src.png', { uploadKey });
  const objectUrl = URL.createObjectURL(file);
  try {
    return await loadImageFromUrl(objectUrl);
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

/** Initialize mask canvas to white (fully visible) at source resolution. */
export function fillWhiteMaskCanvas(canvas: HTMLCanvasElement, nw: number, nh: number) {
  canvas.width = Math.max(1, nw);
  canvas.height = Math.max(1, nh);
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
}

/** Draw existing maskSrc into an offscreen canvas (source pixel size). */
export async function drawMaskSrcToCanvas(
  canvas: HTMLCanvasElement,
  maskSrc: string,
  nw: number,
  nh: number,
  maskKey?: string | null
) {
  canvas.width = Math.max(1, nw);
  canvas.height = Math.max(1, nh);
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  if (!maskSrc) {
    fillWhiteMaskCanvas(canvas, nw, nh);
    return;
  }
  const img = await loadImageForMask(maskSrc, maskKey);
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(img, 0, 0, nw, nh);
}

/** Export stage mask canvas to grayscale PNG aligned to source pixels. */
export function exportGrayscaleMaskDataUrl(
  maskCanvas: HTMLCanvasElement,
  nw: number,
  nh: number
): string | undefined {
  if (nw > MAX_MASK_EDGE || nh > MAX_MASK_EDGE) {
    throw new Error(`图片过大（>${MAX_MASK_EDGE}px），请先缩小后再编辑蒙版`);
  }
  const out = document.createElement('canvas');
  out.width = nw;
  out.height = nh;
  const ctx = out.getContext('2d');
  if (!ctx) return undefined;
  ctx.drawImage(maskCanvas, 0, 0, nw, nh);
  const data = ctx.getImageData(0, 0, nw, nh);
  const px = data.data;
  let anyNonWhite = false;
  for (let i = 0; i < px.length; i += 4) {
    const r = px[i]!;
    const g = px[i + 1]!;
    const b = px[i + 2]!;
    const a = px[i + 3]!;
    const lum = a > 0 ? Math.round((r + g + b) / 3) : 255;
    if (lum < 254) anyNonWhite = true;
    px[i] = lum;
    px[i + 1] = lum;
    px[i + 2] = lum;
    px[i + 3] = 255;
  }
  if (!anyNonWhite) return undefined;
  ctx.putImageData(data, 0, 0);
  return out.toDataURL('image/png');
}

/** Composite src + mask to RGBA PNG data URL (canvas path for masked preview). */
export async function compositeImageWithMaskDataUrl(opts: {
  src: string;
  uploadKey?: string | null;
  maskDataUrl: string;
  width: number;
  height: number;
}): Promise<string> {
  const nw = Math.max(1, Math.round(opts.width));
  const nh = Math.max(1, Math.round(opts.height));
  const img = await loadImageForMask(opts.src, opts.uploadKey);
  const sw = Math.max(1, img.naturalWidth || img.width || nw);
  const sh = Math.max(1, img.naturalHeight || img.height || nh);

  const out = document.createElement('canvas');
  out.width = sw;
  out.height = sh;
  const ctx = out.getContext('2d');
  if (!ctx) throw new Error('canvas unsupported');
  ctx.drawImage(img, 0, 0, sw, sh);

  const maskImg = await loadImageFromUrl(opts.maskDataUrl);
  const mask = document.createElement('canvas');
  mask.width = sw;
  mask.height = sh;
  const mctx = mask.getContext('2d');
  if (!mctx) throw new Error('canvas unsupported');
  mctx.drawImage(maskImg, 0, 0, sw, sh);

  ctx.globalCompositeOperation = 'destination-in';
  ctx.drawImage(mask, 0, 0);
  return out.toDataURL('image/png');
}
