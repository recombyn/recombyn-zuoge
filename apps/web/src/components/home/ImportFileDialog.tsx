import { useEffect, useState, memo } from 'react';
import { useTranslation } from 'react-i18next';
import { HiOutlinePhoto } from 'react-icons/hi2';
import { Button, Dialog } from '@/components/base';
import { cn } from '@/utils/classnames';

export type ImportFileKind = 'image';

export const IMPORT_ACCEPT: Record<ImportFileKind, string> = {
  image: 'image/*,.png,.jpg,.jpeg,.webp,.gif,.bmp',
};

type Props = {
  open: boolean;
  onClose: () => void;
  onConfirm: (kind: ImportFileKind) => void;
};

type KindOption = {
  id: ImportFileKind;
  icon: typeof HiOutlinePhoto;
  titleKey: string;
  formats: string;
};

const KIND_OPTIONS: KindOption[] = [
  {
    id: 'image',
    icon: HiOutlinePhoto,
    titleKey: 'importFile.image',
    formats: 'PNG · JPG · WEBP · GIF',
  },
];

function confirmImport(
  kind: ImportFileKind,
  onConfirm: (kind: ImportFileKind) => void,
  onClose: () => void
) {
  onConfirm(kind);
  onClose();
}

function kindCardClass(selected: boolean): string {
  return cn(
    'flex h-full min-w-0 flex-col items-center gap-2.5 rounded-xl px-3 py-8 text-center transition',
    selected
      ? 'bg-[var(--accent-soft)] ring-1 ring-[var(--accent)]'
      : 'bg-[var(--canvas)] hover:bg-[var(--accent-soft)]'
  );
}

function ImportFileDialog({ open, onClose, onConfirm }: Props) {
  const { t } = useTranslation();
  const [kind, setKind] = useState<ImportFileKind>('image');

  useEffect(() => {
    if (open) setKind('image');
  }, [open]);

  return (
    <Dialog
      show={open}
      onClose={onClose}
      width={640}
      title={t('importFile.title')}
      titleClassName="!text-[16px] !font-semibold !pb-1"
      bodyClassName="pt-1"
      className="!w-full !overflow-visible !bg-[var(--surface)] !p-6"
      footer={
        <>
          <Button size="small" type="default" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button
            size="small"
            type="primary"
            onClick={() => confirmImport(kind, onConfirm, onClose)}
          >
            {t('importFile.import')}
          </Button>
        </>
      }
    >
      <p className="mb-6 text-[13px] text-[var(--muted)]">{t('importFile.hint')}</p>

      <div className="grid max-w-sm grid-cols-1 gap-4">
        {KIND_OPTIONS.map((opt) => {
          const TypeIcon = opt.icon;
          const selected = kind === opt.id;
          return (
            <button
              key={opt.id}
              type="button"
              onClick={() => setKind(opt.id)}
              onDoubleClick={() => {
                setKind(opt.id);
                confirmImport(opt.id, onConfirm, onClose);
              }}
              className={kindCardClass(selected)}
            >
              <TypeIcon className="h-8 w-8 text-[var(--ink)]" strokeWidth={1.5} />
              <span className="text-[13px] font-medium text-[var(--ink)]">{t(opt.titleKey)}</span>
              <span className="text-[12px] text-[var(--muted)]">{opt.formats}</span>
            </button>
          );
        })}
      </div>
    </Dialog>
  );
}

export default memo(ImportFileDialog);
