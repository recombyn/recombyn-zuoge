/**
 * Backend table-driven design job client (agent / single_model / partial).
 */

import { z } from 'zod';
import { abortAfter, apiClient, apiQuery, queryClient } from '@/service/client';
import { request } from '@/utils/request';
import { sse } from '@/utils/sse';

export type DesignRunMode = 'agent' | 'single_model' | 'partial';
export type DesignScene = 'website' | 'mobile' | 'image' | 'poster' | 'drawing' | 'video';

export type DesignCatalog = {
  scenes: DesignScene[];
  models: Array<{ id: string; label: string }>;
  style_groups: Array<{
    id: number;
    name: string;
    scenes: string;
    skill_ids: number[];
    priority: number;
  }>;
  prompt_stack?: string[];
  flows: Record<string, { id: number; scene: string; skill_ids: number[] }>;
  /** Enabled canvas tool_ops from design_canvas_tool — FE executes by op_key. */
  canvas_tools?: Array<{
    op_key: string;
    kind?: string;
    label?: string;
    model_hint?: string;
    args_schema?: string;
    enabled?: boolean;
    sort_order?: number;
  }>;
  /** Platform Admin global rules (includes precheck.user_preset.*). */
  global_rules?: Record<string, string>;
};

export type DesignSvgPatch = {
  mode: 'full' | 'patch';
  creates: string[];
  updates: string[];
  deletes: string[];
  create_count: number;
  update_count: number;
  delete_count: number;
  total_next?: number;
};

export type DesignJobEvent =
  | {
      type: 'status';
      task_id?: string;
      trace_id?: string;
      resumed?: boolean;
      status?: string;
      hold_credits?: number;
      scene?: string;
      canvas_width?: number;
      canvas_height?: number;
      canvas_size?: string;
      edit_in_place?: boolean;
      blank_artboard?: boolean;
      /** Host should open a new artboard (WxH) then paint content into it. */
      open_artboard?: boolean;
      intent?: string;
      frame_id?: string;
    }
  | {
      type: 'permission';
      can_call_llm: boolean;
      balance?: number;
      need?: number;
      free_daily?: boolean;
    }
  | { type: 'thinking'; text: string; replace?: boolean }
  | { type: 'token'; text?: string; code?: string; params?: Record<string, string> }
  | { type: 'chat_done' }
  | { type: 'session_control'; action: 'clear_context' | 'stop' | string }
  | {
      type: 'skill_start';
      index: number;
      skill_id: number;
      skill_name: string;
      skill_key?: string;
      category?: string;
      model?: string;
      model_reason?: string;
    }
  | {
      /** Live execute progress (chars received) while model streams tool JSON. */
      type: 'skill_progress';
      index: number;
      skill_id?: number;
      skill_name?: string;
      chars?: number;
    }
  | {
      type: 'skill_done';
      index: number;
      skill_id: number;
      skill_name: string;
      tokens?: number;
      /** Full SVG after this skill — kept for paint / fallback. */
      preview_svg?: string;
      /** Layer-level create/update/delete vs previous emitted SVG. */
      svg_patch?: DesignSvgPatch;
      /** User-facing intent analysis from req_parse / plan skill. */
      analysis?: string;
      tool_ops?: Array<{ name: string; args?: Record<string, unknown> }>;
    }
  | {
      /** Model intent / requirements analysis (from plan skill JSON). */
      type: 'analysis';
      text: string;
      skill_id?: number;
      skill_name?: string;
    }
  | {
      /** Streaming analysis tokens (plan / req_parse). */
      type: 'analysis_delta';
      text: string;
      skill_id?: number;
      skill_name?: string;
      /** user | developer | internal — FE drops non-user by default. */
      visibility?: 'user' | 'developer' | 'internal';
    }
  | {
      /** Backend-authored progress (element counts etc.). FE displays, does not invent. */
      type: 'activity';
      id?: string;
      kind?: 'thought' | 'added' | 'updated' | 'explored' | 'skipped' | 'tool';
      status?: 'running' | 'done' | 'error';
      count?: number;
      detail?: string;
      skillName?: string;
      skill_name?: string;
      durationSec?: number;
      index?: number;
      stage?: string;
      /** Stable kernel code for FE i18n (e.g. ops_validate_failed). */
      code?: string;
      /** Nested Explored line. */
      item?: { id?: string; name?: string; summary?: string };
      items?: Array<{ id?: string; name?: string; summary?: string }>;
      /** Markdown body for expandable Explored (diagrams / notes). */
      body?: string;
      visibility?: 'user' | 'developer' | 'internal';
    }
  | {
      /** Structured design quality gate (Brand / A11y / Copyright / …). */
      type: 'design_governance';
      status?: string;
      skipped?: boolean;
      lanes?: Array<{
        lane?: string;
        status?: string;
        message?: string;
      }>;
      explain?: string[];
      summary?: string;
      visibility?: 'user' | 'developer' | 'internal';
    }
  | {
      /** Dedicated incremental SVG push (optional; skill_done.preview_svg also works). */
      type: 'svg_delta';
      svg: string;
      index?: number;
      skill_name?: string;
      svg_patch?: DesignSvgPatch;
      /** Durable Worker outbox sequence; ACK only after SVG is applied. */
      command_seq?: number;
    }
  | {
      type: 'decision';
      trace_id?: string;
      route?: string;
      fast_path?: boolean;
      intent?: string;
      edit_in_place?: boolean;
      blank_artboard?: boolean;
      focus_frame_id?: string;
      memory_injected?: boolean;
      memory_blocks_chars?: number;
      has_target_chip?: boolean;
      has_scene_nodes?: boolean;
      [key: string]: unknown;
    }
  | {
      type: 'result';
      task_id: string;
      trace_id?: string;
      status: string;
      svg: string;
      charged_credits?: number;
      total_tokens?: number;
      actual_models?: unknown[];
      summary?: string;
      proposed_ops?: Array<{
        name?: string;
        args?: Record<string, unknown>;
        op_id?: string;
      }>;
      /** Ask interaction format: confirm | single | multi | buttons | text. */
      choice_ui?: {
        mode?: string;
        options?: Array<{ label?: string; action?: string }>;
        placeholder?: string;
        hint?: string;
      };
      scene?: string;
      canvas_width?: number;
      canvas_height?: number;
      canvas_size?: string;
      svg_patch?: DesignSvgPatch;
      tool_ops_applied?: boolean;
      blank_artboard?: boolean;
      intent?: string;
      decision_log?: Record<string, unknown>;
      proposal_id?: string;
    }
  | {
      type: 'tool_ops';
      ops: Array<{ name: string; args?: Record<string, unknown>; op_id?: string }>;
      schema_version?: string;
      index?: number;
      skill_id?: number;
      skill_name?: string;
      /** True when ops are pushed mid-stream (边想边画). */
      stream?: boolean;
      agent_round?: number;
      /** Design Engine V3 — groups chunks into one undo / ACK unit. */
      transaction_id?: string;
      transaction_phase?: string;
      chunk_index?: number;
      chunk_total?: number;
      /** Durable Worker outbox sequence; ACK only after successful canvas apply. */
      command_seq?: number;
    }
  | {
      type: 'transaction.begin';
      transaction_id: string;
      turn_id?: string;
      design_id?: string;
      phase?: string;
      intent?: string;
      base_revision?: number;
      ops_count?: number;
      task_id?: string;
      round?: number;
    }
  | {
      type: 'transaction.chunk';
      transaction_id: string;
      phase?: string;
      chunk_index?: number;
      chunk_total?: number;
      /** Metadata only — apply via companion `tool_ops` (do not double-apply). */
      ops?: Array<{ name: string; args?: Record<string, unknown>; op_id?: string }>;
      task_id?: string;
      round?: number;
    }
  | {
      type: 'transaction.commit';
      transaction_id: string;
      phase?: string;
      ops_count?: number;
      await_ack?: boolean;
      task_id?: string;
      round?: number;
    }
  | {
      type: 'transaction.rollback';
      transaction_id: string;
      phase?: string;
      reason?: string;
      task_id?: string;
      round?: number;
    }
  | {
      type: 'scene_feedback_request';
      task_id?: string;
      round?: number;
      rounds?: number;
      wait_ms?: number;
      timeout_ms?: number;
      transaction_id?: string;
    }
  | { type: 'critique_start'; round: number; reason?: string }
  | {
      type: 'critique_done';
      round: number;
      ok: boolean;
      reason?: string;
      source?: string;
      issues?: string[];
      strengths?: string[];
      weaknesses?: string[];
      market_gap?: string;
      scores?: Record<string, number>;
      lanes?: Array<{
        lane?: string;
        score?: number | null;
        evidence?: string[];
        hits?: string[];
      }>;
      overall?: number | null;
      total?: number | null;
      top_issues?: Array<{
        priority?: number;
        issue?: string;
        evidence?: string[];
        fix?: string;
        lane?: string;
      }>;
      visual_diff?: {
        deltas?: Record<string, number>;
        visual_change?: Record<string, number | null>;
        pixel_available?: boolean;
      } | null;
      pareto?: Record<string, number | null> | null;
      pareto_note?: string | null;
      review_action?: string;
    }
  | {
      type: 'reference_intel';
      composition?: string;
      thesis?: string;
      visual_dna?: Record<string, number>;
      stages?: string[];
    }
  | {
      type: 'optimization';
      decision?: string;
      reason?: string;
      strategy?: string;
      iteration?: number;
      restore_index?: number | null;
      targets?: string[];
      pareto?: Record<string, number | null> | null;
      pareto_note?: string | null;
    }
  | {
      type: 'design_summary';
      iterations?: number;
      removed?: number;
      score_from?: number | null;
      score_to?: number | null;
      whitespace?: number | null;
      hero_dominance?: number | null;
      timeline?: Array<{ iteration?: number; overall?: number }>;
      thesis?: string;
      why?: string;
      purpose?: string;
      audience?: string;
      emotion?: string;
      strengths?: string[];
      weaknesses?: string[];
      next_steps?: string[];
      market_gap?: string;
      source?: string;
      visibility?: 'user' | 'developer' | 'internal';
    }
  | {
      type: 'memory_patch';
      medium: Record<string, unknown>;
      long_suggestions?: Array<{ kind: string; text: string }>;
    }
  | { type: 'replan'; action: string; skipped?: string[]; reason?: string }
  | { type: 'subgoals'; goals: string[] }
  | {
      type: 'error';
      code: string;
      message?: string;
      task_id?: string;
      refunded_credits?: number;
      resumable?: boolean;
    }
  | {
      type: 'paused';
      task_id?: string;
      trace_id?: string;
      resumable?: boolean;
      interrupt_kind?: string;
      message?: string;
      resume_token?: string;
    }
  | {
      type: 'cancelled';
      task_id?: string;
      trace_id?: string;
      refunded_credits?: number;
    };

/** Known wire `type` values — boundary check before casting to DesignJobEvent. */
const DESIGN_JOB_EVENT_TYPES = [
  'status',
  'permission',
  'thinking',
  'token',
  'chat_done',
  'skill_start',
  'skill_progress',
  'skill_done',
  'analysis',
  'analysis_delta',
  'activity',
  'design_governance',
  'svg_delta',
  'decision',
  'result',
  'tool_ops',
  'transaction.begin',
  'transaction.chunk',
  'transaction.commit',
  'transaction.rollback',
  'scene_feedback_request',
  'critique_start',
  'critique_done',
  'reference_intel',
  'optimization',
  'design_summary',
  'memory_patch',
  'replan',
  'subgoals',
  'error',
  'paused',
  'cancelled',
] as const;

const designJobEventSchema = z
  .object({
    type: z.enum(DESIGN_JOB_EVENT_TYPES),
  })
  .passthrough();

/** Parse one SSE JSON payload; null when malformed or unknown `type`. */
export function parseDesignJobEvent(raw: unknown): DesignJobEvent | null {
  const parsed = designJobEventSchema.safeParse(raw);
  if (!parsed.success) return null;
  return parsed.data as DesignJobEvent;
}

export type DesignRunStatus = {
  task_id: string;
  status: string;
  resumable: boolean;
  hold_credits?: number;
  charged_credits?: number;
  error_message?: string | null;
  thread_id?: string;
  interrupt_kind?: string | null;
  checkpoint_at?: number | null;
  resume_token?: string | null;
  updated_at?: number;
};

export type RunDesignJobBody = {
  run_mode: DesignRunMode;
  prompt: string;
  /** agent = auto paint; ask = propose / clarify first (same LangGraph). */
  interaction_mode?: 'agent' | 'ask';
  /** ops = default tool_ops graph; img_layers = generate board then split layers. */
  paint_mode?: 'ops' | 'img_layers';
  scene?: DesignScene | null;
  style_group_id?: number;
  user_selected_model?: string;
  route_overrides?: Record<string, string>;
  canvas_id?: string;
  canvas_size?: string;
  ref_image_sizes?: string[];
  target_layer_id?: string;
  layer_ids?: string[];
  current_svg?: string;
  scene_nodes?: Array<Record<string, unknown>>;
  scene_frames?: Array<Record<string, unknown>>;
  spatial_summary?: Record<string, unknown>;
  focus_frame_id?: string;
  images?: string[];
  session_id?: string;
  project_id?: string;
  memory?: {
    medium: Record<string, unknown>;
    short?: Array<{ role: string; text: string }>;
    retrieve_long?: boolean;
  };
  /** Ask confirm: apply previously proposed tool_ops without a new LLM plan. */
  apply_ops?: Array<{ name?: string; args?: Record<string, unknown>; op_id?: string }>;
  /** Bind confirm to design_task.meta.ask_proposal. */
  proposal_id?: string;
  proposal_task_id?: string;
  /** User-pinned skills from `/` chips (skill keys or ids). */
  skill_refs?: string[];
  /** UI locale — drives agent output language. */
  locale?: string;
  /** Design pipeline depth: light | medium | high | extreme. */
  design_intensity?: string;
};

export type DesignSkillCard = {
  id: number;
  skillKey?: string | null;
  qualifiedKey?: string | null;
  name: string;
  description?: string;
  whenToUse?: string;
  logo?: string | null;
  namespace?: string;
  source?: string;
  ownerUserId?: string | null;
  category?: string;
  mine?: boolean;
  enabled?: boolean;
  promptPositive?: string;
  promptNegative?: string;
  triggers?: Array<Record<string, unknown> | string>;
};

export type DesignSkillsPickerResult = { items?: DesignSkillCard[] };

export function invalidateDesignCatalogCache() {
  void queryClient.invalidateQueries({ queryKey: apiQuery.designDesignCatalog.key() });
}

/** GET /design/catalog — shared Query cache (AgentDock / Models / warm). */
export async function fetchDesignCatalog(opts?: { force?: boolean }): Promise<DesignCatalog> {
  if (opts?.force) {
    return queryClient.fetchQuery({
      ...apiQuery.designDesignCatalog.queryOptions(),
      staleTime: 0,
    }) as Promise<DesignCatalog>;
  }
  return queryClient.ensureQueryData({
    ...apiQuery.designDesignCatalog.queryOptions(),
    staleTime: 60_000,
  }) as Promise<DesignCatalog>;
}

/** GET /design/skills/picker — shared Query cache. */
export async function fetchDesignSkillsPicker(opts?: {
  force?: boolean;
}): Promise<DesignSkillsPickerResult> {
  const input = { query: {} };
  if (opts?.force) {
    return queryClient.fetchQuery({
      ...apiQuery.designDesignSkillsPicker.queryOptions({ input }),
      staleTime: 0,
    }) as Promise<DesignSkillsPickerResult>;
  }
  return queryClient.ensureQueryData({
    ...apiQuery.designDesignSkillsPicker.queryOptions({ input }),
    staleTime: 60_000,
  }) as Promise<DesignSkillsPickerResult>;
}

export type SseHandlers = {
  onmessage?: (ev: { event: string; data: string }) => void;
  onerror?: (err: Error) => void;
  onopen?: (response: Response) => Promise<void>;
  onclose?: () => void;
  signal?: AbortSignal;
};

/** POST /design/run SSE — callers parse `ev.data` as DesignJobEvent. */
export const runDesignJob = (body: RunDesignJobBody, config: SseHandlers = {}) =>
  sse({
    url: '/api/v1/design/run',
    method: 'POST',
    body,
    signal: config.signal,
    onopen: config.onopen,
    onmessage: config.onmessage,
    onerror: config.onerror,
    onclose: config.onclose,
  });

/** GET /design/run/{taskId} — pause/resume status. */
export const fetchDesignRunStatus = (taskId: string, signal?: AbortSignal) =>
  apiClient.designDesignRunStatus(
    { params: { task_id: taskId } },
    { signal: abortAfter(15_000, signal) }
  ) as Promise<DesignRunStatus>;

export type DesignRunReplayEvent = {
  seq: number;
  at: number;
  event: DesignJobEvent;
};

export type DesignRunEvents = {
  items: DesignRunReplayEvent[];
  next_seq: number;
};

export type DesignCanvasCommand = {
  seq: number;
  at: number;
  event: Extract<DesignJobEvent, { type: 'tool_ops' | 'svg_delta' }>;
};

export type DesignCanvasCommands = { items: DesignCanvasCommand[]; next_seq: number; acked_seq: number };

/** Read the safe task timeline after an SSE reconnect. Canvas mutations are never replayed here. */
export const fetchDesignRunEvents = (
  taskId: string,
  afterSeq = 0,
  signal?: AbortSignal
) =>
  request<DesignRunEvents>({
    url: `/api/v1/design/run/${encodeURIComponent(taskId)}/events?after_seq=${Math.max(0, afterSeq)}&limit=96`,
    signal: abortAfter(15_000, signal),
    skipInflightDedupe: true,
  });

/** Read commands for an active worker subscription. Do not replay after a page reload. */
export const fetchDesignCanvasCommands = (taskId: string, afterSeq = 0, signal?: AbortSignal) =>
  request<DesignCanvasCommands>({
    url: `/api/v1/design/run/${encodeURIComponent(taskId)}/commands?after_seq=${Math.max(0, afterSeq)}`,
    signal: abortAfter(15_000, signal),
    skipInflightDedupe: true,
  });

export const acknowledgeDesignCanvasCommands = (taskId: string, seq: number, signal?: AbortSignal) =>
  request<{ ok: boolean; seq: number }>({
    url: `/api/v1/design/run/${encodeURIComponent(taskId)}/commands/ack`,
    method: 'POST',
    data: { seq: Math.max(0, seq) },
    signal: abortAfter(15_000, signal),
  });

/** POST /design/run/{taskId}/pause — keep LangGraph checkpoint. */
export const pauseDesignRun = (taskId: string, signal?: AbortSignal) =>
  apiClient.designDesignRunPause(
    { params: { task_id: taskId } },
    { signal: abortAfter(15_000, signal) }
  ) as Promise<{ ok?: boolean; status?: string; error?: string; already?: boolean }>;

/** POST /design/run/{taskId}/resume SSE — continue from checkpoint. */
export const resumeDesignJob = (
  taskId: string,
  body: { resume_token?: string | null } = {},
  config: SseHandlers = {}
) =>
  sse({
    url: `/api/v1/design/run/${encodeURIComponent(taskId)}/resume`,
    method: 'POST',
    body,
    signal: config.signal,
    onopen: config.onopen,
    onmessage: config.onmessage,
    onerror: config.onerror,
    onclose: config.onclose,
  });

/** After tool_ops paint: push real canvas inventory for the next agent round. */
export const postDesignSceneFeedback = (
  taskId: string,
  data: {
    scene_nodes: Array<Record<string, unknown>>;
    scene_frames?: Array<Record<string, unknown>>;
    spatial_summary?: Record<string, unknown>;
    op_results?: Array<{ op_id: string; name: string; ok: boolean; error?: string }>;
    /** JPEG/PNG data URL of focus artboard for CLIP critique. */
    preview_image?: string;
    round?: number;
    /** Design Engine V3 — ACK / rollback for DesignTransaction. */
    transaction_id?: string;
    transaction_status?: 'ack' | 'rollback';
    base_revision?: number;
  },
  signal?: AbortSignal
) =>
  apiClient.designDesignRunSceneFeedback(
    { params: { task_id: taskId }, body: data as never },
    { signal: abortAfter(30_000, signal) }
  ) as Promise<{ ok?: boolean; count?: number; frames?: number }>;

export type GenerateLottieInput = {
  prompt: string;
  width?: number;
  height?: number;
  duration_sec?: number;
  model?: string;
  /** Reference images (data URL / https) — requires a vision-capable model. */
  images?: string[];
};

export type GenerateLottieResult = {
  animationData: Record<string, unknown>;
  w?: number;
  h?: number;
};

/** POST /design/lottie/generate — Bodymovin JSON for the on-canvas Lottie plate. */
export const generateLottie = (
  data: GenerateLottieInput,
  opts?: { signal?: AbortSignal }
) =>
  apiClient.designDesignLottieGenerate(
    { body: data as never },
    { signal: abortAfter(90_000, opts?.signal) }
  ) as Promise<GenerateLottieResult>;

export type DesignSkillImportExisting = {
  id: number;
  name: string;
  skillKey?: string | null;
  packVersion?: string | null;
  updatedAt?: number | null;
  useCount?: number;
  mine?: boolean;
};

export type DesignSkillImportResult = {
  status: 'ok' | 'exists' | 'rejected';
  fileName?: string;
  scan?: {
    ok?: boolean;
    checks?: Array<{ id?: string; ok?: boolean; label?: string; detail?: string }>;
    errors?: string[];
  };
  item?: DesignSkillCard | null;
  existing?: DesignSkillImportExisting | null;
};

/** Upload a skill / plugin pack (``.zip`` or ``.recombyn-plugin``). */
export const importDesignSkillZip = (file: File, opts?: { overwrite?: boolean }) => {
  const data = new FormData();
  data.append('file', file);
  data.append('overwrite', opts?.overwrite ? 'true' : 'false');
  return request<DesignSkillImportResult>({
    url: '/api/v1/design/skills/import',
    method: 'post',
    data,
    timeout: 120000,
  });
};

/** Install a branded ``.recombyn-plugin`` (skill → user DB; canvas → disk when enabled). */
export const installRecombynPlugin = (file: File, opts?: { overwrite?: boolean }) => {
  const data = new FormData();
  data.append('file', file);
  data.append('overwrite', opts?.overwrite ? 'true' : 'false');
  return request<DesignSkillImportResult>({
    url: '/api/v1/design/plugins/install',
    method: 'post',
    data,
    timeout: 120000,
  });
};
