/**
 * Uploaded object metadata + DELETE helper.
 * Canvas uploads use async jobs in `@/service/uploadJobs`.
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

/** DELETE /api/v1/uploads/files/{encodedKeyPath} (`{object_key:path}`). */
export const deleteUploadedFile = (encodedKeyPath: string) =>
  request<{ ok: boolean }>({
    url: `/api/v1/uploads/files/${encodedKeyPath}`,
    method: 'delete',
  });
