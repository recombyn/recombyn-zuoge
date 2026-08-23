/**
 * Plaza types + cover helpers — HTTP via `apiClient.plaza*` / `apiQuery`.
 */

export type PlazaStatus = 'pending' | 'approved' | 'rejected';

export type PlazaFeedTab = 'recommended' | 'latest' | 'following';

export type PlazaCategoryFilter =
  | 'all'
  | 'website'
  | 'mobile'
  | 'image'
  | 'poster'
  | 'video';

export type PlazaSubmissionDto = {
  id: string;
  projectId: string;
  userId: string;
  authorName: string;
  authorAvatar?: string | null;
  title: string;
  category: string;
  status: PlazaStatus;
  rejectReason?: string | null;
  createdAt: number;
  updatedAt: number;
  reviewedAt?: number | null;
  source?: 'plaza';
  /** Plaza list cover (artboard preview). Full canvas only on item detail. */
  coverDocument?: unknown | null;
  /** Up to 4 cover image URLs for list collage (admin custom overrides to one). */
  thumbnailUrl?: string | string[] | null;
  /** Admin-uploaded list cover raster. */
  customCoverImageUrl?: string | null;
  /** HD PNG panels written on admin approve. */
  panelUrls?: Array<{ id: string; name?: string; url: string }> | null;
  document?: unknown;
  likeCount?: number;
  useCount?: number;
};

export type PlazaFeedItemDto = {
  id: string;
  projectId?: string;
  userId?: string;
  authorName: string;
  authorAvatar?: string | null;
  title: string;
  category: string;
  status?: PlazaStatus;
  createdAt: number;
  updatedAt?: number;
  reviewedAt?: number | null;
  source: 'plaza';
  /** Plaza list cover snapshot — render with PlazaCoverThumb / TemplateThumbnail. */
  coverDocument?: unknown | null;
  thumbnailUrl?: string | string[] | null;
  customCoverImageUrl?: string | null;
  /** HD PNG panels written on admin approve. */
  panelUrls?: Array<{ id: string; name?: string; url: string }> | null;
  likeCount?: number;
  useCount?: number;
};

/** Display cover URLs: admin custom wins as a one-tile collage, else submit array. */
export function plazaDisplayCoverUrls(item: {
  customCoverImageUrl?: string | null;
  thumbnailUrl?: string | string[] | null;
}): string[] {
  const custom = String(item.customCoverImageUrl || '').trim();
  if (custom) return [custom];
  if (!Array.isArray(item.thumbnailUrl)) return [];
  return item.thumbnailUrl.map((u) => String(u || '').trim()).filter(Boolean).slice(0, 4);
}
