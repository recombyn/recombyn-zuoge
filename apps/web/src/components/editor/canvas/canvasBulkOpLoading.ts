import { message } from '@/components/base';

/**
 * Show top loading toast only when the op touches many items.
 * 1–2 shapes stay silent; select-all / bulk paste/cut/delete get feedback.
 */
export const CANVAS_BULK_OP_LOADING_AT = 50;

export function canvasBulkItemCount(nodes: number, frames = 0): number {
  return Math.max(0, Math.floor(nodes) || 0) + Math.max(0, Math.floor(frames) || 0);
}

/**
 * Run a sync canvas mutation. When `count` is large, show `message.loading`
 * and yield a couple of frames so the toast can paint before the main-thread stall.
 */
export function runCanvasBulkOp(opts: {
  count: number;
  label: string;
  run: () => void;
  threshold?: number;
}): void {
  const threshold = opts.threshold ?? CANVAS_BULK_OP_LOADING_AT;
  if (opts.count < threshold) {
    opts.run();
    return;
  }
  const hide = message.loading(opts.label, 0);
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      try {
        opts.run();
      } finally {
        hide();
      }
    });
  });
}

/** Async variant for OS paste / awaited clipboard paths. */
export async function runCanvasBulkOpAsync(opts: {
  count: number;
  label: string;
  run: () => void | Promise<void>;
  threshold?: number;
}): Promise<void> {
  const threshold = opts.threshold ?? CANVAS_BULK_OP_LOADING_AT;
  if (opts.count < threshold) {
    await opts.run();
    return;
  }
  const hide = message.loading(opts.label, 0);
  await new Promise<void>((r) => requestAnimationFrame(() => r()));
  await new Promise<void>((r) => requestAnimationFrame(() => r()));
  try {
    await opts.run();
  } finally {
    hide();
  }
}
