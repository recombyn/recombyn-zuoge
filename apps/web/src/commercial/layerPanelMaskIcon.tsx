import type { ReactNode } from 'react';
import { LuLink2 } from 'react-icons/lu';
import {
  hasLayerMask,
  readMaskSrc,
} from '@/scene/layerMaskAttrs';

const LAYER_ICON_SLOT =
  'inline-flex h-7 w-7 shrink-0 items-center justify-center overflow-hidden rounded border border-[var(--line)] bg-[var(--surface)] text-[var(--muted)]';

function ImageThumb({ src }: { src: string }) {
  return (
    <span className={LAYER_ICON_SLOT}>
      <img src={src} alt="" className="h-full w-full object-cover" draggable={false} />
    </span>
  );
}

/** recombyn-dev: PS-style linked mask thumb on layer row (stripped on OSS sync). */
export function CommercialLayerMaskIcon({
  attrs,
  src,
}: {
  attrs: Record<string, unknown> | undefined;
  src: string;
}): ReactNode {
  if (!hasLayerMask(attrs)) {
    return <ImageThumb src={src} />;
  }
  const maskSrc = readMaskSrc(attrs);
  return (
    <span className="inline-flex items-center gap-0.5">
      <ImageThumb src={src} />
      <LuLink2 className="h-2.5 w-2.5 shrink-0 text-[var(--muted)]" strokeWidth={2} />
      <ImageThumb src={maskSrc} />
    </span>
  );
}
