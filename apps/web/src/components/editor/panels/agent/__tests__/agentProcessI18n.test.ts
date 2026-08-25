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
  'agent.uxTipDecideFailed': '决策失败，请重试一次。',
  'agent.uxTipPaintFailed': '未能生成有效画布操作',
  'agent.uxTipObserveOpsFailed': '部分操作未能应用（{{count}}）：{{notes}}',
  'agent.uxTipObserveCritiqueFailed': '画布结构校验未通过：{{issues}}',
  'agent.requestFailed': '请求失败',
  'agent.activityVisionFallback': '视觉回退',
};

function t(key: string, opts?: Record<string, unknown>) {
  let s = messages[key] || key;
  for (const [k, v] of Object.entries(opts || {})) {
    s = s.replace(new RegExp(`\\{\\{${k}\\}\\}`, 'g'), String(v));
  }
  return s;
}

describe('localizeAgentProcessCopy', () => {
  it('maps reference intel English + codes', () => {
    expect(
      localizeAgentProcessCopy(t, 'REFERENCE_INTEL: skipped (analyze failed)')
    ).toBe('参考图分析未完成，已跳过');
    expect(localizeAgentProcessCopy(t, '', 'reference_intel_running')).toBe(
      '正在分析参考图…'
    );
    expect(localizeAgentProcessCopy(t, 'REFERENCE_DNA: poster')).toBe(
      '参考图分析完成'
    );
  });

  it('maps decide tip English used in process column', () => {
    expect(
      localizeAgentProcessCopy(t, 'Decision failed. Please try again.')
    ).toBe('决策失败，请重试一次。');
    expect(localizeAgentProcessCopy(t, 'x', 'decide_failed')).toBe(
      '决策失败，请重试一次。'
    );
  });

  it('maps DESIGN_* kernel dumps', () => {
    expect(
      localizeAgentProcessCopy(t, 'DESIGN_STRATEGY: skipped (failed)')
    ).toBe('STRATEGY 未完成，已跳过');
    expect(
      localizeAgentProcessCopy(t, 'DESIGN_SWARM: Art Director → leads')
    ).toBe('正在运行 SWARM…');
  });

  it('passes through paint activity detail', () => {
    expect(localizeAgentProcessCopy(t, '+rect (#E0E0E0)')).toBe('+rect (#E0E0E0)');
  });

  it('maps parameterized tip English', () => {
    expect(
      localizeAgentProcessCopy(
        t,
        'Some ops failed to apply (2): missing receipts. Retry on a specific element.'
      )
    ).toBe('部分操作未能应用（2）：missing receipts');
    expect(
      localizeAgentProcessCopy(t, 'Canvas structure check failed: bad size')
    ).toBe('画布结构校验未通过：bad size');
  });
});

describe('looksLikeKernelProcessDump', () => {
  it('detects kernel English', () => {
    expect(looksLikeKernelProcessDump('REFERENCE_INTEL: skipped')).toBe(true);
    expect(looksLikeKernelProcessDump('+rect')).toBe(false);
  });
});
