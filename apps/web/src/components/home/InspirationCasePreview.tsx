import { useEffect, useMemo, useRef, useState, type ReactNode, memo } from 'react';
import { FloatingPortal } from '@floating-ui/react';
import { useTranslation } from 'react-i18next';
import { HiHeart, HiOutlineEye, HiOutlineShare, HiOutlineXMark } from 'react-icons/hi2';
import type { OfficialCaseMeta } from '@/utils/officialCases';
import {
  caseAuthorLabel,
  normalizeCaseCategory,
  resolveCasePrompt,
  resolveCaseTitle,
} from '@/utils/officialCases';
import AuthorFollowAvatar from '@/components/home/AuthorFollowAvatar';
import TemplateThumbnail from '@/components/templates/TemplateThumbnail';
import { SoftGlowSurface } from '@/components/base';
import {
  extractFrameDocument,
  listArtboardFrames,
  type PlazaCoverFrame,
} from '@/utils/plazaCover';
import { cn } from '@/utils/classnames';

type PanelUrlItem = { id: string; name?: string; url: string };

function formatStatCount(n: number): string {
  if (n >= 1000) return `${(n / 1000).toFixed(1).replace(/\.0$/, '')}k`;
  return String(n);
}

function parsePanelUrls(caseMeta: OfficialCaseMeta | null): PanelUrlItem[] {
  const raw = (caseMeta as { panelUrls?: unknown } | null)?.panelUrls;
  if (!Array.isArray(raw)) return [];
  const out: PanelUrlItem[] = [];
  for (let i = 0; i < raw.length; i += 1) {
    const row = raw[i];
    if (!row || typeof row !== 'object') continue;
    const url = String((row as { url?: unknown }).url || '').trim();
    if (!url) continue;
    out.push({
      id: String((row as { id?: unknown }).id || `panel-${i}`),
      name: String((row as { name?: unknown }).name || '').trim() || undefined,
      url,
    });
  }
  return out;
}

function pickActiveId(
  prev: string | null,
  candidates: Array<{ id?: string | null }>,
  preferredId?: string
): string | null {
  const ids = candidates.map((c) => String(c.id || '').trim()).filter(Boolean);
  if (prev && ids.includes(prev)) return prev;
  if (preferredId && ids.includes(preferredId)) return preferredId;
  return ids[0] || null;
}

function cycleListItem<T extends { id?: string | null }>(
  items: T[],
  currentId: string | null | undefined,
  delta: number
): T | null {
  if (!items.length) return null;
  const idx = Math.max(
    0,
    items.findIndex((p) => String(p.id || '') === String(currentId || ''))
  );
  return items[(idx + delta + items.length) % items.length] || null;
}

function frameThumbLabel(
  frame: PlazaCoverFrame,
  index: number,
  t: (key: string, opts?: Record<string, unknown>) => string
): string {
  return String(frame.name || '').trim() || `${t('editor.pageExportName')}-${index + 1}`;
}

function panelThumbLabel(
  panel: PanelUrlItem,
  index: number,
  t: (key: string, opts?: Record<string, unknown>) => string
): string {
  return String(panel.name || '').trim() || `${t('editor.pageExportName')}-${index + 1}`;
}

async function shareCasePreview(title: string, author: string) {
  const text = `${title} — ${author}`;
  try {
    if (navigator.share) {
      await navigator.share({ title, text });
      return;
    }
    await navigator.clipboard.writeText(text);
  } catch {
    /* user cancelled / denied */
  }
}

function PreviewFrameThumb({
  id,
  label,
  active,
  onSelect,
  children,
}: {
  id: string;
  label: string;
  active: boolean;
  onSelect: () => void;
  children: ReactNode;
}): ReactNode {
  return (
    <button
      type="button"
      data-preview-frame-thumb={id}
      aria-label={label}
      aria-current={active ? 'true' : undefined}
      title={label}
      onClick={onSelect}
      className={cn(
        'relative h-[100px] w-[100px] shrink-0 overflow-hidden rounded-xl border bg-[#ececec] transition',
        active ? 'border-[var(--ink)]' : 'border-transparent opacity-80 hover:opacity-100'
      )}
    >
      {children}
    </button>
  );
}

function PreviewFrameThumbMobile({
  id,
  label,
  active,
  onSelect,
  children,
}: {
  id: string;
  label: string;
  active: boolean;
  onSelect: () => void;
  children: ReactNode;
}): ReactNode {
  return (
    <button
      type="button"
      aria-label={label}
      aria-current={active ? 'true' : undefined}
      onClick={onSelect}
      className={cn(
        'relative h-[100px] w-[100px] shrink-0 overflow-hidden rounded-xl border bg-[#ececec]',
        active ? 'border-[var(--ink)]' : 'border-transparent opacity-70'
      )}
    >
      {children}
    </button>
  );
}

function SkillPromptCard({
  prompt,
  skillLabel: _skillLabel,
  compact,
}: {
  prompt: string;
  skillLabel: string;
  compact?: boolean;
}): ReactNode {
  return (
    <div
      className={cn(
        'rounded-2xl bg-[var(--accent-soft)]',
        compact ? 'px-3 py-2.5' : 'px-4 py-3.5'
      )}
    >
      <p
        className={cn(
          'text-[var(--ink)]',
          compact ? 'text-[12px] leading-relaxed' : 'text-[14px] leading-[1.7]'
        )}
      >
        {prompt}
      </p>
    </div>
  );
}

type Props = {
  open: boolean;
  caseMeta: OfficialCaseMeta | null;
  /** Full project document — left rail shows its artboards. */
  projectDocument: unknown | null;
  likedIds: Set<string>;
  likeBusy?: boolean;
  remixing?: boolean;
  onClose: () => void;
  onRemix: (meta: OfficialCaseMeta) => void;
  onToggleLike: (meta: OfficialCaseMeta) => void;
};

/**
 * Plaza case preview:
 * left+center: project title + artboard rail + selected artboard content;
 * right: author / prompt card.
 */
function InspirationCasePreview({
  open,
  caseMeta,
  projectDocument,
  likedIds,
  likeBusy,
  remixing,
  onClose,
  onRemix,
  onToggleLike,
}: Props): ReactNode {
  const { t } = useTranslation();
  const [entered, setEntered] = useState(false);
  const [activeFrameId, setActiveFrameId] = useState<string | null>(null);

  const panelUrls = useMemo(() => parsePanelUrls(caseMeta), [caseMeta]);
  const usePanelImages = panelUrls.length > 0;

  useEffect(() => {
    if (!open) {
      setEntered(false);
      return;
    }
    const id = window.requestAnimationFrame(() => {
      window.requestAnimationFrame(() => setEntered(true));
    });
    return () => window.cancelAnimationFrame(id);
  }, [open, caseMeta?.id]);

  const frames = useMemo(() => listArtboardFrames(projectDocument), [projectDocument]);

  useEffect(() => {
    if (!open) {
      setActiveFrameId(null);
      return;
    }
    if (usePanelImages) {
      setActiveFrameId((prev) => pickActiveId(prev, panelUrls));
      return;
    }
    if (!frames.length) {
      setActiveFrameId(null);
      return;
    }
    const preferred = String(
      (projectDocument as { activeFrameId?: unknown })?.activeFrameId || ''
    ).trim();
    setActiveFrameId((prev) => pickActiveId(prev, frames, preferred || undefined));
  }, [open, caseMeta?.id, frames, projectDocument, usePanelImages, panelUrls]);

  const activeFrame: PlazaCoverFrame | null = useMemo(() => {
    if (usePanelImages || !frames.length) return null;
    return frames.find((f) => f.id === activeFrameId) || frames[0] || null;
  }, [frames, activeFrameId, usePanelImages]);

  const activePanelUrl = useMemo(() => {
    if (!usePanelImages) return null;
    return panelUrls.find((p) => p.id === activeFrameId) || panelUrls[0] || null;
  }, [usePanelImages, panelUrls, activeFrameId]);

  const frameDocs = useMemo(() => {
    const map: Record<string, unknown> = {};
    for (const frame of frames) {
      const id = frame.id || '';
      if (!id) continue;
      const extracted = extractFrameDocument(projectDocument, frame);
      if (extracted) map[id] = extracted;
    }
    return map;
  }, [projectDocument, frames]);

  const previewDoc = useMemo(() => {
    if (usePanelImages) return null;
    if (activeFrame?.id && frameDocs[activeFrame.id]) return frameDocs[activeFrame.id];
    // No artboards: fall back to full document / nodes.
    return projectDocument;
  }, [activeFrame, frameDocs, projectDocument, usePanelImages]);

  const goFrame = (delta: number) => {
    if (usePanelImages) {
      const next = cycleListItem(panelUrls, activePanelUrl?.id || activeFrameId, delta);
      if (next?.id) setActiveFrameId(next.id);
      return;
    }
    const next = cycleListItem(frames, activeFrame?.id || activeFrameId, delta);
    if (next?.id) setActiveFrameId(next.id);
  };

  const wheelLockRef = useRef(0);
  const previewWheelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = previewWheelRef.current;
    if (!el || !open) return;

    const onWheel = (e: globalThis.WheelEvent) => {
      const count = usePanelImages ? panelUrls.length : frames.length;
      if (count < 2) return;
      // Prefer vertical wheel; fall back to horizontal trackpad.
      const dy = e.deltaY !== 0 ? e.deltaY : e.deltaX;
      if (!dy) return;
      e.preventDefault();
      e.stopPropagation();
      const now = Date.now();
      if (now - wheelLockRef.current < 280) return;
      wheelLockRef.current = now;
      goFrame(dy > 0 ? 1 : -1);
    };

    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
    // goFrame closes over latest frame/panel state via deps below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, usePanelImages, panelUrls, frames, activeFrameId, activePanelUrl]);

  useEffect(() => {
    if (!open || !activeFrameId) return;
    const el = window.document.querySelector(
      `[data-preview-frame-thumb="${CSS.escape(activeFrameId)}"]`
    ) as HTMLElement | null;
    if (typeof el?.scrollIntoView === 'function') {
      el.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    }
  }, [open, activeFrameId]);

  useEffect(() => {
    if (!open || !caseMeta) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
        return;
      }
      if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
        e.preventDefault();
        goFrame(-1);
      } else if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
        e.preventDefault();
        goFrame(1);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, caseMeta, activeFrameId, frames, panelUrls, usePanelImages, onClose]);

  useEffect(() => {
    if (!open) return;
    const prev = window.document.body.style.overflow;
    window.document.body.style.overflow = 'hidden';
    return () => {
      window.document.body.style.overflow = prev;
    };
  }, [open]);

  if (!open || !caseMeta) return null;

  const title = resolveCaseTitle(caseMeta, t);
  const author = caseAuthorLabel(caseMeta, t);
  const liked = likedIds.has(caseMeta.id);
  const likes = Math.max(0, Number(caseMeta.likeCount) || 0);
  const uses = Math.max(0, Number(caseMeta.useCount) || 0);
  const canSwitch = usePanelImages ? panelUrls.length > 1 : frames.length > 1;
  /** Left rail thumbs — show even when only one panel/artboard. */
  const showThumbRail = usePanelImages ? panelUrls.length > 0 : frames.length > 0;
  const prompt = resolveCasePrompt(caseMeta, t);
  const categoryLabel = t(`home.cases.cat.${normalizeCaseCategory(caseMeta.category)}`);
  const hasDoc = Boolean(activePanelUrl?.url || previewDoc);
  const onShare = () => shareCasePreview(title, author);

  return (
    <FloatingPortal>
      <div
        className={cn(
          'fixed inset-0 z-[850] transition-[background-color] duration-300',
          entered ? 'bg-[var(--preview-overlay)]' : 'bg-transparent'
        )}
        role="presentation"
        onClick={onClose}
      >
        <button
          type="button"
          aria-label={t('home.cases.previewClose')}
          onClick={(e) => {
            e.stopPropagation();
            onClose();
          }}
          className="absolute right-4 top-2.5 z-[860] inline-flex h-8 w-8 items-center justify-center text-white transition hover:opacity-80"
        >
          <HiOutlineXMark className="h-5 w-5" strokeWidth={2} />
        </button>
        <div
          role="dialog"
          aria-modal="true"
          aria-label={title}
          className={cn(
            'fixed bottom-0 left-0 right-0 z-[855] flex gap-3 overflow-hidden p-[15px]',
            'top-[50px] rounded-t-[14px] bg-[var(--canvas)]',
            'transition-transform duration-[420ms] ease-[cubic-bezier(0.22,1,0.36,1)] will-change-transform',
            entered ? 'translate-y-0' : '-translate-y-10'
          )}
          onClick={(e) => e.stopPropagation()}
        >
          <div className="relative flex min-h-0 min-w-0 flex-1 flex-col bg-[var(--canvas)]">
            <div className="mb-3 flex shrink-0 items-center gap-3">
              <h2 className="min-w-0 flex-1 truncate text-[16px] font-semibold leading-tight text-[var(--ink)]">
                {title}
              </h2>
              <div className="hidden shrink-0 items-center gap-2 md:flex">
                <button
                  type="button"
                  disabled={remixing}
                  onClick={() => onRemix(caseMeta)}
                  className="inline-flex h-8 items-center justify-center rounded-xl bg-[var(--ink)] px-3.5 text-[13px] font-medium text-[var(--on-brand)] transition hover:opacity-90 disabled:opacity-50"
                >
                  {remixing ? t('home.cases.remixing') : t('home.cases.makeSame')}
                </button>
              </div>
            </div>

            <div ref={previewWheelRef} className="flex min-h-0 min-w-0 flex-1">
              {showThumbRail ? (
                <div className="hidden w-[100px] shrink-0 flex-col gap-2.5 overflow-y-auto py-px md:flex">
                  {usePanelImages
                    ? panelUrls.map((panel, i) => {
                        const id = panel.id || `panel-${i}`;
                        const active = id === (activePanelUrl?.id || activeFrameId);
                        const label = panelThumbLabel(panel, i, t);
                        return (
                          <PreviewFrameThumb
                            key={id}
                            id={id}
                            label={label}
                            active={active}
                            onSelect={() => setActiveFrameId(id)}
                          >
                            <TemplateThumbnail imageUrl={panel.url} fit="cover" />
                          </PreviewFrameThumb>
                        );
                      })
                    : frames.map((frame, i) => {
                        const id = frame.id || `frame-${i}`;
                        const active = id === (activeFrame?.id || activeFrameId);
                        const thumb = frameDocs[id];
                        const label = frameThumbLabel(frame, i, t);
                        return (
                          <PreviewFrameThumb
                            key={id}
                            id={id}
                            label={label}
                            active={active}
                            onSelect={() => setActiveFrameId(id)}
                          >
                            {thumb ? (
                              <TemplateThumbnail document={thumb} fit="cover" />
                            ) : (
                              <SoftGlowSurface className="h-full w-full" seed={id} aria-hidden />
                            )}
                          </PreviewFrameThumb>
                        );
                      })}
                </div>
              ) : null}

              <div className="relative flex min-h-0 min-w-0 flex-1 items-center justify-center px-3">
                {activePanelUrl?.url ? (
                  <div className="relative flex h-full max-h-full w-full items-center justify-center overflow-hidden rounded-2xl">
                    <TemplateThumbnail imageUrl={activePanelUrl.url} fit="contain" />
                  </div>
                ) : previewDoc ? (
                  <div className="relative flex h-full max-h-full w-full items-center justify-center overflow-hidden rounded-2xl">
                    <TemplateThumbnail document={previewDoc} fit="contain" />
                  </div>
                ) : (
                  <SoftGlowSurface
                    className="h-full w-full max-w-5xl rounded-2xl"
                    seed="case-preview"
                    aria-busy="true"
                  />
                )}
              </div>
            </div>

            {/* Mobile: prompt + artboard thumbs + CTA — in-flow so preview centers above it */}
            <div className="mt-3 flex shrink-0 flex-col bg-[var(--surface)] md:hidden">
              <div className="px-1 pt-1">
                <SkillPromptCard prompt={prompt} skillLabel={t('agent.skill')} compact />
                <div className="mt-3 flex items-center justify-between gap-3">
                  <div className="flex min-w-0 items-center gap-2 text-left">
                    <AuthorFollowAvatar name={author} avatar={caseMeta.authorAvatar} size={28} />
                    <span className="truncate text-[13px] font-medium text-[var(--ink)]">{author}</span>
                  </div>
                  <div className="flex shrink-0 items-center gap-3 text-[12px] tabular-nums text-[var(--muted)]">
                    <span
                      className="inline-flex items-center gap-1"
                      title={t('home.cases.useCount', { count: uses })}
                    >
                      <HiOutlineEye className="h-4 w-4" strokeWidth={1.75} aria-hidden />
                      {formatStatCount(uses)}
                    </span>
                    <button
                      type="button"
                      aria-pressed={liked}
                      disabled={likeBusy}
                      onClick={() => onToggleLike(caseMeta)}
                      className="inline-flex items-center gap-1 transition disabled:opacity-50"
                      title={liked ? t('home.cases.unlike') : t('home.cases.like')}
                    >
                      <HiHeart className="h-4 w-4 fill-current" aria-hidden />
                      {formatStatCount(likes)}
                    </button>
                    <button
                      type="button"
                      aria-label={t('home.cases.share')}
                      onClick={() => onShare()}
                      className="inline-flex items-center"
                    >
                      <HiOutlineShare className="h-4 w-4" strokeWidth={1.75} />
                    </button>
                  </div>
                </div>
              </div>
              {showThumbRail ? (
                <div className="px-0 pt-3">
                  <div className="flex gap-2 overflow-x-auto pb-0.5 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
                    {usePanelImages
                      ? panelUrls.map((panel, i) => {
                          const id = panel.id || `panel-${i}`;
                          const active = id === (activePanelUrl?.id || activeFrameId);
                          const label = panelThumbLabel(panel, i, t);
                          return (
                            <PreviewFrameThumbMobile
                              key={id}
                              id={id}
                              label={label}
                              active={active}
                              onSelect={() => setActiveFrameId(id)}
                            >
                              <TemplateThumbnail imageUrl={panel.url} fit="cover" />
                            </PreviewFrameThumbMobile>
                          );
                        })
                      : frames.map((frame, i) => {
                          const id = frame.id || `frame-${i}`;
                          const active = id === (activeFrame?.id || activeFrameId);
                          const thumb = frameDocs[id];
                          const label = frameThumbLabel(frame, i, t);
                          return (
                            <PreviewFrameThumbMobile
                              key={id}
                              id={id}
                              label={label}
                              active={active}
                              onSelect={() => setActiveFrameId(id)}
                            >
                              {thumb ? (
                                <TemplateThumbnail document={thumb} fit="cover" />
                              ) : (
                                <SoftGlowSurface className="h-full w-full" seed={id} aria-hidden />
                              )}
                            </PreviewFrameThumbMobile>
                          );
                        })}
                  </div>
                </div>
              ) : null}
              <div className="pt-3">
                <button
                  type="button"
                  disabled={remixing}
                  onClick={() => onRemix(caseMeta)}
                  className="inline-flex h-10 w-full items-center justify-center rounded-xl bg-[var(--ink)] px-4 text-[14px] font-semibold text-[var(--on-brand)] transition hover:opacity-90 disabled:opacity-50"
                >
                  {remixing ? t('home.cases.remixing') : t('home.cases.remix')}
                </button>
              </div>
            </div>
          </div>

          <aside className="hidden min-w-0 shrink-0 flex-col bg-[var(--canvas)] md:flex md:w-[min(260px,32%)] lg:w-[min(320px,30%)] xl:w-[min(380px,28%)]">
            <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-2xl border border-[var(--line)] bg-[var(--surface)]">
              <div className="flex items-center gap-2 px-4 pb-3 pt-4">
                <AuthorFollowAvatar
                  name={author}
                  avatar={caseMeta.authorAvatar}
                  size={36}
                />
                <span className="min-w-0 flex-1 truncate text-left text-[14px] font-semibold text-[var(--ink)]">
                  {author}
                </span>
                <div className="flex shrink-0 items-center gap-3.5 text-[12px] tabular-nums text-[var(--muted)]">
                  <span
                    className="inline-flex items-center gap-1"
                    title={t('home.cases.useCount', { count: uses })}
                  >
                    <HiOutlineEye className="h-4 w-4" strokeWidth={1.75} aria-hidden />
                    {formatStatCount(uses)}
                  </span>
                  <button
                    type="button"
                    aria-pressed={liked}
                    disabled={likeBusy}
                    onClick={() => onToggleLike(caseMeta)}
                    className="inline-flex items-center gap-1 transition hover:text-[var(--ink)] disabled:opacity-50"
                    title={liked ? t('home.cases.unlike') : t('home.cases.like')}
                  >
                    <HiHeart className="h-4 w-4 fill-current" aria-hidden />
                    {formatStatCount(likes)}
                  </button>
                  <button
                    type="button"
                    aria-label={t('home.cases.share')}
                    onClick={() => onShare()}
                    className="inline-flex items-center transition hover:text-[var(--ink)]"
                  >
                    <HiOutlineShare className="h-4 w-4" strokeWidth={1.75} />
                  </button>
                </div>
              </div>

              <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-4">
                <SkillPromptCard prompt={prompt} skillLabel={t('agent.skill')} />
                <p className="mt-5 text-[12px] font-medium text-[var(--muted)]">{categoryLabel}</p>
                <p className="mt-1 text-[14px] font-medium text-[var(--ink)]">{title}</p>
              </div>
            </div>
          </aside>
        </div>
      </div>
    </FloatingPortal>
  );
}

export default memo(InspirationCasePreview);
