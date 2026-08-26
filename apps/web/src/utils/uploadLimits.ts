export const DEFAULT_MAX_UPLOAD_MB = 0;
export const DEFAULT_MAX_VIDEO_UPLOAD_MB = 0;

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

export class UploadTooLargeError extends Error {
  readonly maxMb: number;

  constructor(maxMb: number) {
    super(`upload_too_large:${maxMb}`);
    this.name = 'UploadTooLargeError';
    this.maxMb = maxMb;
  }
}
