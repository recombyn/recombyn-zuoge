/**
 * User projects API — metadata + document sync (camera/selection stay local).
 *
 * List + cover metadata SoT: React Query (`projectsListMyProjects` + `project-list-row`).
 * After any mutation, call `refreshProjectsListAfterMutation`.
 */

import { apiClient, apiQuery, queryClient } from '@/service/client';

export type ProjectSummaryDto = {
  id: string;
  name: string;
  orgId?: string | null;
  orgName?: string | null;
  thumbnailUrl?: string | string[] | null;
  thumbnailCustom?: boolean;
  revision?: number;
  updatedAt: number;
  createdAt: number;
  hasDocument?: boolean;
};

export type ProjectDto = ProjectSummaryDto & {
  document?: unknown;
};

export type PaginatedProjects = {
  projects: ProjectSummaryDto[];
  page: number;
  pageSize: number;
  total: number;
  hasMore: boolean;
};

export type UpsertProjectBody = {
  id?: string;
  name: string;
  document?: unknown;
  thumbnailDataUrl?: string | null;
  thumbnailDataUrls?: string[] | null;
  thumbnailUrls?: string[] | null;
  thumbnailCustom?: boolean;
  baseRevision?: number;
  orgId?: string | null;
};

export type PatchProjectBody = {
  baseRevision: number;
  name?: string;
  thumbnailDataUrl?: string | null;
  thumbnailDataUrls?: string[] | null;
  thumbnailUrls?: string[] | null;
  thumbnailCustom?: boolean;
  upsertNodes?: Record<string, unknown>;
  removeNodeIds?: string[];
  pageChildren?: string[];
  frames?: unknown[];
  activeFrameId?: string | null;
  canvas?: Record<string, unknown>;
};

export const projectListRowQueryKey = (projectId: string) =>
  ['project-list-row', projectId] as const;

export const fetchProject = (id: string) =>
  apiClient.projectsGetOne({
    params: { project_id: id },
  }) as Promise<{ project: ProjectDto }>;

export async function extractProjectCoversApi(
  id: string,
  document?: unknown
): Promise<{ project: ProjectSummaryDto }> {
  return apiClient.projectsExtractCovers({
    params: { project_id: id },
    body: document != null ? { document: document as Record<string, unknown> } : undefined,
  }) as Promise<{ project: ProjectSummaryDto }>;
}

export async function upsertProjectApi(
  data: UpsertProjectBody,
  headers?: Record<string, string>
): Promise<{ project: ProjectSummaryDto }> {
  return apiClient.projectsUpsert({
    body: data as never,
    headers: headers?.['If-Match'] ? { 'If-Match': headers['If-Match'] } : undefined,
  }) as Promise<{ project: ProjectSummaryDto }>;
}

export async function patchProjectApi(
  id: string,
  data: PatchProjectBody,
  headers?: Record<string, string>
): Promise<{ project: ProjectSummaryDto }> {
  return apiClient.projectsPatchOne({
    params: { project_id: id },
    body: data as never,
    headers: headers?.['If-Match'] ? { 'If-Match': headers['If-Match'] } : undefined,
  }) as Promise<{ project: ProjectSummaryDto }>;
}

export async function deleteProjectApi(id: string): Promise<{ ok: boolean }> {
  return apiQuery.projectsRemove.call({
    params: { project_id: id },
  }) as Promise<{ ok: boolean }>;
}

export async function setProjectOrgApi(
  id: string,
  orgId: string | null
): Promise<{ project: ProjectSummaryDto }> {
  return apiClient.projectsSetProjectOrg({
    params: { project_id: id },
    body: { orgId },
  }) as Promise<{ project: ProjectSummaryDto }>;
}

export async function deleteProjectsApi(
  ids: string[]
): Promise<{ ok: boolean; deleted: number }> {
  return apiQuery.projectsBatchRemove.call({
    body: { ids },
  }) as Promise<{ ok: boolean; deleted: number }>;
}

/** Read one row from cached list pages (if present). */
export function findProjectSummaryInListCache(
  projectId: string
): ProjectSummaryDto | null {
  const id = String(projectId || '').trim();
  if (!id) return null;
  const queries = queryClient.getQueriesData<{ pages?: PaginatedProjects[] }>({
    queryKey: apiQuery.projectsListMyProjects.key(),
  });
  for (const [, data] of queries) {
    if (!data?.pages) continue;
    for (const page of data.pages) {
      const row = (page.projects || []).find((p) => p.id === id);
      if (row) return row;
    }
  }
  return null;
}

/** Write server row into list + row queries (not optimistic — API response only). */
export function syncProjectRowFromServer(row: ProjectSummaryDto) {
  const id = String(row.id || '').trim();
  if (!id) return;

  queryClient.setQueriesData(
    { queryKey: apiQuery.projectsListMyProjects.key() },
    (old: unknown) => {
      if (!old || typeof old !== 'object') return old;
      const data = old as { pages?: PaginatedProjects[]; pageParams?: unknown[] };
      if (!Array.isArray(data.pages)) return old;
      let found = false;
      const pages = data.pages.map((page) => ({
        ...page,
        projects: (page.projects || []).map((p) => {
          if (p.id !== id) return p;
          found = true;
          return { ...p, ...row, id };
        }),
      }));
      if (!found) return old;
      return { ...data, pages };
    }
  );

  queryClient.setQueryData(projectListRowQueryKey(id), row);
}

export async function invalidateProjectsListCache() {
  await queryClient.invalidateQueries({
    queryKey: apiQuery.projectsListMyProjects.key(),
    refetchType: 'all',
  });
}

export async function invalidateProjectListRow(projectId: string) {
  const id = String(projectId || '').trim();
  if (!id) return;
  await queryClient.invalidateQueries({ queryKey: projectListRowQueryKey(id) });
}

/** After create/update/delete/rename/cover — refetch list + optional row. */
export async function refreshProjectsListAfterMutation(projectId?: string) {
  await invalidateProjectsListCache();
  if (projectId) await invalidateProjectListRow(projectId);
}

/** Editor/share → home: mark list stale so mount refetches (staleTime: 0). */
export async function prepareProjectsListNavigation() {
  await invalidateProjectsListCache();
}

export function clearProjectsListCache() {
  queryClient.removeQueries({
    queryKey: apiQuery.projectsListMyProjects.key(),
  });
  queryClient.removeQueries({
    queryKey: ['project-list-row'],
  });
}
