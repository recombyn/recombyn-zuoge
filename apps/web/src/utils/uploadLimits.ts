/** Client-side caps — keep in sync with `apps/api/app/core/config.py` defaults. */
export const DEFAULT_MAX_UPLOAD_MB = 50;
export const DEFAULT_MAX_VIDEO_UPLOAD_MB = 100;

export function uploadMaxMbForMime(mime: string | undefined): number {
  const m = String(mime || '')
    .split(';')[0]
    .trim()
    .toLowerCase();
  if (m.startsWith('video/') || m.startsWith('audio/')) {
    return DEFAULT_MAX_VIDEO_UPLOAD_MB;
  }
  return DEFAULT_MAX_UPLOAD_MB;
}

export function uploadMaxBytesForMime(mime: string | undefined): number {
  return uploadMaxMbForMime(mime) * 1024 * 1024;
}

export function isUploadFileTooLarge(file: File): boolean {
  return file.size > uploadMaxBytesForMime(file.type);
}

export class UploadTooLargeError extends Error {
  readonly maxMb: number;

  constructor(maxMb: number) {
    super(`upload_too_large:${maxMb}`);
    this.name = 'UploadTooLargeError';
    this.maxMb = maxMb;
  }
}

export function assertUploadFileSize(file: File): void {
  const maxMb = uploadMaxMbForMime(file.type);
  if (file.size > maxMb * 1024 * 1024) {
    throw new UploadTooLargeError(maxMb);
  }
}
