/**
 * Localize agent process-column copy (activity nest rows / skipped details).
 * Kernel still emits English summaries for logs; FE maps code + known English → i18n.
 */

type TFn = (key: string, opts?: Record<string, unknown>) => string;

/** activity.code → i18n key */
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

/** token/result tip codes → same keys as designAgentEventRouter */
const TIP_CODE_I18N: Record<string, string> = {
  decide_failed: 'agent.uxTipDecideFailed',
  paint_failed: 'agent.uxTipPaintFailed',
  observe_ops_failed: 'agent.uxTipObserveOpsFailed',
  apply_confirm_failed: 'agent.uxTipApplyConfirmFailed',
  observe_scene_timeout: 'agent.uxTipObserveSceneTimeout',
  observe_critique_failed: 'agent.uxTipObserveCritiqueFailed',
  review_must_fix: 'agent.uxTipReviewMustFix',
  apply_ops_applied: 'agent.uxTipApplyOpsApplied',
  ask_dismissed: 'agent.uxTipAskDismissed',
};

/** Exact English fallbacks from API `_UX_TIP_FALLBACK` (no params). */
const ENGLISH_TIP_EXACT: Record<string, string> = {
  'Decision failed. Please try again.': 'agent.uxTipDecideFailed',
  'Could not produce valid canvas ops. Please describe a more specific edit.':
    'agent.uxTipPaintFailed',
  'Cancelled.': 'agent.uxTipAskDismissed',
  'Something went wrong. Please retry.': 'agent.requestFailed',
  'Canvas changes could not be confirmed.': 'agent.uxTipObserveSceneTimeout',
};

function tryTipWithParams(t: TFn, raw: string): string | null {
  const observeOps = raw.match(
    /^Some ops failed to apply \(([^)]+)\):\s*(.+?)(?:\.\s*Retry.*)?$/i
  );
  if (observeOps) {
    return t('agent.uxTipObserveOpsFailed', {
      count: observeOps[1],
      notes: observeOps[2].trim(),
    });
  }
  const applyConfirm = raw.match(
    /^Confirmed plan could not be applied safely \((.+)\)\.\s*Rephrase or retry\.?$/i
  );
  if (applyConfirm) {
    return t('agent.uxTipApplyConfirmFailed', { error: applyConfirm[1].trim() });
  }
  const critique = raw.match(/^Canvas structure check failed:\s*(.+)$/i);
  if (critique) {
    return t('agent.uxTipObserveCritiqueFailed', { issues: critique[1].trim() });
  }
  const review = raw.match(/^Review did not pass:\s*(.+)$/i);
  if (review) {
    return t('agent.uxTipReviewMustFix', { issues: review[1].trim() });
  }
  const applied = raw.match(/^Applied\s+(\d+)\s+canvas change\(s\)\.?$/i);
  if (applied) {
    return t('agent.uxTipApplyOpsApplied', { count: applied[1] });
  }
  const timedOut = /^Canvas feedback timed out/i.test(raw);
  if (timedOut) return t('agent.uxTipObserveSceneTimeout');
  return null;
}

function tryKernelEnglish(t: TFn, raw: string): string | null {
  if (/^REFERENCE_INTEL:\s*skipped/i.test(raw)) {
    return t('agent.activityRefIntelSkipped');
  }
  if (/^REFERENCE_INTEL:\s*analyzing/i.test(raw) || /^REFERENCE_INTEL:/i.test(raw)) {
    return t('agent.activityRefIntelRunning');
  }
  if (/^REFERENCE_DNA:/i.test(raw)) {
    return t('agent.activityRefIntelDone');
  }
  const skipped = raw.match(/^DESIGN_([A-Z_]+):\s*skipped/i);
  if (skipped) {
    return t('agent.activityKernelSkipped', { name: skipped[1].replace(/_/g, ' ') });
  }
  const running = raw.match(/^DESIGN_([A-Z_]+):/i);
  if (running) {
    return t('agent.activityKernelWorking', { name: running[1].replace(/_/g, ' ') });
  }
  if (/^vision unavailable/i.test(raw)) return t('agent.activityVisionFallback');
  if (/^governance skipped/i.test(raw)) return t('agent.activityGovernanceSkipped');
  if (/^governance fail/i.test(raw)) return t('agent.governanceFailShort');
  if (/^review unavailable/i.test(raw) || /^lanes unavailable/i.test(raw)) {
    return t('agent.activityReviewFallback');
  }
  return null;
}

/**
 * Return localized process-column text. Unrecognized strings (e.g. `+rect`) pass through.
 */
export function localizeAgentProcessCopy(
  t: TFn,
  text: string | null | undefined,
  code?: string | null
): string {
  const raw = String(text || '').trim();
  const codeKey = String(code || '').trim().toLowerCase();

  if (codeKey) {
    const tipKey = TIP_CODE_I18N[codeKey];
    if (tipKey) {
      try {
        return String(t(tipKey));
      } catch {
        /* fall through */
      }
    }
    const actKey = ACTIVITY_CODE_I18N[codeKey];
    if (actKey) {
      try {
        return String(t(actKey));
      } catch {
        /* fall through */
      }
    }
  }

  if (!raw) return '';

  const exact = ENGLISH_TIP_EXACT[raw];
  if (exact) {
    try {
      return String(t(exact));
    } catch {
      return raw;
    }
  }

  const fromParams = tryTipWithParams(t, raw);
  if (fromParams) return fromParams;

  const fromKernel = tryKernelEnglish(t, raw);
  if (fromKernel) return fromKernel;

  return raw;
}

/** True when copy looks like kernel English that should not be shown raw. */
export function looksLikeKernelProcessDump(text: string | null | undefined): boolean {
  const s = String(text || '').trim();
  if (!s) return false;
  if (/^(REFERENCE_INTEL|DESIGN_[A-Z_]+):/i.test(s)) return true;
  if (ENGLISH_TIP_EXACT[s]) return true;
  if (/^(Decision failed|Could not produce valid canvas|Canvas (structure|feedback|changes)|Some ops failed|Review did not pass|Confirmed plan could not|Something went wrong|vision unavailable|governance |lanes unavailable|review unavailable)/i.test(s)) {
    return true;
  }
  return false;
}
