import { memo, type ReactNode } from 'react';
import { cn } from '@/utils/classnames';

type CreatorAvatarProps = {
  name: string;
  avatar?: string | null;
  size?: number;
  className?: string;
  onOpenProfile?: () => void;
};

/** Creator avatar (optional click via `onOpenProfile`). */
function AuthorFollowAvatar({
  name,
  avatar,
  size = 32,
  className,
  onOpenProfile,
}: CreatorAvatarProps): ReactNode {
  const initial = (name.trim()[0] || 'R').toUpperCase();
  const px = `${size}px`;

  const inner = avatar ? (
    <img src={avatar} alt="" className="h-full w-full object-cover" />
  ) : (
    <span className="font-semibold text-[var(--on-brand)]" style={{ fontSize: Math.max(10, size * 0.38) }}>
      {initial}
    </span>
  );

  const shell = (
    <span
      className={cn(
        'relative inline-flex shrink-0 items-center justify-center overflow-hidden rounded-full bg-[var(--ink)] ring-1 ring-[var(--line)]',
        className
      )}
      style={{ width: px, height: px }}
    >
      {inner}
    </span>
  );

  if (!onOpenProfile) return shell;

  return (
    <button
      type="button"
      aria-label={name}
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        onOpenProfile();
      }}
      className="rounded-full transition hover:opacity-90"
    >
      {shell}
    </button>
  );
}

export default memo(AuthorFollowAvatar);
