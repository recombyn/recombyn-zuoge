/**
 * Mockup template kit — UV/mask/base for FE WebGL live remap.
 */

import { getApiBaseUrl } from '@/utils/apiBase';
import { getToken } from '@/utils/token';

export type MockupPrintRect = { x: number; y: number; w: number; h: number };

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
};

function b64ToFloat32(b64: string): Float32Array {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i += 1) bytes[i] = bin.charCodeAt(i);
  return new Float32Array(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
}

export async function fetchMockupTemplateKit(
  templateId = 'demo-cylinder',
  scale = 0.5
): Promise<MockupTemplateKit> {
  const base = getApiBaseUrl().replace(/\/$/, '');
  const token = getToken();
  const tid = encodeURIComponent(templateId || 'demo-cylinder');
  const res = await fetch(`${base}/api/v1/mockup/templates/${tid}/kit?scale=${scale}`, {
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
  });
  if (!res.ok) {
    let detail = '';
    try {
      const body = await res.json();
      detail = String(body?.detail || '');
    } catch {
      detail = await res.text();
    }
    throw new Error(detail || `mockup kit failed (${res.status})`);
  }
  const data = (await res.json()) as KitDto;
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
  const printFull = data.printFull || { x: 175, y: 212, w: 371, h: 574 };
  const printRect = data.printRect || {
    x: printFull.x * (w / Math.max(1, Number(data.fullWidth) || 720)),
    y: printFull.y * (h / Math.max(1, Number(data.fullHeight) || 960)),
    w: printFull.w * (w / Math.max(1, Number(data.fullWidth) || 720)),
    h: printFull.h * (h / Math.max(1, Number(data.fullHeight) || 960)),
  };
  return {
    templateId: String(data.templateId || templateId),
    name: String(data.name || templateId),
    width: w,
    height: h,
    fullWidth: Math.max(1, Number(data.fullWidth) || 720),
    fullHeight: Math.max(1, Number(data.fullHeight) || 960),
    scale: Number(data.scale) || scale,
    base: String(data.base),
    mask: String(data.mask),
    uv,
    printRect,
    printFull,
  };
}
