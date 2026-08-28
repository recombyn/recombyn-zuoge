import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { resolveComposerMediaAfterUpload } from '../uploadImage';

describe('resolveComposerMediaAfterUpload', () => {
  const revokeObjectURL = vi.fn();

  beforeEach(() => {
    revokeObjectURL.mockClear();
    vi.stubGlobal('URL', {
      ...URL,
      createObjectURL: vi.fn(() => 'blob:new'),
      revokeObjectURL,
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('keeps local blob as chip thumb after upload while dataUrl is server', async () => {
    const { dataUrl, thumbUrl } = await resolveComposerMediaAfterUpload({
      serverUrl: 'https://cdn.example.com/full.png',
      localPreview: 'blob:local-preview',
    });
    expect(dataUrl).toBe('https://cdn.example.com/full.png');
    expect(thumbUrl).toBe('blob:local-preview');
    expect(revokeObjectURL).not.toHaveBeenCalled();
  });

  it('keeps video poster blob as thumb and revokes video blob', async () => {
    const { dataUrl, thumbUrl } = await resolveComposerMediaAfterUpload({
      serverUrl: 'https://cdn.example.com/clip.mp4',
      localPreview: 'blob:video',
      stillPreview: 'blob:poster',
    });
    expect(dataUrl).toBe('https://cdn.example.com/clip.mp4');
    expect(thumbUrl).toBe('blob:poster');
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:video');
    expect(revokeObjectURL).not.toHaveBeenCalledWith('blob:poster');
  });
});
