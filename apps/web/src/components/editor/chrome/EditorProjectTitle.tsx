import { memo, type RefObject } from 'react';
import { useTranslation } from 'react-i18next';
import { cn } from '@/utils/classnames';

type Props = {
  projectName: string;
  onRename: (name: string) => void;
  inputRef?: RefObject<HTMLInputElement | null>;
  variant: 'float' | 'titlebar';
};

function EditorProjectTitle({ projectName, onRename, inputRef, variant }: Props) {
  const { t } = useTranslation();
  const titlebar = variant === 'titlebar';

  return (
    <span
      className={cn(
        'inline-grid min-w-0 max-w-full items-center overflow-hidden',
        titlebar ? 'max-w-[min(18rem,40vw)]' : 'max-w-[min(16rem,calc(100vw-18rem))]'
      )}
    >
      <span
        className={cn(
          'invisible col-start-1 row-start-1 max-w-full truncate whitespace-pre font-medium',
          titlebar ? 'text-[13px]' : 'text-[14px]'
        )}
        aria-hidden
      >
        {projectName || ' '}
      </span>
      <input
        ref={inputRef}
        value={projectName}
        onChange={(e) => onRename(e.target.value)}
        aria-label={t('home.untitled')}
        title={projectName}
        className={cn(
          'col-start-1 row-start-1 w-full min-w-0 truncate border-0 bg-transparent font-medium text-[var(--ink)] outline-none placeholder:text-[var(--muted)]',
          titlebar ? 'h-7 text-[13px]' : 'h-8 text-[14px]'
        )}
      />
    </span>
  );
}

export default memo(EditorProjectTitle);
