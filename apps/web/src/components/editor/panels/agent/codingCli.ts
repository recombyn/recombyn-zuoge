/**
 * Desktop coding-CLI bridge — workspace files, spawn/stream, canvas-ops footer.
 * Mutually exclusive with Design Agent (LangGraph). Does not mutate the document itself.
 */
import type {
  AgentEngineMode,
  CodingCliOption,
} from '@/components/editor/panels/agent/dock/AgentDockHeader';
import type { AgentToolOp } from '@/components/editor/panels/agent/toolOpsContract';

const AGENT_ENGINE_MODE_KEY = 'recombyn.agentEngineMode.v1';
const AGENT_CODING_CLI_KEY = 'recombyn.agentCodingCli.v1';

export function readStoredEngineMode(): AgentEngineMode {
  try {
    const raw = String(localStorage.getItem(AGENT_ENGINE_MODE_KEY) || '').trim();
    return raw === 'cli' ? 'cli' : 'agent';
  } catch {
    return 'agent';
  }
}

export function persistEngineMode(mode: AgentEngineMode) {
  try {
    localStorage.setItem(AGENT_ENGINE_MODE_KEY, mode);
  } catch {
    /* ignore */
  }
}

export function readStoredCodingCliId(): string {
  try {
    return String(localStorage.getItem(AGENT_CODING_CLI_KEY) || '').trim();
  } catch {
    return '';
  }
}

export function persistCodingCliId(id: string) {
  try {
    localStorage.setItem(AGENT_CODING_CLI_KEY, id);
  } catch {
    /* ignore */
  }
}

type CodingCliInfoDto = {
  id: string;
  name: string;
  bin: string;
  available: boolean;
  version?: string | null;
};

export async function listCodingClisDesktop(): Promise<CodingCliOption[]> {
  const { invoke } = await import('@tauri-apps/api/core');
  const rows = await invoke<CodingCliInfoDto[]>('list_coding_clis');
  return (rows || []).map((r) => ({
    id: String(r.id || ''),
    name: String(r.name || r.id || ''),
    available: Boolean(r.available),
  }));
}

/**
 * Single source of truth for CLI → canvas output rules.
 * Do not fork per CLI brand — only discovery paths differ (see CODING_CLI_RULE_ALIASES).
 */
const CODING_CLI_OPS_CONTRACT = `# Recombyn canvas tool_ops

You are editing a Recombyn design canvas. Always read \`scene.json\` in this workspace for the current artboards and nodes.

When the user asks for design changes, end your reply with ONE JSON fence that the editor will apply:

\`\`\`json
{ "tool_ops": [ { "name": "create_shape", "args": { "shapeType": "rect", "x": 40, "y": 40, "width": 200, "height": 120, "fill": "#ffffff" } } ] }
\`\`\`

Allowed \`name\` values (subset): create_frame, duplicate_frame, reorder_frames, fit_frame_to_content, lock_frames, hide_frames, clip_frames, create_shape, create_path, create_text, create_image, create_svg, update_node, edit_path_points, append_path_points, simplify_path, smooth_path, close_path, apply_brush_preset, update_frame, hide_nodes, delete_nodes, delete_frame, align_nodes, distribute_nodes, reorder_nodes, duplicate_nodes, rotate_nodes, bind_nodes_to_frame, unbind_nodes, set_canvas_background, set_viewport, set_active_tool, set_grid.

Hard rules:
- Prefer \`update_node\` with existing \`nodeId\` from scene.json over recreating.
- Coordinates for create_* inside an artboard are frame-local unless you also create_frame.
- Do not invent nodeIds that are not in scene.json.
- Keep prose short; the JSON fence is what paints the canvas.
- Do not ask the user to paste these rules — they are already in this workspace.
`;

/**
 * Same contract, different filenames each CLI tends to auto-read.
 * Add a path here when supporting a new CLI — never rewrite the contract.
 */
const CODING_CLI_RULE_ALIASES: Array<{ path: string; wrap: 'md' | 'cursor-mdc' }> = [
  { path: 'CANVAS_OPS.md', wrap: 'md' },
  { path: 'AGENTS.md', wrap: 'md' },
  { path: 'CLAUDE.md', wrap: 'md' },
  { path: '.cursor/rules/recombyn-canvas-ops.mdc', wrap: 'cursor-mdc' },
];

function wrapCodingCliRuleFile(wrap: 'md' | 'cursor-mdc', body: string): string {
  const contract = body.trim();
  if (wrap === 'cursor-mdc') {
    return [
      '---',
      'description: Recombyn canvas tool_ops output contract (auto-injected)',
      'alwaysApply: true',
      '---',
      '',
      contract,
      '',
    ].join('\n');
  }
  return [
    '# Recombyn CLI workspace',
    '',
    'Temporary bridge workspace for Recombyn desktop. Source of truth: `scene.json`.',
    '',
    contract,
    '',
  ].join('\n');
}

export function buildCodingCliWorkspaceFiles(opts: {
  userPrompt: string;
  scene: unknown;
  skillRefs?: string[];
}): Array<{ path: string; content: string }> {
  const skills =
    opts.skillRefs && opts.skillRefs.length
      ? `# Active skill refs\n\n${opts.skillRefs.map((s) => `- ${s}`).join('\n')}\n`
      : '# Active skill refs\n\n(none)\n';
  const ruleFiles = CODING_CLI_RULE_ALIASES.map((alias) => ({
    path: alias.path,
    content: wrapCodingCliRuleFile(alias.wrap, CODING_CLI_OPS_CONTRACT),
  }));
  return [
    ...ruleFiles,
    { path: 'SKILLS.md', content: skills },
    {
      path: 'scene.json',
      content: `${JSON.stringify(opts.scene, null, 2)}\n`,
    },
    { path: 'USER_PROMPT.md', content: `${opts.userPrompt.trim()}\n` },
  ];
}

export function buildCodingCliEnrichedPrompt(opts: {
  userPrompt: string;
  cwd: string;
  skillRefs?: string[];
}): string {
  const skills =
    opts.skillRefs && opts.skillRefs.length
      ? `Skill refs: ${opts.skillRefs.join(', ')}`
      : '';
  const head = [
    "You are Recombyn's local coding CLI bridge for canvas edits.",
    `Working directory: ${opts.cwd}`,
    `Rule files in workspace: ${CODING_CLI_RULE_ALIASES.map((a) => a.path).join(', ')}.`,
    'You already have the output rules below — do not ask the user to provide them.',
    ...(skills ? [skills] : []),
  ].join('\n');
  return [
    head,
    CODING_CLI_OPS_CONTRACT.trim(),
    [
      '---',
      'User request (only this part is from the user):',
      opts.userPrompt.trim(),
      '',
      'When done, emit a final ```json fence with { "tool_ops": [...] } so the editor can paint the canvas.',
    ].join('\n'),
  ].join('\n\n');
}

export async function prepareCodingCliWorkspaceDesktop(opts: {
  projectId: string;
  files: Array<{ path: string; content: string }>;
}): Promise<string> {
  const { invoke } = await import('@tauri-apps/api/core');
  return invoke<string>('prepare_coding_cli_workspace', {
    projectId: opts.projectId,
    files: opts.files,
  });
}

/** Spawn local CLI; stream chunks until done/error. Does not touch LangGraph. */
export async function runCodingCliDesktop(opts: {
  cliId: string;
  prompt: string;
  cwd?: string;
  signal: AbortSignal;
  onChunk: (text: string) => void;
}): Promise<void> {
  const { invoke } = await import('@tauri-apps/api/core');
  const { listen } = await import('@tauri-apps/api/event');
  const unsubs: Array<() => void> = [];
  const cleanup = () => {
    for (const u of unsubs) {
      try {
        u();
      } catch {
        /* ignore */
      }
    }
    unsubs.length = 0;
  };

  await new Promise<void>((resolve, reject) => {
    let settled = false;
    const finish = (fn: () => void) => {
      if (settled) return;
      settled = true;
      opts.signal.removeEventListener('abort', onAbort);
      cleanup();
      fn();
    };
    const onAbort = () => {
      async function killCliOnAbort() {
        try {
          await invoke('kill_coding_cli');
        } catch {
          /* ignore */
        }
      }
      killCliOnAbort();
      finish(() => reject(new DOMException('Aborted', 'AbortError')));
    };

    async function startCodingCliRun() {
      try {
        unsubs.push(
          await listen<{ text?: string }>('coding-cli-chunk', (ev) => {
            opts.onChunk(String(ev.payload?.text || ''));
          })
        );
        unsubs.push(
          await listen('coding-cli-done', () => {
            finish(() => resolve());
          })
        );
        unsubs.push(
          await listen<{ message?: string }>('coding-cli-error', (ev) => {
            finish(() =>
              reject(new Error(String(ev.payload?.message || 'CLI failed')))
            );
          })
        );
        if (opts.signal.aborted) {
          onAbort();
          return;
        }
        opts.signal.addEventListener('abort', onAbort);
        await invoke('run_coding_cli', {
          cliId: opts.cliId,
          prompt: opts.prompt,
          cwd: opts.cwd || null,
        });
      } catch (err) {
        finish(() => reject(err instanceof Error ? err : new Error(String(err))));
      }
    }
    startCodingCliRun();
  });
}

export function codingCliApplyFooter(opts: {
  t: (key: string, vars?: Record<string, unknown>) => string;
  ops: AgentToolOp[];
  applied: { created: number; updated: number; deleted: number };
}): string {
  if (!opts.ops.length) return opts.t('agent.engineCliDoneNoOps');
  const n =
    opts.applied.created + opts.applied.updated + opts.applied.deleted ||
    opts.ops.length;
  return opts.t('agent.engineCliDoneApplied', { count: n });
}
