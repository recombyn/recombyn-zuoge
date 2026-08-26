import { useQuery } from '@tanstack/react-query';
import {
  fetchProject,
  findProjectSummaryInListCache,
  projectListRowQueryKey,
  type ProjectSummaryDto,
} from '@/service/projects';

/** Single project row — Query SoT (shared with home list cache). */
export function useProjectListRow(projectId: string | null | undefined, enabled = true) {
  const id = String(projectId || '').trim();
  return useQuery({
    queryKey: projectListRowQueryKey(id),
    enabled: enabled && Boolean(id),
    staleTime: 0,
    gcTime: 5 * 60_000,
    queryFn: async (): Promise<ProjectSummaryDto> => {
      const { project } = await fetchProject(id);
      return project;
    },
    placeholderData: () => findProjectSummaryInListCache(id) ?? undefined,
  });
}
