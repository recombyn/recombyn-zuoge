import { useEffect, useRef, useState, type ReactNode, memo } from 'react';
import { SoftGlowSurface } from '@/components/base';
import TemplateThumbnail from '@/components/templates/TemplateThumbnail';
import {
  projectThumbFrameClass,
  projectThumbZoomLayerClass,
} from '@/utils/projectThumb';
import { nearestScrollRoot } from '@/components/home/InfiniteScroll';
import { cn } from '@/utils/classnames';

type Props = {
  document?: unknown;
  fit?: 'contain' | 'cover';
  className?: string;
  children?: ReactNode;
  /** Keep thumb mounted once shown (default true). */
  once?: boolean;
};

/**
 * Mount TemplateThumbnail only when near viewport — avoids dozens of boards
 * rasterizing on the main thread at once for large project grids.
 */
function LazyTemplateThumb({
  document,
  fit = 'cover',
  className,
  children,
  once = true,
}: Props): ReactNode {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const [active, setActive] = useState(false);

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

  return (
    <div ref={rootRef} className={projectThumbFrameClass(className)}>
      <div className={cn('absolute inset-0', projectThumbZoomLayerClass)}>
        {active && document ? (
          <TemplateThumbnail document={document} fit={fit} />
        ) : (
          <SoftGlowSurface className="h-full w-full !rounded-none" seed="lazy-thumb" aria-hidden />
        )}
      </div>
      {children}
    </div>
  );
}

export default memo(LazyTemplateThumb);
