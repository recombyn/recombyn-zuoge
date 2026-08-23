import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { resolvePlayableMediaBlobUrl } from '../uploadImage';

describe('resolvePlayableMediaBlobUrl', () => {
  const createObjectURL = vi.fn(() => 'blob:mock-audio');
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

  it('passthrough blob: and data: without createObjectURL', async () => {
    const blob = await resolvePlayableMediaBlobUrl('blob:already');
    expect(blob.url).toBe('blob:already');
    expect(createObjectURL).not.toHaveBeenCalled();
    blob.revoke();
    expect(revokeObjectURL).not.toHaveBeenCalled();

    const data = await resolvePlayableMediaBlobUrl('data:audio/mpeg;base64,AAA');
    expect(data.url.startsWith('data:')).toBe(true);
    expect(createObjectURL).not.toHaveBeenCalled();
  });

  it('rejects empty src', async () => {
    await expect(resolvePlayableMediaBlobUrl('')).rejects.toThrow(/empty/i);
  });
});
