import { describe, expect, it, vi } from 'vitest';
import { generateImageBatch, listGenerateImageUrls, pickGenerateImageUrl } from '@/service/generateImageBatch';
import { createImageJob, waitForImageJob } from '@/service/chat';

vi.mock('@/service/chat', () => ({
  createImageJob: vi.fn(),
  waitForImageJob: vi.fn(),
}));

describe('generateImageBatch', () => {
  it('returns urls from fulfilled jobs', async () => {
    vi.mocked(createImageJob)
      .mockResolvedValueOnce('job-1')
      .mockResolvedValueOnce('job-2');
    vi.mocked(waitForImageJob)
      .mockResolvedValueOnce({ images: ['https://a.test/1.png'], model: 'm' })
      .mockResolvedValueOnce({ images: ['https://a.test/2.png'], model: 'm' });

    const urls = await generateImageBatch({ prompt: 'cat' }, 2);
    expect(urls).toEqual(['https://a.test/1.png', 'https://a.test/2.png']);
  });

  it('collects every image url from a multi-image job result', async () => {
    vi.mocked(createImageJob).mockResolvedValueOnce('job-1');
    vi.mocked(waitForImageJob).mockResolvedValueOnce({
      images: ['https://a.test/1.png', 'https://a.test/2.png'],
      model: 'm',
    });

    const urls = await generateImageBatch({ prompt: 'cat' }, 1);
    expect(urls).toEqual(['https://a.test/1.png', 'https://a.test/2.png']);
  });

  it('calls onJobsCreated with job ids before polling', async () => {
    vi.mocked(createImageJob).mockResolvedValueOnce('job-a');
    vi.mocked(waitForImageJob).mockResolvedValueOnce({
      images: ['https://a.test/1.png'],
      model: 'm',
    });
    const onJobsCreated = vi.fn();

    await generateImageBatch({ prompt: 'cat' }, 1, { onJobsCreated });
    expect(onJobsCreated).toHaveBeenCalledWith(['job-a']);
  });

  it('surfaces billing errors instead of empty result', async () => {
    vi.mocked(createImageJob).mockResolvedValue('job-x');
    vi.mocked(waitForImageJob).mockRejectedValue(
      Object.assign(new Error('Insufficient credits'), { status: 402 })
    );

    await expect(generateImageBatch({ prompt: 'cat' }, 2)).rejects.toThrow(/Insufficient credits/i);
  });
});

describe('pickGenerateImageUrl', () => {
  it('returns the first stored image url', () => {
    expect(
      pickGenerateImageUrl({
        images: ['https://cdn/asset.png', 'https://cdn/asset-2.png'],
        model: 'm',
      })
    ).toBe('https://cdn/asset.png');
  });
});

describe('listGenerateImageUrls', () => {
  it('returns stored image urls from images[]', () => {
    expect(
      listGenerateImageUrls({
        images: ['https://cdn/asset/1.png'],
        model: 'm',
        assets: [{ url: 'https://cdn/ignored.png' }],
      })
    ).toEqual(['https://cdn/asset/1.png']);
  });

  it('dedupes image urls', () => {
    expect(
      listGenerateImageUrls({
        images: ['https://cdn/1.png', 'https://cdn/1.png'],
        model: 'm',
      })
    ).toEqual(['https://cdn/1.png']);
  });
});
