/**
 * Chat session DTOs — HTTP via `apiClient.chatSessions*`.
 */

export type ChatSessionMessageDto = {
  id?: string;
  role: string;
  content: string;
  /** Display chips for @ mentions (persisted with the turn). */
  contexts?: Array<{
    key: string;
    label: string;
    kind: string;
    thumbUrl?: string;
  }> | null;
  /** `content` with U+FFFC where each chip sat (inline bubble layout). */
  contentMarked?: string | null;
  thinking?: string | null;
  durationMs?: number | null;
  intent?: string | null;
  steps?: Array<{
    id: string;
    name: string;
    status: 'running' | 'done' | 'error' | 'pending';
    summary?: string;
  }> | null;
  /** Seedream / image-mode gallery URLs (prefer durable asset URLs). */
  images?: string[] | null;
  videos?: string[] | null;
  imageModelId?: string | null;
  imageModelLabel?: string | null;
  imageAspectRatio?: string | null;
  /** Paused LangGraph run — Resume button. */
  designTaskId?: string | null;
  canResume?: boolean | null;
  /** Ask mode propose → Confirm applies these ops. */
  proposedOps?: Array<{
    name?: string;
    args?: Record<string, unknown>;
    op_id?: string;
  }> | null;
  choiceUi?: {
    mode: 'confirm' | 'single' | 'multi' | 'buttons' | 'text';
    placeholder?: string;
    options: Array<{ label: string; action: 'apply' | 'reply' | 'dismiss' }>;
  } | null;
  proposalId?: string | null;
};

export type ChatSessionDto = {
  id: string;
  projectId?: string;
  title: string;
  updatedAt: number;
  createdAt?: number;
  taskState?: Record<string, unknown> | null;
  messages: ChatSessionMessageDto[];
};
