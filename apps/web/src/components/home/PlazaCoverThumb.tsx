import { useEffect, useRef, useState, type CSSProperties, type ReactNode, memo } from 'react';
import TemplateThumbnail from '@/components/templates/TemplateThumbnail';
import {
  projectThumbFrameClass,
  projectThumbZoomLayerClass,
  withThumbCacheBust,
} from '@/utils/projectThumb';
import { nearestScrollRoot } from '@/components/home/InfiniteScroll';
import {
  plazaCoverAspectStyle,
  plazaFlowThumbClass,
} from '@/components/home/FlowScrollSection';
import { cn } from '@/utils/classnames';

function resolvePlazaFlowStyle(
  flow: boolean,
  naturalAspect: string | null,
  coverDocument: unknown
): CSSProperties | undefined {
  if (!flow) return undefined;
  if (naturalAspect) return { aspectRatio: naturalAspect };
  return plazaCoverAspectStyle(coverDocument);
}

type Props = {
  /** Lightweight cover document from Plaza list API (`coverDocument`). */
  coverDocument?: unknown | null;
  /** Optional raster cover — preferred over live rasterization when present. */
  thumbnail?: string | null;
  /** Cache-bust token for remote thumbnail URLs. */
  version?: number | string | null;
  /**
   * `fixed` — Projects-style 170px frame.
   * `flow` — height follows image / document aspect (plaza waterfall).
   */
  layout?: 'fixed' | 'flow';
  className?: string;
  children?: ReactNode;
  once?: boolean;
};

/**
 * Plaza card cover — prefer remote raster thumbnail; else rasterize coverDocument to `<img>`.
 * Media zooms on parent `.group` hover; overlays (`children`) stay unscaled.
 */
function PlazaCoverThumb({
  coverDocument,
  thumbnail,
  version,
  layout = 'fixed',
  className,
  children,
  once = true,
}: Props): ReactNode {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const [active, setActive] = useState(false);
  const [naturalAspect, setNaturalAspect] = useState<string | null>(null);
  const thumb =
    typeof thumbnail === 'string' && thumbnail.trim() ? thumbnail.trim() : '';
  const src = thumb ? withThumbCacheBust(thumb, version) : '';
  const flow = layout === 'flow';

  useEffect(() => {
    const el = rootRef.current;
    if (!el) return undefined;
    const io = new IntersectionObserver(
      (entries) => {
        const hit = entries.some((e) => e.isIntersecting);
        if (hit) {
          setActive(true);
          if (once) io.disconnect();
        } else if (!once) {
          setActive(false);
        }
      },
      { root: nearestScrollRoot(el), rootMargin: '200px 0px', threshold: 0 }
    );
    io.observe(el);
    return () => io.disconnect();
  }, [once]);

  const flowStyle = resolvePlazaFlowStyle(flow, naturalAspect, coverDocument);

  const mediaClass = 'block h-full w-full object-cover';

  return (
    <div
      ref={rootRef}
      className={
        flow ? plazaFlowThumbClass(className) : projectThumbFrameClass(className)
      }
      style={flowStyle}
    >
      <div className={cn('absolute inset-0', projectThumbZoomLayerClass)}>
        {src ? (
          <img
            key={src}
            src={src}
            alt=""
            className={mediaClass}
            onLoad={(e) => {
              if (!flow) return;
              const img = e.currentTarget;
              if (img.naturalWidth > 0 && img.naturalHeight > 0) {
                setNaturalAspect(`${img.naturalWidth} / ${img.naturalHeight}`);
              }
            }}
          />
        ) : active && coverDocument ? (
          <TemplateThumbnail document={coverDocument} fit={flow ? 'cover' : 'contain'} />
        ) : (
          <div className={cn('h-full w-full bg-[var(--surface)]')} />
        )}
      </div>
      {children}
    </div>
  );
}

export default memo(PlazaCoverThumb);
