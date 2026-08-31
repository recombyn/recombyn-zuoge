import { memo, useMemo } from 'react';
import { useDispatch, useSelector } from '@/store';
import { useTranslation } from 'react-i18next';
import Tooltip from '@/components/base/tooltip';
import { FloatingToolbar } from '@/components/editor/chrome/FloatingToolbar';
import {
  FillPanelPopover,
  fillPanelPreview,
  type FillPanelValue,
} from '@/components/editor/panels/FillPanel';
import { setBucketFill } from '@/store/modules/editor';
import { cn } from '@/utils/classnames';

function bucketFillToPanelValue(raw: any): FillPanelValue {
  return {
    fillType: raw?.fillType || 'solid',
    fillColor: String(raw?.fillColor || '#333333'),
    fillOpacity: Number.isFinite(Number(raw?.fillOpacity)) ? Number(raw.fillOpacity) : 100,
    fillGradient: raw?.fillGradient != null ? String(raw.fillGradient) : undefined,
    fillImageSrc: raw?.fillImageSrc != null ? String(raw.fillImageSrc) : undefined,
    fillImageFit: raw?.fillImageFit,
    fillImageRotate: raw?.fillImageRotate,
    fillImageScale: raw?.fillImageScale,
    fillImageOffsetX: raw?.fillImageOffsetX,
    fillImageOffsetY: raw?.fillImageOffsetY,
    fillImageAdjust: raw?.fillImageAdjust,
  };
}

/**
 * Paint-bucket options: same FillPanel as shape fill (solid / gradient / image).
 */
function BucketFillToolbar({
  className,
  chrome = 'pill',
}: {
  className?: string;
  /** `flat` when embedded in the timeline top rail (no pill border/shadow). */
  chrome?: 'pill' | 'flat';
}) {
  const { t } = useTranslation();
  const dispatch = useDispatch();
  const bucketFill = useSelector((s: any) => s.editor.bucketFill);
  const value = useMemo(() => bucketFillToPanelValue(bucketFill), [bucketFill]);
  const preview = fillPanelPreview(value);

  return (
    <div className={cn('pointer-events-auto', className)}>
      <FloatingToolbar variant={chrome} className="h-8 gap-1 px-2 py-0">
        <FillPanelPopover
          value={value}
          onChange={(next) => dispatch(setBucketFill(next))}
          title={t('editor.selectionToolbar.color')}
          placement="bottom"
          offset={10}
          shiftMainAxis={false}
          className="inline-flex"
        >
          {({ open }) => (
            <Tooltip tip={t('editor.selectionToolbar.fillColor')} placement="bottom" disabled={open}>
              <span
                className={cn(
                  'inline-flex h-6 w-6 items-center justify-center rounded-[4px] transition-colors',
                  open ? 'bg-[var(--accent-soft)]' : 'hover:bg-[var(--accent-soft)]'
                )}
              >
                <span
                  className="relative h-3.5 w-3.5 overflow-hidden rounded-full border border-black/15"
                  style={{ background: preview }}
                />
              </span>
            </Tooltip>
          )}
        </FillPanelPopover>
      </FloatingToolbar>
    </div>
  );
}

export default memo(BucketFillToolbar);
