/** Printable body on builtin `demo-cylinder` (720×960). */
export const DEMO_CYLINDER_PRINT = {
  templateW: 720,
  templateH: 960,
  x: 175,
  y: 212,
  w: 371,
  h: 574,
};

export type MockupPlacement = {
  x: number;
  y: number;
  width: number;
  height: number;
  angle: number;
};

export function defaultMockupPlacement(): MockupPlacement {
  const { x, y, w, h } = DEMO_CYLINDER_PRINT;
  return { x, y, width: w, height: h, angle: 0 };
}

export function autoFitMockupPlacement(
  print = DEMO_CYLINDER_PRINT
): MockupPlacement {
  // Snap to printable face — aspect-correct cover is applied when composing the sheet.
  return {
    x: print.x,
    y: print.y,
    width: Math.max(1, print.w),
    height: Math.max(1, print.h),
    angle: 0,
  };
}

export function loadImageNaturalSize(src: string): Promise<{ width: number; height: number }> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () =>
      resolve({
        width: Math.max(1, img.naturalWidth || img.width || 1),
        height: Math.max(1, img.naturalHeight || img.height || 1),
      });
    img.onerror = () => reject(new Error('failed to load design image'));
    img.src = src;
  });
}

/** Flat design sheet for UV remap (template pixel space). */
export async function composeMockupDesignSheet(
  designSrc: string,
  placement: MockupPlacement,
  templateW = DEMO_CYLINDER_PRINT.templateW,
  templateH = DEMO_CYLINDER_PRINT.templateH
): Promise<string> {
  // Decode via upload pipeline so COS /auth URLs work (canvas needs CORS-clean pixels).
  const { imageSrcToFile } = await import('@/utils/uploadImage');
  const file = await imageSrcToFile(designSrc, 'mockup-design.png');
  const objectUrl = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = () => reject(new Error('failed to load design for compose'));
      el.src = objectUrl;
    });

    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(templateW));
    canvas.height = Math.max(1, Math.round(templateH));
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('canvas unsupported');

    ctx.clearRect(0, 0, canvas.width, canvas.height);
    const pw = Math.max(1, placement.width);
    const ph = Math.max(1, placement.height);
    const iw = Math.max(1, img.naturalWidth || img.width || 1);
    const ih = Math.max(1, img.naturalHeight || img.height || 1);
    // Cover the printable rect (fill, crop overflow) — no letterbox gaps.
    const scale = Math.max(pw / iw, ph / ih);
    const dw = iw * scale;
    const dh = ih * scale;
    const cx = placement.x + pw / 2;
    const cy = placement.y + ph / 2;
    ctx.save();
    ctx.beginPath();
    ctx.rect(placement.x, placement.y, pw, ph);
    ctx.clip();
    ctx.translate(cx, cy);
    ctx.rotate((placement.angle * Math.PI) / 180);
    ctx.drawImage(img, -dw / 2, -dh / 2, dw, dh);
    ctx.restore();

    return canvas.toDataURL('image/png');
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

export function parseMockupPlacement(raw: unknown): MockupPlacement | null {
  if (!raw || typeof raw !== 'object') return null;
  const p = raw as Record<string, unknown>;
  const x = Number(p.x);
  const y = Number(p.y);
  const width = Number(p.width);
  const height = Number(p.height);
  const angle = Number(p.angle) || 0;
  if (![x, y, width, height].every((n) => Number.isFinite(n) && n > 0)) return null;
  return { x, y, width, height, angle };
}
