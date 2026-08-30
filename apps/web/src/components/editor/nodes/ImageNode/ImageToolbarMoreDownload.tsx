import { useMemo, useState, type ReactNode, memo } from 'react';
import { useTranslation } from 'react-i18next';
import {
  HiOutlineAdjustmentsHorizontal,
  HiOutlineArrowsPointingOut,
  HiOutlineEllipsisHorizontal,
  HiOutlinePencilSquare,
  HiOutlineScissors,
} from 'react-icons/hi2';
import { MdOutlineFlip, MdOutlineOpacity } from 'react-icons/md';
import { TbDroplet, TbShirt } from 'react-icons/tb';
import { Dropdown } from '@/components/base';
import Tooltip from '@/components/base/tooltip';
import type { MenuItemType } from '@/components/base/dropdown';
import { cn } from '@/utils/classnames';
import { BlendModeIcon } from '@/components/rcb/selection/chrome/BlendModeControl';
import { IconCornerRadius } from '@/components/rcb/selection/chrome/StyleToolbarIcons';
import { imageMoreRow, imageToolBtn } from './imageToolbarShared';

export type ImageMoreAction =
  | 'mockup'
  | 'expand'
  | 'adjust'
  | 'blendMode'
  | 'effects'
  | 'cornerRadius'
  | 'opacity'
  | 'crop'
  | 'flipRotate'
  | 'vectorize';

export type ToolbarMoreItem = {
  key: string;
  icon: ReactNode;
  label: string;
  disabled?: boolean;
};

function moreItem(key: string, icon: ReactNode, label: string, disabled?: boolean): MenuItemType {
  return { key, label: imageMoreRow(icon, label), disabled };
}

/** Shared “…” overflow used by image and element selection toolbars. */
export function ToolbarMoreMenu({
  items,
  onAction,
  triggerClassName,
}: {
  items: ToolbarMoreItem[];
  onAction: (key: string) => void;
  triggerClassName?: string;
}): ReactNode {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const menuItems: MenuItemType[] = useMemo(
    () => items.map((item) => moreItem(item.key, item.icon, item.label, item.disabled)),
    [items]
  );
  if (!items.length) return null;
  return (
    <Dropdown
      trigger="click"
      open={open}
      onOpenChange={setOpen}
      placement="bottom-start"
      offset={8}
      strategy="fixed"
      items={menuItems}
      onClick={(key) => {
        onAction(key);
        setOpen(false);
      }}
      popupClassName="min-w-[11.5rem]"
      floatingClassName="z-[80]"
      referenceClassName="inline-flex"
    >
      <Tooltip tip={t('editor.imageToolbar.more')} placement="top">
        <button
          type="button"
          aria-label={t('editor.imageToolbar.more')}
          className={cn(triggerClassName || imageToolBtn, open && 'bg-[var(--accent-soft)]')}
        >
          <HiOutlineEllipsisHorizontal className="h-4 w-4" />
        </button>
      </Tooltip>
    </Dropdown>
  );
}

/** Image toolbar “More” menu: tools that dock to the right of the node. */
function ImageToolbarMoreDownload({
  onAction,
  showCornerRadius = true,
  mockupEnabled = false,
  vectorizeEnabled = false,
}: {
  onAction: (key: ImageMoreAction) => void;
  showCornerRadius?: boolean;
  mockupEnabled?: boolean;
  /** When false, 矢量化 stays in the menu but is disabled. */
  vectorizeEnabled?: boolean;
}): ReactNode {
  const { t } = useTranslation();
  const items: ToolbarMoreItem[] = useMemo(() => {
    const list: ToolbarMoreItem[] = [];
    if (mockupEnabled) {
      list.push({
        key: 'mockup',
        icon: <TbShirt className="h-4 w-4" strokeWidth={2} />,
        label: t('editor.imageToolbar.mockup'),
      });
    }
    list.push(
      {
        key: 'expand',
        icon: <HiOutlineArrowsPointingOut className="h-4 w-4" />,
        label: t('editor.imageToolbar.expand'),
      },
      {
        key: 'adjust',
        icon: <HiOutlineAdjustmentsHorizontal className="h-4 w-4" />,
        label: t('editor.imageToolbar.adjust'),
      },
      {
        key: 'blendMode',
        icon: <BlendModeIcon mode="normal" className="h-4 w-4" />,
        label: t('editor.imageToolbar.blendMode'),
      },
      {
        key: 'effects',
        icon: <TbDroplet className="h-4 w-4" />,
        label: t('editor.imageToolbar.effects'),
      }
    );
    if (showCornerRadius) {
      list.push({
        key: 'cornerRadius',
        icon: <IconCornerRadius className="h-4 w-4" />,
        label: t('editor.imageToolbar.cornerRadius'),
      });
    }
    list.push(
      {
        key: 'opacity',
        icon: <MdOutlineOpacity className="h-4 w-4" />,
        label: t('editor.imageToolbar.opacity'),
      },
      {
        key: 'crop',
        icon: <HiOutlineScissors className="h-4 w-4" />,
        label: t('editor.imageToolbar.crop'),
      },
      {
        key: 'flipRotate',
        icon: <MdOutlineFlip className="h-4 w-4" />,
        label: t('editor.imageToolbar.flipRotate'),
      },
      {
        key: 'vectorize',
        icon: <HiOutlinePencilSquare className="h-4 w-4" />,
        label: t('editor.imageToolbar.vectorize', { defaultValue: '矢量化' }),
        disabled: !vectorizeEnabled,
      }
    );
    return list;
  }, [t, showCornerRadius, mockupEnabled, vectorizeEnabled]);

  return <ToolbarMoreMenu items={items} onAction={(key) => onAction(key as ImageMoreAction)} />;
}

export default memo(ImageToolbarMoreDownload);
