import React, { memo } from 'react';
import {
  SegmentedControl,
  type SegmentedRadius,
} from '@/components/base/segmented';
import { cn } from '@/utils/classnames';

export interface TabsItem {
  value: string;
  label: React.ReactNode;
  /** Panel body; omit all to hide panels */
  content?: React.ReactNode;
  disabled?: boolean;
}

export interface TabsProps {
  items: TabsItem[];
  /** Controlled index; omit for uncontrolled (starts at 0) */
  selectedIndex?: number;
  onChange?: (index: number) => void;
  className?: string;
  TabListClass?: string;
  /** Unused — chips come from SegmentedControl. */
  TabClass?: string;
  TabPanelsClass?: string;
  /** Passed to SegmentedControl — default soft rect (`xl`). */
  radius?: SegmentedRadius;
}

/** Tab list uses shared `SegmentedControl`; optional panels below. */
export const Tabs: React.FC<TabsProps> = ({
  items,
  selectedIndex,
  onChange,
  className,
  TabListClass,
  TabPanelsClass,
  radius = 'xl',
}) => {
  const index = selectedIndex ?? 0;
  const value = items[index]?.value ?? items[0]?.value ?? '';

  return (
    <div className={cn('w-full', className)}>
      <div className="flex w-full shrink-0 flex-col items-center">
        <SegmentedControl
          radius={radius}
          className={cn('mb-2.5', TabListClass)}
          value={value}
          onChange={(next) => {
            const i = items.findIndex((it) => it.value === next);
            if (i >= 0) onChange?.(i);
          }}
          options={items.map((item) => ({
            value: item.value,
            label: item.label,
            disabled: item.disabled,
          }))}
        />
      </div>

      {items.some((item) => item.content !== undefined)
        ? items.map((item, i) =>
            i === index ? (
              <div
                key={item.value}
                className={cn('flex min-h-0 w-full flex-1 flex-col', TabPanelsClass)}
              >
                {item.content}
              </div>
            ) : null
          )
        : null}
    </div>
  );
};

export default memo(Tabs);