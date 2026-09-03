/**
 * Mockup template kit — FE-only UV/mask/base for Canvas 2D preview (no bake API).
 */

import { DEMO_CYLINDER_PRINT } from './mockupPlacement';

export type MockupPrintRect = { x: number; y: number; w: number; h: number };

export type MockupKitRegion = {
  id: string;
  mask: string;
  uv: Float32Array;
  shadow?: string;
  highlight?: string;
  printRect: MockupPrintRect;
  printFull: MockupPrintRect;
};

export type MockupTemplateKit = {
  templateId: string;
  name: string;
  width: number;
  height: number;
  fullWidth: number;
  fullHeight: number;
  scale: number;
  base: string;
  mask: string;
  uv: Float32Array;
  printRect: MockupPrintRect;
  printFull: MockupPrintRect;
  shadow?: string;
  highlight?: string;
  regions: MockupKitRegion[];
  auto?: boolean;
};

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('mockup photo load failed'));
    img.src = src;
  });
}

function solidMaskDataUrl(w: number, h: number): string {
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('canvas unavailable');
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, w, h);
  return canvas.toDataURL('image/png');
}

/** Identity UV (planar): each pixel maps to itself in design space. */
function identityUv(w: number, h: number): Float32Array {
  const out = new Float32Array(w * h * 2);
  const denomX = Math.max(1, w - 1);
  const denomY = Math.max(1, h - 1);
  let i = 0;
  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < w; x += 1) {
      out[i] = x / denomX;
      out[i + 1] = y / denomY;
      i += 2;
    }
  }
  return out;
}

async function ensureImagePayload(src: string): Promise<string> {
  const s = String(src || '').trim();
  if (!s) throw new Error('auto-bake requires photo');
  if (s.startsWith('data:')) return s;
  const { imageSrcToFile } = await import('@/utils/uploadImage');
  const file = await imageSrcToFile(s, 'mockup-photo.png');
  return await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(new Error('photo read failed'));
    reader.readAsDataURL(file);
  });
}

/**
 * Build a local kit from the product photo (no bake API).
 * Uses a planar UV so FE Canvas preview can still composite designs.
 */
export async function buildLocalPhotoKit(
  imageSrc: string,
  scale = 0.5
): Promise<MockupTemplateKit> {
  const photo = await ensureImagePayload(imageSrc);
  const img = await loadImage(photo);
  const fullWidth = Math.max(1, img.naturalWidth || img.width);
  const fullHeight = Math.max(1, img.naturalHeight || img.height);
  const s = Math.min(1, Math.max(0.1, Number(scale) || 0.5));
  const width = Math.max(1, Math.round(fullWidth * s));
  const height = Math.max(1, Math.round(fullHeight * s));

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('canvas unavailable');
  ctx.drawImage(img, 0, 0, width, height);
  const base = canvas.toDataURL('image/png');
  const mask = solidMaskDataUrl(width, height);
  const uv = identityUv(width, height);
  const printFull = { x: 0, y: 0, w: fullWidth, h: fullHeight };
  const printRect = {
    x: 0,
    y: 0,
    w: width,
    h: height,
  };
  const region: MockupKitRegion = {
    id: 'r0',
    mask,
    uv,
    printRect,
    printFull,
  };
  return {
    templateId: 'local-photo',
    name: 'Local photo',
    width,
    height,
    fullWidth,
    fullHeight,
    scale: s,
    base,
    mask,
    uv,
    printRect,
    printFull,
    regions: [region],
    auto: true,
  };
}

/** @deprecated Prefer buildLocalPhotoKit — kept for call-site compatibility. */
export async function fetchMockupTemplateKit(
  templateId = 'demo-cylinder',
  scale = 0.5
): Promise<MockupTemplateKit> {
  // No backend templates — use cylinder print rect as empty plate hint only if no photo.
  const printFull = DEMO_CYLINDER_PRINT;
  const s = Math.min(1, Math.max(0.1, Number(scale) || 0.5));
  const fullWidth = 720;
  const fullHeight = 960;
  const width = Math.max(1, Math.round(fullWidth * s));
  const height = Math.max(1, Math.round(fullHeight * s));
  const mask = solidMaskDataUrl(width, height);
  const uv = identityUv(width, height);
  const printRect = {
    x: printFull.x * (width / fullWidth),
    y: printFull.y * (height / fullHeight),
    w: printFull.w * (width / fullWidth),
    h: printFull.h * (height / fullHeight),
  };
  const region: MockupKitRegion = {
    id: 'r0',
    mask,
    uv,
    printRect,
    printFull,
  };
  return {
    templateId: templateId || 'demo-cylinder',
    name: 'Local template',
    width,
    height,
    fullWidth,
    fullHeight,
    scale: s,
    base: mask,
    mask,
    uv,
    printRect,
    printFull,
    regions: [region],
    auto: false,
  };
}

/** Full-auto kit from product photo — FE planar UV (no bake API). */
export async function fetchAutoBakeKit(
  imageSrc: string,
  scale = 0.5
): Promise<MockupTemplateKit> {
  return buildLocalPhotoKit(imageSrc, scale);
}

export function pickRegionAtPoint(
  kit: MockupTemplateKit,
  x: number,
  y: number
): MockupKitRegion {
  const hit = kit.regions.find((r) => {
    const p = r.printFull;
    return x >= p.x && x <= p.x + p.w && y >= p.y && y <= p.y + p.h;
  });
  return (
    hit ||
    kit.regions[0] || {
      id: 'r0',
      mask: kit.mask,
      uv: kit.uv,
      shadow: kit.shadow,
      highlight: kit.highlight,
      printRect: kit.printRect,
      printFull: kit.printFull,
    }
  );
}

export function kitWithActiveRegion(
  kit: MockupTemplateKit,
  regionId: string
): MockupTemplateKit {
  const region = kit.regions.find((r) => r.id === regionId) || kit.regions[0];
  if (!region) return kit;
  return {
    ...kit,
    mask: region.mask,
    uv: region.uv,
    shadow: region.shadow ?? kit.shadow,
    highlight: region.highlight ?? kit.highlight,
    printRect: region.printRect,
    printFull: region.printFull,
  };
}
