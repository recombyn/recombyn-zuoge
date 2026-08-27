/** Tombstone — block cloud sync from re-creating a deleted project. */

import { normalizeProjectId } from '@/utils/normalizeProjectId';

const deletedIds = new Set<string>();

export function markProjectsDeleted(projectIds: string[]): void {
  for (const id of projectIds) {
    const key = normalizeProjectId(id);
    if (key) deletedIds.add(key);
  }
}

export function unmarkProjectsDeleted(projectIds: string[]): void {
  for (const id of projectIds) {
    deletedIds.delete(normalizeProjectId(id));
  }
}

export function isProjectDeleted(projectId: string): boolean {
  return deletedIds.has(normalizeProjectId(projectId));
}
