/**
 * Mockup template kit — UV/mask/base (+ optional shadow/highlight/regions) for FE WebGL.
 */

import { getApiBaseUrl } from '@/utils/apiBase';
import { getToken } from '@/utils/token';

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
  /** Printable rect in kit pixel space (scaled). */
  printRect: MockupPrintRect;
  /** Printable rect in full design/template space (placement coords). */
  printFull: MockupPrintRect;
  shadow?: string;
  highlight?: string;
  regions: MockupKitRegion[];
  auto?: boolean;
};

type RegionDto = {
  id?: string;
  mask?: string;
  uvEncoding?: string;
  uvBase64?: string;
  shadow?: string;
  highlight?: string;
  printRect?: MockupPrintRect;
  printFull?: MockupPrintRect;
};

type KitDto = {
  templateId?: string;
  name?: string;
  width?: number;
  height?: number;
  fullWidth?: number;
  fullHeight?: number;
  scale?: number;
  base?: string;
  mask?: string;
  uvEncoding?: string;
  uvBase64?: string;
  printRect?: MockupPrintRect;
  printFull?: MockupPrintRect;
  shadow?: string;
  highlight?: string;
  regions?: RegionDto[];
  auto?: boolean;
};

function b64ToFloat32(b64: string): Float32Array {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i += 1) bytes[i] = bin.charCodeAt(i);
  return new Float32Array(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
}

function authHeaders(): HeadersInit {
  const token = getToken();
  return {
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };
}

function parseKitDto(data: KitDto, fallbackId: string, scale: number): MockupTemplateKit {
  const w = Math.max(1, Number(data.width) || 1);
  const h = Math.max(1, Number(data.height) || 1);
  const uvB64 = String(data.uvBase64 || '');
  if (!uvB64 || !data.base || !data.mask) {
    throw new Error('mockup kit missing uv/base/mask');
  }
  const uv = b64ToFloat32(uvB64);
  if (uv.length < w * h * 2) {
    throw new Error('mockup kit uv size mismatch');
  }
  const fullWidth = Math.max(1, Number(data.fullWidth) || 720);
  const fullHeight = Math.max(1, Number(data.fullHeight) || 960);
  const printFull = data.printFull || { x: 175, y: 212, w: 371, h: 574 };
  const printRect = data.printRect || {
    x: printFull.x * (w / fullWidth),
    y: printFull.y * (h / fullHeight),
    w: printFull.w * (w / fullWidth),
    h: printFull.h * (h / fullHeight),
  };

  const regionsRaw = Array.isArray(data.regions) ? data.regions : [];
  const regions: MockupKitRegion[] = [];
  for (const r of regionsRaw) {
    const rUvB64 = String(r.uvBase64 || '');
    const rMask = String(r.mask || '');
    if (!rUvB64 || !rMask) continue;
    const rUv = b64ToFloat32(rUvB64);
    if (rUv.length < w * h * 2) continue;
    const rFull = r.printFull || printFull;
    const rRect = r.printRect || {
      x: rFull.x * (w / fullWidth),
      y: rFull.y * (h / fullHeight),
      w: rFull.w * (w / fullWidth),
      h: rFull.h * (h / fullHeight),
    };
    regions.push({
      id: String(r.id || `r${regions.length}`),
      mask: rMask,
      uv: rUv,
      shadow: r.shadow ? String(r.shadow) : undefined,
      highlight: r.highlight ? String(r.highlight) : undefined,
      printRect: rRect,
      printFull: rFull,
    });
  }
  if (!regions.length) {
    regions.push({
      id: 'r0',
      mask: String(data.mask),
      uv,
      shadow: data.shadow ? String(data.shadow) : undefined,
      highlight: data.highlight ? String(data.highlight) : undefined,
      printRect,
      printFull,
    });
  }

  return {
    templateId: String(data.templateId || fallbackId),
    name: String(data.name || fallbackId),
    width: w,
    height: h,
    fullWidth,
    fullHeight,
    scale: Number(data.scale) || scale,
    base: String(data.base),
    mask: String(data.mask),
    uv,
    printRect,
    printFull,
    shadow: data.shadow ? String(data.shadow) : undefined,
    highlight: data.highlight ? String(data.highlight) : undefined,
    regions,
    auto: data.auto === true,
  };
}

async function readError(res: Response): Promise<string> {
  // Read once — res.json() then res.text() throws "body stream already read".
  const raw = await res.text();
  if (!raw) return '';
  try {
    const body = JSON.parse(raw) as { detail?: unknown };
    const detail = body?.detail;
    if (typeof detail === 'string') return detail;
    if (detail != null) return JSON.stringify(detail);
  } catch {
    /* not JSON */
  }
  return raw;
}

async function ensureImagePayload(src: string): Promise<string> {
  const s = String(src || '').trim();
  if (!s) throw new Error('auto-bake requires photo');
  if (s.startsWith('data:')) return s;
  // Auth + CORS-safe decode (bare fetch fails on COS /uploads/files).
  const { imageSrcToFile } = await import('@/utils/uploadImage');
  const file = await imageSrcToFile(s, 'mockup-photo.png');
  return await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(new Error('photo read failed'));
    reader.readAsDataURL(file);
  });
}

export async function fetchMockupTemplateKit(
  templateId = 'demo-cylinder',
  scale = 0.5
): Promise<MockupTemplateKit> {
  const base = getApiBaseUrl().replace(/\/$/, '');
  const tid = encodeURIComponent(templateId || 'demo-cylinder');
  const res = await fetch(`${base}/api/v1/mockup/templates/${tid}/kit?scale=${scale}`, {
    headers: authHeaders(),
  });
  if (!res.ok) {
    throw new Error((await readError(res)) || `mockup kit failed (${res.status})`);
  }
  const data = (await res.json()) as KitDto;
  return parseKitDto(data, templateId, scale);
}

/** Full-auto kit from product photo (matting → printable zones → UV + PBR maps). */
export async function fetchAutoBakeKit(
  imageSrc: string,
  scale = 0.5
): Promise<MockupTemplateKit> {
  const photo = await ensureImagePayload(imageSrc);
  const base = getApiBaseUrl().replace(/\/$/, '');
  const res = await fetch(`${base}/api/v1/mockup/auto-bake`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...authHeaders(),
    },
    body: JSON.stringify({ image: photo, scale }),
  });
  if (!res.ok) {
    throw new Error((await readError(res)) || `auto-bake failed (${res.status})`);
  }
  const data = (await res.json()) as KitDto;
  return parseKitDto(data, 'auto-bake', scale);
}

export function pickRegionAtPoint(
  kit: MockupTemplateKit,
  /** Point in full template / design space. */
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
