import { request } from '@/utils/request';
import type { FontFamilyNode } from '@/components/rcb/scene/document/fontCatalogTypes';

export const USER_FONT_LIMIT = 10;

const FONT_ACCEPT = '.ttf,.otf,.woff,.woff2,font/ttf,font/otf,font/woff,font/woff2';

export type FontUploadResult = {
  family: string;
  item: FontFamilyNode;
  userFontCount?: number;
  userFontLimit?: number;
};

export type FontListMeta = {
  userFontCount?: number;
  userFontLimit?: number;
};

export function fontFileAccept(): string {
  return FONT_ACCEPT;
}

export async function uploadUserFontFile(file: File): Promise<FontUploadResult> {
  const form = new FormData();
  form.append('file', file, file.name);
  return request<FontUploadResult>({
    url: '/api/v1/fonts/upload',
    method: 'post',
    data: form,
    timeout: 120_000,
  });
}

export async function deleteUserFont(family: string): Promise<{ ok: boolean; family: string }> {
  const fam = encodeURIComponent(String(family || '').trim());
  return request<{ ok: boolean; family: string }>({
    url: `/api/v1/fonts/mine/${fam}`,
    method: 'delete',
  });
}

export function readFontListMeta(page: unknown): FontListMeta {
  const rec = page && typeof page === 'object' ? (page as Record<string, unknown>) : {};
  return {
    userFontCount: Number(rec.userFontCount) || 0,
    userFontLimit: Number(rec.userFontLimit) || USER_FONT_LIMIT,
  };
}
