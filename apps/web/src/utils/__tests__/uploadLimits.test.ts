import { describe, expect, it } from 'vitest';
import {
  assertUploadFileSize,
  uploadMaxMbForMime,
  UploadTooLargeError,
} from '@/utils/uploadLimits';

describe('uploadLimits', () => {
  it('uses higher cap for video', () => {
    expect(uploadMaxMbForMime('image/png')).toBe(50);
    expect(uploadMaxMbForMime('video/mp4')).toBe(100);
  });

  it('throws before upload when file exceeds cap', () => {
    const big = new File([new Uint8Array(51 * 1024 * 1024)], 'big.png', {
      type: 'image/png',
    });
    expect(() => assertUploadFileSize(big)).toThrow(UploadTooLargeError);
  });
});
