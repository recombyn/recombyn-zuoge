/**
 * Collab room tokens — API mints HMAC tokens; Node WS server verifies them.
 */

import { apiClient } from '@/service/client';
import type { CollabRoomToken } from '@/components/editor/collab/collabTypes';

export type MintCollabRoomTokenBody = {
  projectId?: string;
  shareId?: string;
};

export const mintCollabRoomTokenApi = (data: MintCollabRoomTokenBody) =>
  apiClient.collabCollabRoomToken({ body: data }) as Promise<CollabRoomToken>;
