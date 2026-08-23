import { startImageProcess } from '@/store/modules/editor';

type DispatchFn = (action: unknown) => void;

export async function startEraserFromMask(opts: {
  eraseMask: string;
  sourceId: string;
  label: string;
  dispatch: DispatchFn;
  onSpawned?: () => void;
}): Promise<void> {
  opts.dispatch(
    startImageProcess({
      sourceId: opts.sourceId,
      kind: 'eraser',
      label: opts.label,
      meta: { eraseMask: opts.eraseMask },
    })
  );
  opts.onSpawned?.();
}
