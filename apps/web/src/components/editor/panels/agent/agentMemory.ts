import type { SceneDocument } from '@/components/rcb/sceneNode';
import { frameIsEmpty } from '@/components/rcb/frames/framePlatePointer';

export { frameIsEmpty };

export type ShortTermTurn = {
  role: 'user' | 'assistant';
  text: string;
  tags?: string[];
};

export type TaskStateFrame = {
  id: string;
  name?: string;
  x?: number;
  y?: number;
  w?: number;
  h?: number;
  node_count?: number;
  is_empty?: boolean;
};

export type TaskState = {
  v: number;
  session_id?: string;
  project_id?: string;
  user_id?: string;
  config?: {
    scene?: string;
    style_group_id?: number | null;
    canvas_size?: string;
    model?: string;
  };
  canvas?: {
    focus_frame_id?: string | null;
    last_agent_frame_id?: string | null;
    frames?: TaskStateFrame[];
  };
  design?: Record<string, unknown>;
  last_run?: {
    at?: number;
    task_id?: string;
    intent?: string | null;
    edit_in_place?: boolean;
    blank_artboard?: boolean;
    summary?: string;
    tool_ops_applied?: boolean;
    critique_notes?: string;
    scene?: string;
    canvas_size?: string;
  } | null;
  referents?: Record<string, string>;
};

export type DesignMemoryPayload = {
  medium: TaskState;
  short?: ShortTermTurn[];
  retrieve_long?: boolean;
};

export type MemoryPatch = {
  medium: Partial<TaskState>;
  long_suggestions?: Array<{ kind: string; text: string }>;
};

const MARKUP_RE = /<svg\b|<\/svg>|\{\s*"tool_ops"/i;

function deepMerge<T extends Record<string, unknown>>(base: T, patch: Partial<T>): T {
  const out = { ...base } as T;
  for (const [key, val] of Object.entries(patch || {})) {
    if (val === undefined || val === null) continue;
    const cur = out[key as keyof T];
    if (
      val &&
      typeof val === 'object' &&
      !Array.isArray(val) &&
      cur &&
      typeof cur === 'object' &&
      !Array.isArray(cur)
    ) {
      (out as any)[key] = deepMerge(cur as Record<string, unknown>, val as Record<string, unknown>);
    } else {
      (out as any)[key] = val;
    }
  }
  return out;
}

export function emptyTaskState(params: {
  sessionId?: string;
  projectId?: string;
}): TaskState {
  return {
    v: 1,
    session_id: params.sessionId,
    project_id: params.projectId,
    config: {},
    canvas: { focus_frame_id: null, last_agent_frame_id: null, frames: [] },
    design: {},
    last_run: null,
    referents: {},
  };
}

export function buildTaskStateFromDocument(params: {
  doc: SceneDocument;
  sessionId: string;
  projectId: string;
  focusFrameId?: string | null;
  lastAgentFrameId?: string | null;
  config?: TaskState['config'];
  prior?: TaskState | null;
}): TaskState {
  const base = params.prior
    ? deepMerge(emptyTaskState({ sessionId: params.sessionId, projectId: params.projectId }), params.prior)
    : emptyTaskState({ sessionId: params.sessionId, projectId: params.projectId });

  const frames = Array.isArray(params.doc?.frames) ? params.doc.frames : [];
  const frameSnapshots: TaskStateFrame[] = frames.slice(0, 32).map((f: any) => {
    const id = String(f.id);
    return {
      id,
      name: f.name ? String(f.name) : undefined,
      x: Math.round(Number(f.x) || 0),
      y: Math.round(Number(f.y) || 0),
      w: Math.round(Number(f.width) || 0),
      h: Math.round(Number(f.height) || 0),
      is_empty: frameIsEmpty(params.doc, id),
    };
  });

  const focus =
    params.focusFrameId ||
    base.canvas?.focus_frame_id ||
    params.doc?.activeFrameId ||
    params.lastAgentFrameId ||
    null;

  return {
    ...base,
    session_id: params.sessionId,
    project_id: params.projectId,
    config: { ...base.config, ...params.config },
    canvas: {
      focus_frame_id: focus,
      last_agent_frame_id:
        params.lastAgentFrameId ?? base.canvas?.last_agent_frame_id ?? null,
      frames: frameSnapshots,
    },
  };
}

export function buildShortTermFromMessages(
  messages: Array<{ role: string; content: string }>,
  maxTurns = 10,
  maxChars = 6000
): ShortTermTurn[] {
  const slice = messages.slice(-maxTurns * 2);
  const out: ShortTermTurn[] = [];
  let total = 0;
  for (const m of slice) {
    const role = m.role === 'assistant' ? 'assistant' : 'user';
    const text = String(m.content || '').trim();
    if (!text || MARKUP_RE.test(text)) continue;
    const chunk = text.slice(0, 2800);
    if (total + chunk.length > maxChars) {
      const remain = maxChars - total;
      if (remain < 80) break;
      out.push({ role, text: chunk.slice(0, remain) });
      break;
    }
    out.push({ role, text: chunk });
    total += chunk.length;
  }
  return out;
}

export function applyMemoryPatch(state: TaskState, patch: MemoryPatch | null | undefined): TaskState {
  if (!patch?.medium) return state;
  return deepMerge(state, { ...patch.medium }) as TaskState;
}

export function applyClientFrameHints(
  state: TaskState,
  hints: {
    lastAgentFrameId?: string | null;
    focusFrameId?: string | null;
    referent?: { label: string; frameId: string };
  }
): TaskState {
  const canvas = { ...(state.canvas || {}) };
  if (hints.lastAgentFrameId) {
    canvas.last_agent_frame_id = hints.lastAgentFrameId;
    if (!canvas.focus_frame_id) canvas.focus_frame_id = hints.lastAgentFrameId;
  }
  if (hints.focusFrameId) canvas.focus_frame_id = hints.focusFrameId;
  const referents = { ...(state.referents || {}) };
  if (hints.referent?.label && hints.referent.frameId) {
    referents[hints.referent.label] = hints.referent.frameId;
  }
  return { ...state, canvas, referents };
}
