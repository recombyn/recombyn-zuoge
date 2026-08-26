import { beforeEach, describe, expect, it } from 'vitest';
import { apiQuery, queryClient } from '@/service/client';
import { syncProjectRowFromServer, findProjectSummaryInListCache } from '@/service/projects';

describe('syncProjectRowFromServer', () => {
  beforeEach(() => {
    queryClient.clear();
  });

  it('updates row inside infinite list cache', () => {
    const infiniteOpts = apiQuery.projectsListMyProjects.infiniteOptions({
      input: (pageParam: number) => ({
        query: { page: pageParam, pageSize: 24 },
      }),
      initialPageParam: 1,
      getNextPageParam: () => undefined,
    });
    const key = infiniteOpts.queryKey;
    queryClient.setQueryData(key, {
      pages: [
        {
          projects: [
            {
              id: 'p1',
              name: '旧名',
              updatedAt: 1,
              createdAt: 1,
              thumbnailUrl: null,
            },
          ],
          page: 1,
          total: 1,
          hasMore: false,
        },
      ],
      pageParams: [1],
    });

    syncProjectRowFromServer({
      id: 'p1',
      name: '新名',
      updatedAt: 2,
      createdAt: 1,
      thumbnailUrl: ['/api/v1/uploads/files/projects/u/p1/thumb.webp'],
    });

    const row = findProjectSummaryInListCache('p1');
    expect(row?.name).toBe('新名');
    expect(row?.updatedAt).toBe(2);
    expect(row?.thumbnailUrl).toEqual([
      '/api/v1/uploads/files/projects/u/p1/thumb.webp',
    ]);
  });
});
