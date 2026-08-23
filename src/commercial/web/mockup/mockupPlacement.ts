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
  designW: number,
  designH: number,
  print = DEMO_CYLINDER_PRINT
): MockupPlacement {
  const dw = Math.max(1, designW);
  const dh = Math.max(1, designH);
  const scale = Math.min(print.w / dw, print.h / dh);
  const width = dw * scale;
  const height = dh * scale;
  return {
    x: print.x + (print.w - width) / 2,
    y: print.y + (print.h - height) / 2,
    width,
    height,
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

/** Flat design sheet for server-side cylindrical warp (template pixel space). */
export async function composeMockupDesignSheet(
  designSrc: string,
  placement: MockupPlacement,
  templateW = DEMO_CYLINDER_PRINT.templateW,
  templateH = DEMO_CYLINDER_PRINT.templateH
): Promise<string> {
  const img = await new Promise<HTMLImageElement>((resolve, reject) => {
    const el = new Image();
    el.crossOrigin = 'anonymous';
    el.onload = () => resolve(el);
    el.onerror = () => reject(new Error('failed to load design for compose'));
    el.src = designSrc;
  });

  const canvas = document.createElement('canvas');
  canvas.width = templateW;
  canvas.height = templateH;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('canvas unsupported');

  ctx.clearRect(0, 0, templateW, templateH);
  const cx = placement.x + placement.width / 2;
  const cy = placement.y + placement.height / 2;
  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate((placement.angle * Math.PI) / 180);
  ctx.drawImage(
    img,
    -placement.width / 2,
    -placement.height / 2,
    placement.width,
    placement.height
  );
  ctx.restore();

  return canvas.toDataURL('image/png');
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
