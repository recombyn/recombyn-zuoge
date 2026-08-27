import { Fragment, type ReactNode, memo } from 'react';
import { cn } from '@/utils/classnames';
import type { AssetDayGroup } from '@/utils/assetDateGroups';
import type { UserAsset } from '@/models/assets';

type Props = {
  groups: AssetDayGroup[];
  renderItem: (asset: UserAsset) => ReactNode;
  headerClassName?: string;
  /** `flat` — headers are col-span-full rows inside the parent grid (editor panel). */
  layout?: 'flat' | 'nested';
  /** Required when layout is `nested` — grid class for each day section. */
  gridClassName?: string;
  sectionClassName?: string;
};

function AssetDayGroupedGrid({
  groups,
  renderItem,
  headerClassName,
  layout = 'flat',
  gridClassName,
  sectionClassName,
}: Props) {
  if (layout === 'nested') {
    return (
      <>
        {groups.map((group, index) => (
          <section
            key={group.dayKey}
            className={cn('min-w-0 w-full', index > 0 && 'mt-1', sectionClassName)}
          >
            <h3
              className={cn(
                'mb-3 text-[18px] font-semibold leading-none text-[var(--muted)]',
                headerClassName
              )}
            >
              {group.label}
            </h3>
            <div className={gridClassName}>{group.items.map((asset) => renderItem(asset))}</div>
          </section>
        ))}
      </>
    );
  }

  return (
    <>
      {groups.map((group, index) => (
        <Fragment key={group.dayKey}>
          <h3
            className={cn(
              'col-span-full mb-2 text-[13px] font-medium leading-none text-[var(--muted)]',
              index > 0 && 'mt-3',
              headerClassName
            )}
          >
            {group.label}
          </h3>
          {group.items.map((asset) => renderItem(asset))}
        </Fragment>
      ))}
    </>
  );
}

export default memo(AssetDayGroupedGrid);
