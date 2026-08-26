import { describe, expect, it } from 'vitest';
import { uploadMaxMbForMime, UploadTooLargeError } from '@/utils/uploadLimits';

describe('uploadLimits', () => {
  it('defaults to unlimited (0)', () => {
    expect(uploadMaxMbForMime('image/png')).toBe(0);
    expect(uploadMaxMbForMime('video/mp4')).toBe(0);
  });

  it('UploadTooLargeError carries maxMb', () => {
    expect(new UploadTooLargeError(100).maxMb).toBe(100);
  });
});
