import type { ReactNode } from 'react';

const LAYER_ICON_SLOT =
  'inline-flex h-7 w-7 shrink-0 items-center justify-center overflow-hidden rounded border border-[var(--line)] bg-[var(--surface)] text-[var(--muted)]';

/** Layer icon without mask chrome. */
export function CommercialLayerMaskIcon({
  src,
}: {
  attrs?: Record<string, unknown>;
  src: string;
}): ReactNode {
  return (
    <span className={LAYER_ICON_SLOT}>
      <img src={src} alt="" className="h-full w-full object-cover" draggable={false} />
    </span>
  );
}
