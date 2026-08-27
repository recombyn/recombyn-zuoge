import { describe, expect, it } from 'vitest';
import {
  localizeAgentProcessCopy,
  looksLikeKernelProcessDump,
} from '@/components/editor/panels/agent/agentProcessI18n';

const messages: Record<string, string> = {
  'agent.activityRefIntelRunning': '正在分析参考图…',
  'agent.activityRefIntelSkipped': '参考图分析未完成，已跳过',
  'agent.activityRefIntelDone': '参考图分析完成',
  'agent.activityKernelWorking': '正在运行 {{name}}…',
  'agent.activityKernelSkipped': '{{name}} 未完成，已跳过',
  'agent.requestFailed': '请求失败',
  'agent.activityVisionFallback': '视觉回退',
  'agent.processRevisionConflict': '画布冲突',
};

function t(key: string, opts?: Record<string, unknown>) {
  let s = messages[key] || key;
  for (const [k, v] of Object.entries(opts || {})) {
    s = s.replace(new RegExp(`\\{\\{${k}\\}\\}`, 'g'), String(v));
  }
  return s;
}

describe('localizeAgentProcessCopy', () => {
  it('shows backend text as-is when present', () => {
    expect(
      localizeAgentProcessCopy(t, 'REFERENCE_INTEL: skipped (analyze failed)')
    ).toBe('REFERENCE_INTEL: skipped (analyze failed)');
    expect(localizeAgentProcessCopy(t, 'Decision failed. Please try again.')).toBe(
      'Decision failed. Please try again.'
    );
    expect(localizeAgentProcessCopy(t, '+rect (#E0E0E0)')).toBe('+rect (#E0E0E0)');
  });

  it('uses FE i18n for client-side process codes', () => {
    expect(localizeAgentProcessCopy(t, '', 'revision_conflict')).toBe(
      '画布冲突'
    );
  });

  it('uses FE i18n only for code-only activity labels', () => {
    expect(localizeAgentProcessCopy(t, '', 'reference_intel_running')).toBe(
      '正在分析参考图…'
    );
    expect(localizeAgentProcessCopy(t, '', 'reference_intel_skipped')).toBe(
      '参考图分析未完成，已跳过'
    );
  });

  it('returns empty string when neither text nor known code is provided', () => {
    expect(localizeAgentProcessCopy(t, '')).toBe('');
    expect(localizeAgentProcessCopy(t, undefined)).toBe('');
    expect(localizeAgentProcessCopy(t, '', 'unknown_code')).toBe('');
  });
});

describe('looksLikeKernelProcessDump', () => {
  it('detects kernel English', () => {
    expect(looksLikeKernelProcessDump('REFERENCE_INTEL: skipped')).toBe(true);
    expect(looksLikeKernelProcessDump('+rect')).toBe(false);
  });
});
