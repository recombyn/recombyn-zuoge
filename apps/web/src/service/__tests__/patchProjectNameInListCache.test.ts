import { describe, expect, it, beforeEach } from 'vitest';
import { patchProjectNameInListCache } from '@/service/projects';
import { apiQuery, queryClient } from '@/service/client';

describe('patchProjectNameInListCache', () => {
  beforeEach(() => {
    queryClient.clear();
  });

  it('updates the project name inside infinite-query pages', () => {
    const key = apiQuery.projectsListMyProjects.key();
    queryClient.setQueryData(key, {
      pages: [
        {
          projects: [
            { id: 'p1', name: '未命名作品' },
            { id: 'p2', name: '其他' },
          ],
          next_cursor: null,
          total: 2,
        },
      ],
      pageParams: [undefined],
    });

    patchProjectNameInListCache('p1', '新标题测试');

    const data = queryClient.getQueryData(key) as {
      pages: Array<{ projects: Array<{ id: string; name: string }> }>;
    };
    expect(data.pages[0]!.projects[0]!.name).toBe('新标题测试');
    expect(data.pages[0]!.projects[1]!.name).toBe('其他');
  });
});
