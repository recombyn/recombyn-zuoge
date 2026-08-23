/**
 * Image upload → backend → Tencent COS (or local store).
 * Multipart + path-catch-all DELETE stay on ky `request`
 * (OpenAPI file schema is string[]; `{object_key:path}` is unsafe as a single oRPC param).
 */

import { request } from '@/utils/request';

export type UploadedFileItem = {
  url: string;
  key?: string;
  mime?: string;
  name?: string;
  size?: number;
  width?: number | null;
  height?: number | null;
};

export type UploadFilesResult = {
  items: UploadedFileItem[];
};

/** Upload one or more images/videos. Form field name: `files`. */
export const uploadFiles = (
  data: FormData,
  opts?: { timeout?: number; signal?: AbortSignal }
) =>
  request<UploadFilesResult>({
    url: '/api/v1/uploads',
    method: 'post',
    data,
    timeout: opts?.timeout ?? 600000,
    signal: opts?.signal,
  });

/** DELETE /api/v1/uploads/files/{encodedKeyPath} (`{object_key:path}`). */
export const deleteUploadedFile = (encodedKeyPath: string) =>
  request<{ ok: boolean }>({
    url: `/api/v1/uploads/files/${encodedKeyPath}`,
    method: 'delete',
  });
