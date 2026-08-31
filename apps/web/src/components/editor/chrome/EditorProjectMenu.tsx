import { useRef, useState, type ChangeEvent, type ReactNode, memo } from 'react';
import { useSelector } from '@/store';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import {
  FloatingPortal,
  autoUpdate,
  flip,
  offset,
  shift,
  useClick,
  useDismiss,
  useFloating,
  useInteractions,
} from '@floating-ui/react';
import { UserAvatar } from '@/components/layout/UserAccountPanel';
import { getToken } from '@/utils/token';
import { buildLoginUrl } from '@/utils/authReturnTo';
import { cn } from '@/utils/classnames';

type Props = {
  onProjectList: () => void;
  onNewProject: () => void;
  onDuplicateProject: () => void;
  onImportJson: (file: File) => void;
  /** titlebar = desktop custom titlebar; float = canvas overlay; toolrail = timeline top strip */
  variant: 'float' | 'titlebar' | 'toolrail';
};

function MenuRow({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex w-full items-center whitespace-nowrap rounded-lg px-2.5 py-2 text-left text-[13px] text-[var(--ink)] transition hover:bg-[var(--accent-soft)]"
    >
      {label}
    </button>
  );
}

function EditorProjectMenu({
  onProjectList,
  onNewProject,
  onDuplicateProject,
  onImportJson,
  variant,
}: Props): ReactNode {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const user = useSelector((state: any) => state.auth?.user);
  const authed = Boolean(user && getToken());
  const [open, setOpen] = useState(false);
  const jsonInputRef = useRef<HTMLInputElement>(null);
  const titlebar = variant === 'titlebar';
  const toolrail = variant === 'toolrail';
  /** Match ToolBtn `h-8 w-8` when docked beside the drawing strip. */
  const avatarSize = toolrail ? 32 : titlebar ? 26 : 28;

  const { refs, floatingStyles, context } = useFloating({
    open,
    onOpenChange: setOpen,
    placement: 'bottom-start',
    strategy: 'fixed',
    whileElementsMounted: autoUpdate,
    middleware: [offset(8), flip({ padding: 8 }), shift({ padding: 8 })],
  });
  const click = useClick(context);
  const dismiss = useDismiss(context);
  const { getReferenceProps, getFloatingProps } = useInteractions([click, dismiss]);

  const close = () => setOpen(false);

  const run = (fn: () => void) => {
    close();
    fn();
  };

  const onPickJson = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    close();
    onImportJson(file);
    e.target.value = '';
  };

  const trigger = (
    <button
      type="button"
      className={cn(
        'inline-flex shrink-0 items-center text-[var(--ink)] transition',
        toolrail
          ? 'size-8 items-center justify-center rounded-lg hover:bg-[var(--accent-soft)]'
          : 'rounded-[10px] py-0.5 hover:bg-[color-mix(in_srgb,var(--ink)_6%,transparent)]'
      )}
      aria-expanded={open}
      aria-haspopup="menu"
      title={authed ? user?.name || user?.email || t('home.account') : t('home.login')}
    >
      {authed ? (
        <UserAvatar
          name={user.name}
          email={user.email}
          avatar={user.avatar}
          size={avatarSize}
          rounded={toolrail ? 'lg' : 'full'}
        />
      ) : (
        <UserAvatar
          size={avatarSize}
          name={null}
          email={null}
          avatar={null}
          rounded={toolrail ? 'lg' : 'full'}
        />
      )}
    </button>
  );

  return (
    <>
      <div ref={refs.setReference} {...getReferenceProps()} className="inline-flex shrink-0">
        {trigger}
      </div>
      <input
        ref={jsonInputRef}
        type="file"
        accept="application/json,.json"
        className="hidden"
        onChange={onPickJson}
      />
      {open ? (
        <FloatingPortal>
          <div
            ref={refs.setFloating}
            style={floatingStyles}
            {...getFloatingProps()}
            className="z-[600] w-max max-w-[calc(100vw-1.5rem)] overflow-hidden rounded-xl bg-[var(--surface)] p-1.5 shadow-[0_12px_40px_rgba(12,12,13,0.14)] ring-1 ring-[var(--line)]"
          >
            {authed ? (
              <>
                <MenuRow
                  label={t('editor.projectMenu.projectList')}
                  onClick={() => run(onProjectList)}
                />
                <MenuRow
                  label={t('editor.projectMenu.newProject')}
                  onClick={() => run(onNewProject)}
                />
                <MenuRow
                  label={t('editor.projectMenu.duplicate')}
                  onClick={() => run(onDuplicateProject)}
                />
                <MenuRow
                  label={t('home.importJson')}
                  onClick={() => {
                    close();
                    jsonInputRef.current?.click();
                  }}
                />
              </>
            ) : (
              <MenuRow
                label={t('home.login')}
                onClick={() => {
                  close();
                  navigate(buildLoginUrl());
                }}
              />
            )}
          </div>
        </FloatingPortal>
      ) : null}
    </>
  );
}

export default memo(EditorProjectMenu);
