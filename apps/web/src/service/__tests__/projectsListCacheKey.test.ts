import { describe, expect, it, beforeEach } from 'vitest';
import { apiQuery, queryClient } from '@/service/client';
import { patchProjectNameInListCache } from '@/service/projects';

const PROJECT_PAGE_SIZE = 24;

describe('projects list cache patch', () => {
  beforeEach(() => {
    queryClient.clear();
  });

  it('patches data stored under infiniteOptions query key', () => {
    const infiniteOpts = apiQuery.projectsListMyProjects.infiniteOptions({
      input: (pageParam: number) => ({
        query: { page: pageParam, pageSize: PROJECT_PAGE_SIZE },
      }),
      initialPageParam: 1,
      getNextPageParam: () => undefined,
    });
    const key = infiniteOpts.queryKey;
    queryClient.setQueryData(key, {
      pages: [
        {
          projects: [{ id: 'p1', name: '未命名' }],
          page: 1,
          total: 1,
          hasMore: false,
        },
      ],
      pageParams: [1],
    });

    patchProjectNameInListCache('p1', '啦啦啦啦');

    const data = queryClient.getQueryData(key) as {
      pages: Array<{ projects: Array<{ id: string; name: string }> }>;
    };
    expect(data.pages[0]!.projects[0]!.name).toBe('啦啦啦啦');
  });
});
