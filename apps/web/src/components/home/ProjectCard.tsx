import type { ReactNode } from 'react';
import { useEffect, useRef, useState, memo } from 'react';
import { useTranslation } from 'react-i18next';
import { BiEditAlt } from 'react-icons/bi';
import {
  HiOutlineCheck,
  HiOutlineEllipsisHorizontal,
  HiOutlinePlus,
} from 'react-icons/hi2';
import { RiDeleteBinLine } from 'react-icons/ri';
import { Dropdown } from '@/components/base';
import type { MenuItemType } from '@/components/base/dropdown/MenuItem';
import ProjectCoverThumb from '@/components/home/ProjectCoverThumb';
import { SoftGlowSurface } from '@/components/base';
import { useGoEditor } from '@/utils/goEditor';
import { projectThumbFrameClass } from '@/utils/projectThumb';
import { cn } from '@/utils/classnames';

export type ProjectCardItem = {
  id: string;
  name?: string;
  document?: unknown;
  thumbnail?: string | string[] | null;
  updatedAt?: number;
  openedAt?: number;
  remoteOnly?: boolean;
  orgId?: string | null;
  orgName?: string | null;
};

export function formatProjectUpdatedAt(
  timestamp: number | undefined,
  locale: string
): string {
  if (!timestamp) return '';
  const date = new Date(timestamp);
  if (!Number.isFinite(date.getTime())) return '';
  return date.toLocaleDateString(locale.startsWith('zh') ? 'en-US' : locale, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

/** Shared card skeleton — soft-glow cover (list random) + title lines. */
function ProjectCardSkeleton({
  label,
  seed = 0,
}: {
  label?: string;
  seed?: string | number;
}): ReactNode {
  return (
    <article className="group" aria-busy="true" aria-label={label || 'loading'}>
      <SoftGlowSurface
        seed={seed}
        className={projectThumbFrameClass('shadow-none')}
        aria-hidden
      />
      <div className="rcb-skeleton-card mt-2.5 space-y-1.5 rounded-lg px-0.5 py-0.5">
        <div className="rcb-skeleton-bone h-3.5 w-[72%]" />
        <div className="rcb-skeleton-bone h-2.5 w-[48%]" />
      </div>
    </article>
  );
}

/** Dashed “New project” tile — first cell in Recent / My projects grids. */
function NewProjectCard({
  disabled = false,
  onClick,
}: {
  disabled?: boolean;
  onClick: () => void;
}): ReactNode {
  const { t } = useTranslation();
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className="group text-left disabled:opacity-50"
    >
      <div
        className={projectThumbFrameClass(
          cn(
            'flex items-center justify-center border-dashed shadow-none',
            'group-hover:border-[var(--muted)] group-hover:bg-[var(--accent-soft)] group-hover:shadow-none'
          )
        )}
      >
        <HiOutlinePlus className="h-8 w-8 text-[var(--muted)]" strokeWidth={1.5} />
      </div>
      <div className="mt-2.5 min-w-0 px-0.5">
        <div className="truncate text-[14px] font-semibold text-[var(--ink)]">
          {t('home.newProject')}
        </div>
        <p className="mt-0.5 truncate text-[12px] text-transparent" aria-hidden>
          &nbsp;
        </p>
      </div>
    </button>
  );
}

type Props = {
  item: ProjectCardItem;
  disabled?: boolean;
  selected?: boolean;
  selectMode?: boolean;
  /** Orgs the current user can attach this project to. */
  orgOptions?: { id: string; name: string }[];
  onToggle?: () => void;
  onDelete: () => void;
  /** Menu → rename dialog. */
  onRename: () => void;
  /** Title inline contentEditable commit. */
  onCommitRename: (name: string) => void;
  onSetOrg?: (orgId: string | null) => void;
};

/** Shared project card for Recent projects + My projects. */
function ProjectCard({
  item,
  disabled = false,
  selected = false,
  selectMode = false,
  orgOptions = [],
  onToggle,
  onDelete,
  onRename,
  onCommitRename,
  onSetOrg,
}: Props): ReactNode {
  const { t, i18n } = useTranslation();
  const goEditor = useGoEditor();
  const locale = i18n.resolvedLanguage || i18n.language || 'zh-CN';
  const stamp = Number(item.updatedAt) || Number(item.openedAt) || undefined;
  const updatedLabel = formatProjectUpdatedAt(stamp, locale);
  const displayName = item.name || t('home.untitled');
  const titleEditRef = useRef<HTMLDivElement | null>(null);
  const editingTitleRef = useRef(false);
  const [editingTitle, setEditingTitle] = useState(false);
  const coverThumbnail = item.thumbnail;

  useEffect(() => {
    if (!editingTitle) return;
    const el = titleEditRef.current;
    if (!el) return;
    el.textContent = displayName;
    el.focus();
    const range = document.createRange();
    range.selectNodeContents(el);
    const sel = window.getSelection();
    sel?.removeAllRanges();
    sel?.addRange(range);
  }, [editingTitle, displayName]);

  const startTitleEdit = () => {
    if (disabled || selectMode || editingTitleRef.current) return;
    editingTitleRef.current = true;
    setEditingTitle(true);
  };

  const finishTitleEdit = (commit: boolean) => {
    if (!editingTitleRef.current) return;
    editingTitleRef.current = false;
    const raw = titleEditRef.current?.textContent ?? '';
    setEditingTitle(false);
    if (!commit) return;
    const next = raw.replace(/\s+/g, ' ').trim() || t('home.untitled');
    if (next !== displayName) onCommitRename(next);
  };

  const openEditor = () => {
    if (disabled) return;
    goEditor({ projectId: item.id });
  };

  const menuItems: MenuItemType[] = [
    {
      key: 'rename',
      label: (
        <span className="inline-flex items-center gap-2">
          <BiEditAlt className="h-3.5 w-3.5" />
          {t('home.rename')}
        </span>
      ),
    },
    ...(onSetOrg && orgOptions.length > 0
      ? [
          ...orgOptions.map(
            (o) =>
              ({
                key: `org:${o.id}`,
                label: (
                  <span className="inline-flex items-center gap-2">
                    {item.orgId === o.id ? (
                      <HiOutlineCheck className="h-3.5 w-3.5" />
                    ) : (
                      <span className="inline-block h-3.5 w-3.5" />
                    )}
                    {t('home.moveToOrg', { name: o.name })}
                  </span>
                ),
              }) satisfies MenuItemType
          ),
          ...(item.orgId
            ? [
                {
                  key: 'org:none',
                  label: (
                    <span className="inline-flex items-center gap-2 text-[var(--muted)]">
                      {t('home.removeFromOrg')}
                    </span>
                  ),
                } satisfies MenuItemType,
              ]
            : []),
        ]
      : []),
    {
      key: 'delete',
      label: (
        <span className="inline-flex items-center gap-2 text-red-500">
          <RiDeleteBinLine className="h-3.5 w-3.5" />
          {t('common.delete')}
        </span>
      ),
    },
  ];

  const onMenu = (key: string) => {
    if (key === 'rename') onRename();
    if (key === 'delete') onDelete();
    if (key === 'org:none') onSetOrg?.(null);
    if (key.startsWith('org:') && key !== 'org:none') {
      onSetOrg?.(key.slice(4));
    }
  };

  const onPrimary = () => {
    if (selectMode) onToggle?.();
    else openEditor();
  };

  return (
    <article className={cn('group', disabled && 'opacity-50')}>
      <div
        className={cn(
          'relative rounded-[8px] transition',
          selected && 'shadow-[0_0_0_2px_rgba(91,141,239,0.35)]'
        )}
      >
        <button
          type="button"
          disabled={disabled && !selectMode}
          className="relative block w-full text-left disabled:cursor-not-allowed"
          onClick={onPrimary}
        >
          <ProjectCoverThumb
            thumbnail={coverThumbnail}
            version={stamp}
            className={selected ? 'border-[#8eb4e8]' : undefined}
          />
        </button>

        {selectMode ? (
          <button
            type="button"
            aria-label="select"
            onClick={(e) => {
              e.stopPropagation();
              onToggle?.();
            }}
            className={cn(
              'absolute left-1.5 top-1.5 z-20 flex h-3.5 w-3.5 items-center justify-center rounded-[2px] border transition',
              selected
                ? 'border-[var(--accent)] bg-[var(--accent)] text-[var(--on-brand)]'
                : 'border-[var(--line)] bg-[var(--surface)]/90 text-transparent'
            )}
          >
            <HiOutlineCheck className="h-2.5 w-2.5" strokeWidth={3} />
          </button>
        ) : null}
      </div>

      <div className="mt-2.5 flex items-start gap-1 px-0.5">
        <div className="min-w-0 flex-1">
          {editingTitle ? (
            <div
              ref={titleEditRef}
              role="textbox"
              aria-label={t('home.rename')}
              contentEditable
              suppressContentEditableWarning
              className={cn(
                'w-full min-w-0 text-left text-[14px] font-semibold text-[var(--ink)]',
                'overflow-hidden text-ellipsis whitespace-nowrap outline-none',
                'rounded-sm ring-1 ring-[var(--line)]'
              )}
              onClick={(e) => e.stopPropagation()}
              onBlur={() => finishTitleEdit(true)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  finishTitleEdit(true);
                } else if (e.key === 'Escape') {
                  e.preventDefault();
                  finishTitleEdit(false);
                }
              }}
            />
          ) : (
            <button
              type="button"
              disabled={disabled && !selectMode}
              title={selectMode ? undefined : displayName}
              className={cn(
                'block w-full min-w-0 truncate text-left text-[14px] font-semibold text-[var(--ink)]',
                'hover:opacity-80 disabled:cursor-not-allowed'
              )}
              onClick={() => {
                if (selectMode) onToggle?.();
                else startTitleEdit();
              }}
            >
              {displayName}
            </button>
          )}
          {updatedLabel ? (
            <p className="mt-0.5 truncate text-[12px] text-[var(--ink)]/55">
              {t('home.updatedAt', { time: updatedLabel })}
            </p>
          ) : null}
          {item.orgName ? (
            <p className="mt-0.5 truncate text-[11px] text-[var(--muted)]">
              {item.orgName}
            </p>
          ) : null}
        </div>
        {!selectMode ? (
          <div
            className="shrink-0 pt-0.5"
            onClick={(e) => e.stopPropagation()}
            onMouseDown={(e) => e.stopPropagation()}
          >
            <Dropdown
              trigger="click"
              placement="bottom-end"
              offset={4}
              items={menuItems}
              onClick={onMenu}
              floatingClassName="z-[600]"
              popupClassName="min-w-[9.5rem] rounded-xl !bg-[var(--surface)] p-1.5 shadow-[0_8px_28px_rgba(15,23,42,0.14)] ring-1 ring-[var(--line)]"
            >
              <button
                type="button"
                disabled={disabled}
                title={t('common.more')}
                className={cn(
                  'flex items-center justify-center p-0.5 text-[var(--ink)]/55 transition',
                  'opacity-0 group-hover:opacity-100 focus-visible:opacity-100',
                  'hover:text-[var(--ink)] disabled:opacity-40'
                )}
              >
                <HiOutlineEllipsisHorizontal className="h-4 w-4" />
              </button>
            </Dropdown>
          </div>
        ) : null}
      </div>
    </article>
  );
}

export default memo(ProjectCard);

const MemoizedProjectCardSkeleton = memo(ProjectCardSkeleton);
export { MemoizedProjectCardSkeleton as ProjectCardSkeleton };
const MemoizedNewProjectCard = memo(NewProjectCard);
export { MemoizedNewProjectCard as NewProjectCard };
