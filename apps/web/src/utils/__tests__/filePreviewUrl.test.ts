import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import {
  createFilePreviewUrl,
  revokeFilePreviewUrl,
  isBlobPreviewUrl,
  isSeparateStillPosterUrl,
} from '../uploadImage';

describe('file preview blob URLs', () => {
  const createObjectURL = vi.fn(() => 'blob:mock-file');
  const revokeObjectURL = vi.fn();

  beforeEach(() => {
    createObjectURL.mockClear();
    revokeObjectURL.mockClear();
    vi.stubGlobal('URL', {
      ...URL,
      createObjectURL,
      revokeObjectURL,
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('createFilePreviewUrl delegates to URL.createObjectURL', () => {
    const file = new File(['x'], 'a.png', { type: 'image/png' });
    const url = createFilePreviewUrl(file);
    expect(url).toBe('blob:mock-file');
    expect(createObjectURL).toHaveBeenCalledWith(file);
  });

  it('isBlobPreviewUrl detects blob: only', () => {
    expect(isBlobPreviewUrl('blob:abc')).toBe(true);
    expect(isBlobPreviewUrl('data:image/png;base64,AA')).toBe(false);
    expect(isBlobPreviewUrl('https://cdn/x.png')).toBe(false);
  });

  it('revokeFilePreviewUrl revokes blob: and ignores other schemes', () => {
    revokeFilePreviewUrl('blob:dead');
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:dead');

    revokeObjectURL.mockClear();
    revokeFilePreviewUrl('https://cdn/x.png');
    revokeFilePreviewUrl('data:image/png;base64,AA');
    expect(revokeObjectURL).not.toHaveBeenCalled();
  });

  it('isSeparateStillPosterUrl when poster differs from media preview', () => {
    expect(isSeparateStillPosterUrl('blob:poster', 'blob:video')).toBe(true);
    expect(isSeparateStillPosterUrl('data:image/jpeg;base64,/9j', 'blob:video')).toBe(true);
    expect(isSeparateStillPosterUrl('blob:video', 'blob:video')).toBe(false);
    expect(isSeparateStillPosterUrl('', 'blob:video')).toBe(false);
  });
});
