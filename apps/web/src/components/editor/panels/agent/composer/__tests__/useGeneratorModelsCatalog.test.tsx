import { renderHook, waitFor } from '@testing-library/react';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { useGeneratorModelsCatalog } from '../useGeneratorModelsCatalog';
import type { LlmModel } from '@/service/chat';

const useQueryMock = vi.fn();

vi.mock('@tanstack/react-query', () => ({
  useQuery: (...args: unknown[]) => useQueryMock(...args),
}));

vi.mock('@/service/client', () => ({
  apiQuery: {
    chatGetModels: {
      queryOptions: () => ({ queryKey: ['chat', 'models'] }),
    },
  },
}));

describe('useGeneratorModelsCatalog', () => {
  beforeEach(() => {
    useQueryMock.mockReset();
  });

  it('loads models and resolves model id', async () => {
    const setModelId = vi.fn();
    useQueryMock.mockReturnValue({
      isPending: false,
      isError: false,
      isFetched: true,
      data: {
        available: true,
        models: [{ id: 'video-a', label: 'Video A', provider: 'test', kind: 'video' } satisfies LlmModel],
      },
    });

    const { result } = renderHook(() =>
      useGeneratorModelsCatalog({
        buildList: (res) => res?.models ?? [],
        modelId: 'missing',
        setModelId,
        resolveModelId: (list, currentId) =>
          list.some((m) => m.id === currentId) ? null : (list[0]?.id ?? null),
      })
    );

    await waitFor(() => expect(result.current.status).toBe('ready'));
    expect(result.current.catalogAvailable).toBe(true);
    expect(result.current.models).toHaveLength(1);
    expect(setModelId).toHaveBeenCalledWith('video-a');
  });

  it('sets error state when query fails', async () => {
    const setModelId = vi.fn();
    useQueryMock.mockReturnValue({
      isPending: false,
      isError: true,
      isFetched: true,
      data: undefined,
    });

    const { result } = renderHook(() =>
      useGeneratorModelsCatalog({
        buildList: () => [],
        modelId: 'x',
        setModelId,
      })
    );

    await waitFor(() => expect(result.current.status).toBe('error'));
    expect(result.current.catalogAvailable).toBe(false);
    expect(result.current.models).toEqual([]);
    expect(setModelId).not.toHaveBeenCalled();
  });

  it('reports loading while pending', () => {
    useQueryMock.mockReturnValue({
      isPending: true,
      isError: false,
      isFetched: false,
      data: undefined,
    });

    const { result } = renderHook(() =>
      useGeneratorModelsCatalog({
        buildList: () => [],
        modelId: 'x',
        setModelId: vi.fn(),
      })
    );

    expect(result.current.status).toBe('loading');
    expect(result.current.catalogAvailable).toBeNull();
  });
});
