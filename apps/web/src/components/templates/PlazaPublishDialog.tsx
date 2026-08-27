import { useEffect, useMemo, useState, type ReactNode, memo } from 'react';
import { useTranslation } from 'react-i18next';
import { HiCheck, HiOutlineSparkles } from 'react-icons/hi2';
import { Button, message } from '@/components/base';
import ProjectCoverCollage from '@/components/home/ProjectCoverCollage';
import { checkPlazaCoverForPublish, coverDocumentHasContent } from '@/utils/plazaCover';
import { projectThumbnailUrlsFromApi } from '@/utils/projectThumb';

type PlazaPublishFormProps = {
  publishing: boolean;
  projectId?: string;
  projectName: string;
  document?: unknown;
  coverUrls?: string | string[] | null;
  coverVersion?: number | string | null;
  onCancel: () => void;
  onSubmit: () => Promise<void> | void;
  onSuccessDone?: () => void;
  onPhaseChange?: (phase: 'confirm' | 'success') => void;
};

function PlazaPublishForm({
  publishing,
  projectId,
  projectName,
  document,
  coverUrls,
  coverVersion,
  onCancel,
  onSubmit,
  onSuccessDone,
  onPhaseChange,
}: PlazaPublishFormProps): ReactNode {
  const { t } = useTranslation();
  const [phase, setPhase] = useState<'confirm' | 'success'>('confirm');

  const coverCheck = useMemo(() => checkPlazaCoverForPublish(document), [document]);
  const thumbUrls = useMemo(
    () => projectThumbnailUrlsFromApi(coverUrls),
    [coverUrls]
  );
  const hasServerCover = thumbUrls.length > 0;
  const canvasEmpty = !hasServerCover && !coverDocumentHasContent(document);
  const canSubmit = coverCheck.ok && !canvasEmpty;

  useEffect(() => {
    setPhase('confirm');
    onPhaseChange?.('confirm');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId]);

  const goPhase = (next: 'confirm' | 'success') => {
    setPhase(next);
    onPhaseChange?.(next);
  };

  const handleSubmit = async () => {
    if (!canSubmit) return;
    if (canvasEmpty) {
      message.warning(t('plaza.emptyCanvas'));
      return;
    }
    try {
      await onSubmit();
      goPhase('success');
    } catch {
      /* error toast handled by caller */
    }
  };

  if (phase === 'success') {
    return (
      <div className="rcb-plaza-thanks relative px-1 pb-2 pt-6 text-center">
        <div className="pointer-events-none absolute inset-0 overflow-hidden" aria-hidden>
          <span className="rcb-plaza-thanks-orb rcb-plaza-thanks-orb-a" />
          <span className="rcb-plaza-thanks-orb rcb-plaza-thanks-orb-b" />
          <span className="rcb-plaza-thanks-orb rcb-plaza-thanks-orb-c" />
        </div>

        <div className="relative mx-auto flex h-[72px] w-[72px] items-center justify-center">
          <span className="rcb-plaza-thanks-ring" aria-hidden />
          <span className="rcb-plaza-thanks-badge inline-flex h-14 w-14 items-center justify-center rounded-full bg-[var(--ink)] text-[var(--on-brand)] shadow-[0_10px_28px_rgba(15,23,42,0.18)]">
            <HiCheck className="h-7 w-7" strokeWidth={2.25} />
          </span>
        </div>

        <div className="rcb-plaza-thanks-copy relative mt-5">
          <div className="mb-1.5 inline-flex items-center gap-1.5 text-[12px] font-medium text-[var(--muted)]">
            <HiOutlineSparkles className="h-3.5 w-3.5" />
            {t('plaza.thanksEyebrow')}
          </div>
          <h3 className="text-[20px] font-semibold tracking-tight text-[var(--ink)]">
            {t('plaza.thanksTitle')}
          </h3>
          <p className="mx-auto mt-2 max-w-[320px] text-[13px] leading-relaxed text-[var(--muted)]">
            {t('plaza.thanksBody', { name: projectName })}
          </p>
        </div>

        <div className="relative mt-6 flex justify-center">
          <Button
            size="small"
            type="primary"
            className="!min-w-[96px]"
            onClick={() => (onSuccessDone || onCancel)()}
          >
            {t('plaza.thanksDone')}
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div>
      <div className="overflow-hidden rounded-2xl border border-[var(--line)] bg-[var(--canvas)]">
        <div className="rcb-publish-cover-panel aspect-[680/385] w-full overflow-hidden bg-[var(--canvas)]">
          <ProjectCoverCollage
            urls={thumbUrls}
            version={coverVersion}
            document={document}
            eager
            className="!h-full !rounded-none !border-0 !shadow-none"
          />
        </div>
      </div>

      <p className="mt-3.5 text-[13px] font-medium text-[var(--ink)]">{projectName}</p>

      <p className="mt-2.5 text-[12.5px] leading-relaxed text-[var(--muted)]">
        {t('plaza.publishHint')}
      </p>

      <div className="mt-5 flex justify-end gap-2">
        <Button size="small" type="default" disabled={publishing} onClick={onCancel}>
          {t('common.cancel')}
        </Button>
        <Button
          size="small"
          type="primary"
          loading={publishing}
          disabled={!canSubmit}
          onClick={() => void handleSubmit()}
        >
          {t('plaza.submit')}
        </Button>
      </div>
    </div>
  );
}

const MemoizedPlazaPublishForm = memo(PlazaPublishForm);
export { MemoizedPlazaPublishForm as PlazaPublishForm };
