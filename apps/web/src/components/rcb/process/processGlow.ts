import type { SceneDocument } from '@/components/rcb/sceneNode';

/** Opaque underlay for SVG process plates — SoftGlow animates on the HTML layer above. */
export const PROCESS_PLATE_FILL = '#D5DEE6';
export const PROCESS_PLATE_STROKE = '#A8C5E4';

/** Same opaque shell as NodeProcessGlow foreignObject host. */
export const PROCESS_GLOW_SHELL_BG = '#D5DEE6';

export const PROCESS_PILL_BOTTOM_PAD_PX = 14;

export const PROCESS_PILL_CLASS =
  'absolute z-[1] inline-flex h-7 w-max items-center justify-center overflow-hidden text-ellipsis whitespace-nowrap rounded-full bg-[rgba(55,55,55,0.72)] px-2.5 text-[11px] font-medium leading-none text-white shadow-[0_2px_8px_rgba(15,23,42,0.18)]';

/** All nodes with in-flight `processStatus === 'running'`. */
export function listProcessingNodeIds(
  document: SceneDocument | null | undefined
): string[] {
  const children = document?.deltaSetLike?.ROOT?.children;
  if (!Array.isArray(children)) return [];
  const out: string[] = [];
  for (const id of children) {
    const node = document?.deltaSetLike?.[id];
    if (id && node && String(node?.attrs?.processStatus || '') === 'running') {
      out.push(String(id));
    }
  }
  return out;
}
