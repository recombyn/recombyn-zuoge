/**
 * Share / directory DTOs — HTTP via `apiClient.shares*` / `usersUsers*`.
 */

export type SharePermission = 'preview' | 'download' | 'edit';

export type ShareDto = {
  id: string;
  ownerId?: string;
  name: string;
  permission: SharePermission;
  document?: unknown;
  editorUserIds?: string[];
  viewerUserIds?: string[];
  linkEnabled?: boolean;
  linkPublic?: boolean;
  viewerCanView?: boolean;
  viewerCanEdit?: boolean;
  sourceProjectId?: string | null;
  createdAt: number;
  updatedAt: number;
};

export type DirectoryUser = {
  id: string;
  name: string;
  email: string;
  avatar?: string | null;
};
