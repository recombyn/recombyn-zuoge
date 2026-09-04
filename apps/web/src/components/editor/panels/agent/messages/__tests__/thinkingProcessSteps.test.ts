import { describe, expect, it } from 'vitest';
import {
  applyThinkingBodyToSteps,
  replyDuplicatesProcessThought,
  type AssistantStep,
} from '../ChatTurnList';

const t = ((key: string) => {
  const map: Record<string, string> = {
    'agent.thinkingTitle': '思考过程',
    'agent.activityExplored': '已确认设计材料',
  };
  return map[key] || key;
}) as unknown as (key: string, opts?: Record<string, unknown>) => string;

describe('applyThinkingBodyToSteps — visible thought row', () => {
  it('creates a dedicated thought step with model body', () => {
    const next = applyThinkingBodyToSteps([], '竖版海报，主视觉居中', true, t);
    expect(next).toHaveLength(1);
    expect(next[0]).toMatchObject({
      id: 'thought-stream',
      kind: 'thought',
      name: '思考过程',
      status: 'done',
      body: '竖版海报，主视觉居中',
    });
  });

  it('uses thinking title while streaming chunks', () => {
    const next = applyThinkingBodyToSteps([], '先…', false, t);
    expect(next[0].name).toBe('思考过程');
    expect(next[0].status).toBe('running');
  });

  it('inserts thought before explored materials row', () => {
    const prior: AssistantStep[] = [
      {
        id: 'explore-pipeline',
        kind: 'explored',
        name: '已确认设计材料',
        status: 'running',
        items: [{ id: 'stage-1', name: '等待模型' }],
      },
    ];
    const next = applyThinkingBodyToSteps(prior, '先定红黑配色', true, t);
    expect(next.map((s) => s.id)).toEqual(['thought-stream', 'explore-pipeline']);
    expect(next[0].body).toBe('先定红黑配色');
    expect(next[1].items?.[0].name).toBe('等待模型');
  });

  it('does not hide thought as a nested thought-brief under explore', () => {
    const next = applyThinkingBodyToSteps([], '思考正文', true, t);
    expect(next[0].items?.some((i) => i.id === 'thought-brief')).toBeFalsy();
    expect(next.some((s) => s.kind === 'explored')).toBe(false);
  });

  it('dedupes black reply that copies the thought body', () => {
    const essay =
      '这是一段足够长的设计思考用于去重检测，竖版海报主视觉居中并留出标题区';
    const steps = applyThinkingBodyToSteps([], essay, true, t);
    expect(replyDuplicatesProcessThought(essay, steps)).toBe(true);
  });
});
