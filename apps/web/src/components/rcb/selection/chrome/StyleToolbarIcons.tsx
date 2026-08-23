import { cn } from '@/utils/classnames';
import { memo, type CSSProperties } from 'react';
import { Icon } from '@/components/base';

const CHECKER: CSSProperties = {
  backgroundImage:
    'linear-gradient(45deg, #d0d0d0 25%, transparent 25%), linear-gradient(-45deg, #d0d0d0 25%, transparent 25%), linear-gradient(45deg, transparent 75%, #d0d0d0 75%), linear-gradient(-45deg, transparent 75%, #d0d0d0 75%)',
  backgroundSize: '6px 6px',
  backgroundPosition: '0 0, 0 3px, 3px -3px, -3px 0',
};

/** 16×16 circular fill swatch — darker ring so white/near-white fills stay visible. */
function FillColorSwatch({
  color,
  className,
}: {
  color: string;
  className?: string;
}) {
  return (
    <span
      className={cn(
        'relative inline-flex h-4 w-4 shrink-0 overflow-hidden rounded-full ring-1 ring-[#b3b3b3]',
        className
      )}
    >
      <span aria-hidden className="absolute inset-0" style={CHECKER} />
      <span className="absolute inset-0" style={{ background: color }} />
    </span>
  );
}

/** 16×16 circular stroke ring — same outer size as FillColorSwatch. */
function StrokeColorSwatch({
  color = 'currentColor',
  className,
}: {
  color?: string;
  className?: string;
}) {
  return (
    <span
      className={cn(
        'inline-flex h-4 w-4 shrink-0 rounded-full border-[3.5px] bg-transparent',
        className
      )}
      style={{ borderColor: color }}
      aria-hidden
    />
  );
}

/** Corner-radius mark — `assets/svg/editor/corner_radius.svg`. */
function IconCornerRadius({ className }: { className?: string }) {
  return <Icon name="editor-corner-radius" width={16} height={16} className={className} />;
}

const MemoizedFillColorSwatch = memo(FillColorSwatch);
export { MemoizedFillColorSwatch as FillColorSwatch };
const MemoizedStrokeColorSwatch = memo(StrokeColorSwatch);
export { MemoizedStrokeColorSwatch as StrokeColorSwatch };
const MemoizedIconCornerRadius = memo(IconCornerRadius);
export { MemoizedIconCornerRadius as IconCornerRadius };
