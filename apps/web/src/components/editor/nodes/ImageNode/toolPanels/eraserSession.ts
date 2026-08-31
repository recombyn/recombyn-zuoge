import { startImageProcess } from '@/store/modules/editor';

type DispatchFn = (action: unknown) => void;

export async function startEraserFromMask(opts: {
  eraseMask: string;
  sourceId: string;
  label: string;
  onSpawned?: () => void;
}): Promise<void> {
  startImageProcess({
      sourceId: opts.sourceId,
      kind: 'eraser',
      label: opts.label,
      meta: { eraseMask: opts.eraseMask },
    });
  opts.onSpawned?.();
}
