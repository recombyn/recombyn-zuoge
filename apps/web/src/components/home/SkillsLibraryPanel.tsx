import {
  memo,
  useEffect,
  useRef,
  useState,
  type ChangeEvent,
  type ReactNode,
} from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useSelector } from 'react-redux';
import { useTranslation } from 'react-i18next';
import { HiOutlinePlus, HiOutlineQuestionMarkCircle } from 'react-icons/hi2';
import { Button, Dialog, message, SoftGlowSurface, Switch, Tooltip } from '@/components/base';
import {
  importDesignSkillZip,
  type DesignSkillCard,
  type DesignSkillImportExisting,
} from '@/service/design';
import { apiClient, apiQuery, getHttpErrorMessage } from '@/service/client';
import { HOME_SKILL_GRID } from '@/components/home/homeLayout';
import { useDeferredBusy } from '@/utils/useDeferredBusy';
import { cn } from '@/utils/classnames';

const DEFAULT_SKILL_GRID = HOME_SKILL_GRID;

/**
 * Loading placeholders only (same idea as GRID_SKELETON_COUNT on Me / feed).
 * Not the API total — first fetch has no count yet.
 */
/** ~one row beside the upload tile on the 3-col grid (upload + 2). */
const SKILL_SKELETON_MINE = 2;
/** Official loading placeholders — two rows on the 3-col grid. */
const SKILL_SKELETON_OFFICIAL = 6;

/** Skill card — icon + title/2-line subtitle + switch; 10px pad. */
const SKILL_CARD_SHELL =
  'flex h-full w-full flex-col rounded-xl border border-[var(--line)] bg-[var(--surface)] p-[10px] text-left shadow-[0_2px_8px_rgba(15,23,42,0.05)]';

/** Preview dialog mark — fixed square. */
const SKILL_ICON_FRAME =
  'inline-flex h-12 w-12 min-h-12 min-w-12 shrink-0 grow-0 overflow-hidden rounded-[12px] shadow-[0_1px_4px_rgba(15,23,42,0.08)]';
const SKILL_ICON_IMG = 'h-full w-full max-w-none object-cover';

/** Default picture icon when a pack has no logo — never use letter avatars. */
const DEFAULT_SKILL_ICON_SRC = '/skill-default-icon.png';

function SkillLogo({ src }: { src?: string | null }) {
  return (
    <span className={SKILL_ICON_FRAME} aria-hidden>
      <img src={src?.trim() || DEFAULT_SKILL_ICON_SRC} alt="" className={SKILL_ICON_IMG} />
    </span>
  );
}

const SKILLS_PICKER_INPUT = { query: { manage: true as const } };

/** Dashed upload tile — first cell in Mine grid. */
function UploadSkillCard({
  label,
  disabled = false,
  onClick,
}: {
  label: string;
  disabled?: boolean;
  onClick: () => void;
}): ReactNode {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      aria-label={label}
      title={label}
      className={cn(
        SKILL_CARD_SHELL,
        'min-h-[76px] items-center justify-center border-dashed shadow-none',
        'transition hover:border-[var(--muted)] hover:bg-[var(--accent-soft)]',
        'disabled:opacity-50'
      )}
    >
      <HiOutlinePlus className="h-6 w-6 text-[var(--muted)]" strokeWidth={1.5} />
    </button>
  );
}

function formatSkillUpdatedAt(ts: number | null | undefined, locale: string): string {
  if (!ts) return '—';
  const date = new Date(ts * (ts < 1e12 ? 1000 : 1));
  if (!Number.isFinite(date.getTime())) return '—';
  return date.toLocaleString(locale.startsWith('zh') ? 'zh-CN' : locale);
}

/** Same shell metrics as the real skill card. */
function SkillCardSkeleton({ seed = 0 }: { seed?: number }): ReactNode {
  return (
    <SoftGlowSurface
      seed={seed}
      className={cn(SKILL_CARD_SHELL, 'min-h-[76px] !rounded-xl shadow-none')}
      aria-hidden
    />
  );
}

/** Loading placeholders — fixed count, not API size. */
function SkillGroupSkeleton({
  title,
  count,
  leading,
  gridClassName = DEFAULT_SKILL_GRID,
}: {
  title: string;
  count: number;
  leading?: ReactNode;
  gridClassName?: string;
}): ReactNode {
  return (
    <section className="space-y-3" aria-busy="true" aria-label={title}>
      <h3 className="text-[12px] font-semibold uppercase tracking-wide text-[var(--muted)]">
        {title}
      </h3>
      <div className={gridClassName}>
        {leading}
        {Array.from({ length: count }, (_, i) => (
          <SkillCardSkeleton key={`sk-${i}`} seed={i} />
        ))}
      </div>
    </section>
  );
}

function SkillCard({
  row,
  enableLabel,
  onToggle,
  onPreview,
}: {
  row: DesignSkillCard;
  enableLabel: string;
  onToggle: (id: number, enabled: boolean) => void;
  onPreview: (row: DesignSkillCard) => void;
}): ReactNode {
  const on = row.enabled !== false;

  return (
    <div
      className={cn(
        SKILL_CARD_SHELL,
        'transition hover:border-[var(--muted)]',
        !on && 'opacity-55'
      )}
    >
      <div className="flex items-start gap-3">
        <button
          type="button"
          onClick={() => onPreview(row)}
          className="flex min-w-0 flex-1 cursor-pointer items-start gap-3 border-0 bg-transparent p-0 text-left"
        >
          <SkillLogo src={row.logo} />
          <div className="min-w-0 flex-1">
            <div className="truncate text-[14px] font-semibold leading-5 text-[var(--ink)]">
              {row.name}
            </div>
            {row.whenToUse ? (
              <div className="mt-1 line-clamp-2 text-[12px] leading-[18px] text-[var(--muted)]">
                {row.whenToUse}
              </div>
            ) : null}
          </div>
        </button>
        <span title={enableLabel} className="inline-flex shrink-0 pt-0.5">
          <Switch checked={on} onChange={(next) => onToggle(row.id, next)} />
        </span>
      </div>
    </div>
  );
}

function SkillGroup({
  title,
  rows,
  emptyText,
  enableLabel,
  onToggle,
  onPreview,
  leading,
  gridClassName = DEFAULT_SKILL_GRID,
}: {
  title: string;
  rows: DesignSkillCard[];
  emptyText: string;
  enableLabel: string;
  onToggle: (id: number, enabled: boolean) => void;
  onPreview: (row: DesignSkillCard) => void;
  /** First cell (e.g. upload tile in Mine). */
  leading?: ReactNode;
  /** Per-group grid; mine / official can differ if needed. */
  gridClassName?: string;
}): ReactNode {
  const showGrid = Boolean(leading) || rows.length > 0;
  const body = !showGrid ? (
    <p className="text-[13px] text-[var(--muted)]">{emptyText}</p>
  ) : (
    <div className={gridClassName}>
      {leading}
      {rows.map((row) => (
        <SkillCard
          key={row.id}
          row={row}
          enableLabel={enableLabel}
          onToggle={onToggle}
          onPreview={onPreview}
        />
      ))}
    </div>
  );

  return (
    <section className="space-y-3">
      <h3 className="text-[12px] font-semibold uppercase tracking-wide text-[var(--muted)]">
        {title}
      </h3>
      {body}
    </section>
  );
}

function patchSkillsPickerItems(
  old: unknown,
  mapItems: (items: DesignSkillCard[]) => DesignSkillCard[]
): unknown {
  const prev = old as { items?: DesignSkillCard[] } | undefined;
  return {
    ...(prev && typeof prev === 'object' ? prev : {}),
    items: mapItems(Array.isArray(prev?.items) ? prev.items : []),
  };
}

/**
 * Home Skills library — zip pack upload + list mine / official.
 * Mine and official load from one manage list; upload invalidates that query.
 */
function SkillsLibraryPanel(): ReactNode {
  const { t, i18n } = useTranslation();
  const queryClient = useQueryClient();
  const userId = useSelector((s: any) => (s.auth?.user?.id as string | undefined) || null);
  const fileRef = useRef<HTMLInputElement>(null);
  const pendingFileRef = useRef<File | null>(null);
  const [scanning, setScanning] = useState(false);
  const [overwrite, setOverwrite] = useState<DesignSkillImportExisting | null>(null);
  const [preview, setPreview] = useState<DesignSkillCard | null>(null);

  const skillsQuery = useQuery(
    apiQuery.designDesignSkillsPicker.queryOptions({
      input: SKILLS_PICKER_INPUT,
    })
  );

  useEffect(() => {
    if (!skillsQuery.isError) return;
    message.error(t('agent.apiDown'));
  }, [skillsQuery.isError, t, userId]);

  const items = ((skillsQuery.data as { items?: DesignSkillCard[] } | undefined)?.items ||
    []) as DesignSkillCard[];
  const mine = items.filter((x) => x.mine);
  const official = items.filter((x) => !x.mine);
  const loading = skillsQuery.isPending || (skillsQuery.isFetching && items.length === 0);
  const showSkeleton = useDeferredBusy(loading);

  const skillsPickerQueryKey = apiQuery.designDesignSkillsPicker.queryKey({
    input: SKILLS_PICKER_INPUT,
  });

  async function invalidateSkillsPicker() {
    await queryClient.invalidateQueries({
      queryKey: apiQuery.designDesignSkillsPicker.key(),
    });
  }

  async function runImport(file: File, forceOverwrite: boolean) {
    setScanning(true);
    try {
      const res = await importDesignSkillZip(file, { overwrite: forceOverwrite });
      if (res.status === 'exists' && res.existing) {
        pendingFileRef.current = file;
        setOverwrite(res.existing);
        return;
      }
      if (res.status === 'rejected') {
        const err = res.scan?.errors?.[0] || t('agent.requestFailed');
        message.error(t('agent.skillsImportRejected', { reason: err }));
        return;
      }
      pendingFileRef.current = null;
      setOverwrite(null);
      await invalidateSkillsPicker();
      message.success(t('agent.skillsImportOk'));
    } catch (err) {
      message.error(getHttpErrorMessage(err, t('agent.requestFailed')));
    } finally {
      setScanning(false);
    }
  }

  const onPickFile = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0] || null;
    e.target.value = '';
    if (!file) return;
    const lower = file.name.toLowerCase();
    if (!(lower.endsWith('.zip') || lower.endsWith('.recombyn-plugin'))) {
      message.warning(t('agent.skillsZipOnly'));
      return;
    }
    runImport(file, false);
  };

  const onConfirmOverwrite = () => {
    const file = pendingFileRef.current;
    if (!file) {
      setOverwrite(null);
      return;
    }
    setOverwrite(null);
    runImport(file, true);
  };

  const deleteSkillMutation = useMutation({
    mutationFn: async (id: number) => {
      await apiClient.designDesignSkillsDelete({ params: { skill_id: id } });
      return id;
    },
  });

  const toggleSkillMutation = useMutation({
    mutationFn: async (opts: { id: number; enabled: boolean }) => {
      await apiClient.designDesignSkillsSetEnabled({
        params: { skill_id: opts.id },
        body: { enabled: opts.enabled },
      });
      return opts;
    },
  });

  async function onDelete(id: number) {
    const prev = queryClient.getQueryData(skillsPickerQueryKey);
    queryClient.setQueryData(skillsPickerQueryKey, (old: unknown) =>
      patchSkillsPickerItems(old, (rows) => rows.filter((r) => r.id !== id))
    );
    try {
      await deleteSkillMutation.mutateAsync(id);
    } catch (err) {
      queryClient.setQueryData(skillsPickerQueryKey, prev);
      message.error(getHttpErrorMessage(err, t('agent.requestFailed')));
    }
  }

  async function onToggle(id: number, enabled: boolean) {
    const prev = queryClient.getQueryData(skillsPickerQueryKey);
    queryClient.setQueryData(skillsPickerQueryKey, (old: unknown) =>
      patchSkillsPickerItems(old, (rows) =>
        rows.map((r) => (r.id === id ? { ...r, enabled } : r))
      )
    );
    try {
      await toggleSkillMutation.mutateAsync({ id, enabled });
    } catch (err) {
      queryClient.setQueryData(skillsPickerQueryKey, prev);
      message.error(getHttpErrorMessage(err, t('agent.requestFailed')));
    }
  }

  const uploadTile = (
    <UploadSkillCard
      label={t('agent.skillsUpload')}
      disabled={scanning}
      onClick={() => fileRef.current?.click()}
    />
  );

  return (
    <div className="w-full min-w-0 space-y-5">
      <header className="flex min-w-0 items-center gap-1.5">
        <h1 className="truncate text-[24px] font-bold leading-tight tracking-tight text-[var(--ink)]">
          {t('home.skillsTitle')}
        </h1>
        <Tooltip
          tip={t('home.skillsHint')}
          placement="bottom"
          offset={8}
          popupClassName="!h-auto max-w-[340px] items-start whitespace-pre-line py-2.5 text-left leading-[1.45]"
        >
          <button
            type="button"
            className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[var(--muted)] transition-colors hover:bg-[var(--canvas)] hover:text-[var(--ink)]"
            aria-label={t('home.skillsHint')}
          >
            <HiOutlineQuestionMarkCircle className="h-5 w-5" strokeWidth={1.5} />
          </button>
        </Tooltip>
        <input
          ref={fileRef}
          type="file"
          accept=".zip,.recombyn-plugin,application/zip"
          className="hidden"
          onChange={onPickFile}
        />
      </header>

      <div className="space-y-6">
        {showSkeleton ? (
          <SkillGroupSkeleton
            title={t('agent.skillsMine')}
            count={SKILL_SKELETON_MINE}
            leading={uploadTile}
          />
        ) : loading ? (
          <div className="min-h-[120px]" aria-busy="true" />
        ) : (
          <SkillGroup
            title={t('agent.skillsMine')}
            rows={mine}
            emptyText={t('agent.skillsEmptyMine')}
            enableLabel={t('agent.skillsEnable')}
            onToggle={(id, enabled) => onToggle(id, enabled)}
            onPreview={setPreview}
            leading={uploadTile}
          />
        )}
        {showSkeleton ? (
          <SkillGroupSkeleton
            title={t('agent.skillsOfficial')}
            count={SKILL_SKELETON_OFFICIAL}
          />
        ) : loading ? null : (
          <SkillGroup
            title={t('agent.skillsOfficial')}
            rows={official}
            emptyText={t('agent.mentionSkillEmpty')}
            enableLabel={t('agent.skillsEnable')}
            onToggle={(id, enabled) => onToggle(id, enabled)}
            onPreview={setPreview}
          />
        )}
      </div>

      <Dialog
        show={Boolean(preview)}
        onClose={() => setPreview(null)}
        width={560}
        title={preview?.name || t('agent.skill')}
        titleClassName="!pb-1 !text-[16px] !font-semibold !leading-snug"
        bodyClassName="pt-2"
        footerClassName="!pt-5"
        className="!overflow-visible !bg-[var(--surface)] !p-5"
        footer={
          <div className="flex w-full items-center justify-between gap-3">
            {preview?.mine ? (
              <Button
                size="small"
                type="default"
                className="!text-[var(--muted)] hover:!text-[var(--ink)]"
                onClick={() => {
                  const id = preview.id;
                  setPreview(null);
                  void onDelete(id);
                }}
              >
                {t('agent.skillsDelete')}
              </Button>
            ) : (
              <span />
            )}
            <Button size="small" type="primary" onClick={() => setPreview(null)}>
              {t('common.confirm')}
            </Button>
          </div>
        }
      >
        {preview ? (
          <div className="space-y-3.5">
            <div className="flex items-start gap-3">
              <SkillLogo src={preview.logo} />
              {preview.whenToUse ? (
                <p className="min-w-0 flex-1 text-[13px] leading-relaxed text-[var(--muted)]">
                  {preview.whenToUse}
                </p>
              ) : null}
            </div>
            <div className="max-h-[min(52vh,420px)] overflow-y-auto rounded-lg border border-[var(--line)] bg-[var(--canvas)] px-3.5 py-3">
              <div className="mb-1.5 text-[11px] font-medium uppercase tracking-wide text-[var(--muted)]">
                {t('agent.skillsPreviewBody')}
              </div>
              <pre className="whitespace-pre-wrap break-words font-sans text-[13px] leading-relaxed text-[var(--ink)]">
                {preview.promptPositive?.trim() || t('agent.skillsPreviewEmpty')}
              </pre>
            </div>
          </div>
        ) : null}
      </Dialog>

      <Dialog
        show={scanning}
        onClose={() => setScanning(false)}
        width={420}
        title={t('agent.skillsScanTitle')}
        titleClassName="!pb-1 !text-[16px] !font-semibold !leading-snug"
        bodyClassName="pt-2"
        footerClassName="!pt-5"
        className="!overflow-visible !bg-[var(--surface)] !p-5"
        footer={
          <Button size="small" type="primary" onClick={() => setScanning(false)}>
            {t('agent.skillsScanGotIt')}
          </Button>
        }
      >
        <p className="text-[13px] leading-relaxed text-[var(--muted)]">
          {t('agent.skillsScanBody')}
        </p>
      </Dialog>

      <Dialog
        show={Boolean(overwrite)}
        onClose={() => {
          pendingFileRef.current = null;
          setOverwrite(null);
        }}
        width={420}
        title={t('agent.skillsOverwriteTitle')}
        titleClassName="!pb-1 !text-[16px] !font-semibold !leading-snug"
        bodyClassName="pt-2"
        footerClassName="!pt-5"
        className="!overflow-visible !bg-[var(--surface)] !p-5"
        footer={
          <>
            <Button
              size="small"
              type="default"
              onClick={() => {
                pendingFileRef.current = null;
                setOverwrite(null);
              }}
            >
              {t('common.cancel')}
            </Button>
            <Button size="small" type="primary" onClick={onConfirmOverwrite}>
              {t('agent.skillsOverwriteConfirm')}
            </Button>
          </>
        }
      >
        {overwrite ? (
          <div className="space-y-3.5">
            <p className="text-[13px] leading-relaxed text-[var(--muted)]">
              {t('agent.skillsOverwriteBody', { name: overwrite.name })}
            </p>
            <dl className="space-y-2 rounded-lg border border-[var(--line)] bg-[var(--canvas)] px-3.5 py-3">
              <div className="flex items-baseline justify-between gap-3 text-[12px]">
                <dt className="shrink-0 text-[var(--muted)]">
                  {t('agent.skillsOverwriteVersion')}
                </dt>
                <dd className="truncate font-medium text-[var(--ink)]">
                  {overwrite.packVersion || '—'}
                </dd>
              </div>
              <div className="flex items-baseline justify-between gap-3 text-[12px]">
                <dt className="shrink-0 text-[var(--muted)]">
                  {t('agent.skillsOverwriteUpdated')}
                </dt>
                <dd className="truncate font-medium text-[var(--ink)]">
                  {formatSkillUpdatedAt(overwrite.updatedAt, i18n.language)}
                </dd>
              </div>
              <div className="flex items-baseline justify-between gap-3 text-[12px]">
                <dt className="shrink-0 text-[var(--muted)]">
                  {t('agent.skillsOverwriteUses')}
                </dt>
                <dd className="truncate font-medium text-[var(--ink)]">
                  {overwrite.useCount ?? 0}
                </dd>
              </div>
            </dl>
          </div>
        ) : null}
      </Dialog>
    </div>
  );
}

export default memo(SkillsLibraryPanel);
