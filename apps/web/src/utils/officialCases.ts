export type OfficialCaseCategory = 'website' | 'mobile' | 'image' | 'poster' | 'video';

/** Normalize plaza category to the home hero set. */
export function normalizeCaseCategory(raw: string | undefined | null): OfficialCaseCategory {
  const c = (raw || '').trim().toLowerCase();
  if (
    c === 'website' ||
    c === 'mobile' ||
    c === 'image' ||
    c === 'poster' ||
    c === 'video'
  ) {
    return c;
  }
  return 'poster';
}

/**
 * Plaza / inspiration card meta.
 * All feed items are plaza-backed (admin-approved).
 */
export type OfficialCaseMeta = {
  id: string;
  category: OfficialCaseCategory;
  /** i18n key under home.cases.* */
  nameKey?: string;
  /** Direct display title (plaza posts) */
  name?: string;
  /** Gallery card height/width — intentional masonry variety (display only). */
  thumbRatio?: number;
  source?: 'official' | 'plaza';
  authorName?: string;
  authorAvatar?: string | null;
  /** Plaza feed coverDocument. */
  coverDocument?: unknown | null;
  /** Up to 4 cover tiles for list collage. */
  thumbnailUrls?: string[] | null;
  /** First tile URL; prefer thumbnailUrls when available. */
  thumbnail?: string | null;
  /** HD PNG panel URLs from admin approve — left-rail images. */
  panelUrls?: Array<{ id: string; name?: string; url: string }> | null;
  /** Stable author id for profile links. */
  authorUserId?: string;
  createdAt?: number;
  updatedAt?: number;
  likeCount?: number;
  useCount?: number;
};

/** Resolve display title for plaza posts or i18n keys. */
export function resolveCaseTitle(
  meta: OfficialCaseMeta,
  t: (key: string) => string
): string {
  const direct = (meta.name || '').trim();
  if (direct) return direct;
  if (meta.nameKey) return t(`home.cases.${meta.nameKey}`);
  return meta.id;
}

/** Agent prompt prefill when user taps 「做同款」. */
export function resolveCasePrompt(
  meta: OfficialCaseMeta,
  t: (key: string, opts?: Record<string, unknown>) => string
): string {
  if (meta.nameKey) {
    return t(`home.cases.prompt.${meta.nameKey}`, {
      defaultValue: t('home.cases.promptFallback'),
    });
  }
  const title = (meta.name || '').trim();
  if (title) {
    return t('home.cases.promptFromTitle', {
      title,
      defaultValue: `Create a design similar to「${title}」. ${t('home.cases.promptFallback')}`,
    });
  }
  return t('home.cases.promptFallback');
}

export function caseAuthorLabel(
  meta: OfficialCaseMeta,
  t: (key: string) => string
): string {
  const name = (meta.authorName || '').trim();
  if (name) return name;
  return t('home.cases.author');
}

/**
 * 「做同款」→ composer skill chip (pill like 「图片 1」), not a full canvas clone
 * and not plain prompt text alone.
 */
export function buildPlazaStyleSkillChip(
  meta: OfficialCaseMeta,
  t: (key: string, opts?: Record<string, unknown>) => string
): {
  key: string;
  label: string;
  kind: 'plaza';
  payload: string;
  dataUrl?: string;
  thumbUrl?: string;
} {
  const title = resolveCaseTitle(meta, t as (key: string) => string);
  const prompt = resolveCasePrompt(meta, t);
  const panels = Array.isArray(meta.panelUrls)
    ? meta.panelUrls.map((p) => String(p?.url || '').trim()).filter(Boolean)
    : [];
  const thumb = String(
    (Array.isArray(meta.thumbnailUrls) && meta.thumbnailUrls[0]) ||
      meta.thumbnail ||
      panels[0] ||
      ''
  ).trim();
  const vision = panels[0] || thumb || '';
  const labelBase = t('home.cases.makeSameSkill', { defaultValue: '同款' });
  const shortTitle =
    title.length > 12 ? `${title.slice(0, 11)}…` : title;
  const label = shortTitle ? `${labelBase} · ${shortTitle}` : String(labelBase);
  let panelLines = '';
  if (panels.length) {
    panelLines = ['styleImageUrls:', ...panels.map((u, i) => `  ${i + 1}. ${u}`)].join('\n');
  } else if (thumb) {
    panelLines = `styleImageUrl: ${thumb}`;
  }
  return {
    key: `plaza:${meta.id}`,
    label,
    kind: 'plaza',
    payload: [
      '[Plaza style skill — recreate this look on a blank canvas; do not assume the reference is already on the board]',
      `caseId: ${meta.id}`,
      `title: ${title}`,
      `category: ${meta.category || 'website'}`,
      panelLines,
      `instruction: ${prompt}`,
    ]
      .filter(Boolean)
      .join('\n'),
    ...(vision ? { dataUrl: vision, thumbUrl: thumb || vision } : {}),
  };
}
