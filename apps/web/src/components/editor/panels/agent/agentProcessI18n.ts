/**
 * Localize agent process-column copy.
 * Backend-owned tips/errors are shown as-is; code-only activity labels use FE i18n.
 */

type TFn = (key: string, opts?: Record<string, unknown>) => string;

/** activity.code → i18n key (structural UI only — no user-facing error copy). */
const ACTIVITY_CODE_I18N: Record<string, string> = {
  reference_intel_running: 'agent.activityRefIntelRunning',
  reference_intel_skipped: 'agent.activityRefIntelSkipped',
  reference_intel_done: 'agent.activityRefIntelDone',
  design_research_running: 'agent.activityKernelWorking',
  design_research_skipped: 'agent.activityKernelSkipped',
  design_strategy_running: 'agent.activityKernelWorking',
  design_strategy_skipped: 'agent.activityKernelSkipped',
  design_candidates_running: 'agent.activityKernelWorking',
  design_candidates_skipped: 'agent.activityKernelSkipped',
  design_tournament_running: 'agent.activityKernelWorking',
  design_tournament_skipped: 'agent.activityKernelSkipped',
  design_swarm_running: 'agent.activityKernelWorking',
  design_swarm_skipped: 'agent.activityKernelSkipped',
  design_simulation_running: 'agent.activityKernelWorking',
  design_simulation_skipped: 'agent.activityKernelSkipped',
  design_counterfactual_running: 'agent.activityKernelWorking',
  design_counterfactual_skipped: 'agent.activityKernelSkipped',
  vision_unavailable: 'agent.activityVisionFallback',
  governance_skipped: 'agent.activityGovernanceSkipped',
  governance_fail: 'agent.governanceFailShort',
  review_unavailable: 'agent.activityReviewFallback',
};

/**
 * Return process-column text. Prefer backend ``text``; use FE i18n only for
 * code-only activity labels (no display string from API).
 */
export function localizeAgentProcessCopy(
  t: TFn,
  text: string | null | undefined,
  code?: string | null
): string {
  const raw = String(text || '').trim();
  if (raw) return raw;

  const codeKey = String(code || '').trim().toLowerCase();
  if (codeKey) {
    const actKey = ACTIVITY_CODE_I18N[codeKey];
    if (actKey) {
      try {
        return String(t(actKey));
      } catch {
        /* fall through */
      }
    }
  }

  return '';
}

/** True when copy looks like an untranslated kernel dump (legacy payloads). */
export function looksLikeKernelProcessDump(text: string | null | undefined): boolean {
  const s = String(text || '').trim();
  if (!s) return false;
  return /^(REFERENCE_INTEL|DESIGN_[A-Z_]+):/i.test(s);
}
