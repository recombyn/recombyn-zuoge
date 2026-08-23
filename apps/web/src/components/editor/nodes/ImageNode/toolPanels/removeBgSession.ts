import { startImageProcess } from '@/store/modules/editor';
import type { MattingHintOverlayHandle } from './MattingHintOverlay';

type DispatchFn = (action: unknown) => void;

export function buildMattingProcessMeta(
  masks: { includeMask?: string; excludeMask?: string }
): Record<string, string> | undefined {
  const meta: Record<string, string> = {};
  if (masks.includeMask) meta.includeMask = masks.includeMask;
  if (masks.excludeMask) meta.excludeMask = masks.excludeMask;
  return Object.keys(meta).length ? meta : undefined;
}

export async function startRemoveBgFromMasks(opts: {
  maskRef: MattingHintOverlayHandle | null | undefined;
  sourceId: string;
  label: string;
  dispatch: DispatchFn;
  onSpawned?: () => void;
}): Promise<void> {
  const masks = (await opts.maskRef?.exportMasks()) ?? {};
  const meta = buildMattingProcessMeta(masks);
  opts.dispatch(
    startImageProcess({
      sourceId: opts.sourceId,
      kind: 'removeBg',
      label: opts.label,
      ...(meta ? { meta } : {}),
    })
  );
  opts.onSpawned?.();
}
