import { describe, expect, it } from 'vitest';
import { extractToolOpsFromText, setAllowedCanvasToolKeys } from '../toolOpsContract';

describe('extractToolOpsFromText', () => {
  it('parses fenced tool_ops JSON', () => {
    setAllowedCanvasToolKeys([]);
    const text = [
      'Sure, here is a plate.',
      '```json',
      JSON.stringify({
        tool_ops: [
          {
            name: 'create_shape',
            args: { shapeType: 'rect', x: 10, y: 20, width: 100, height: 40 },
          },
        ],
      }),
      '```',
    ].join('\n');
    const ops = extractToolOpsFromText(text);
    expect(ops).toHaveLength(1);
    expect(ops[0]?.name).toBe('create_shape');
    expect(ops[0]?.args.shapeType).toBe('rect');
  });

  it('ignores disallowed tools when catalog is loaded', () => {
    setAllowedCanvasToolKeys(['create_text']);
    const text = '```json\n{"tool_ops":[{"name":"delete_nodes","args":{"nodeIds":["n1"]}}]}\n```';
    expect(extractToolOpsFromText(text)).toEqual([]);
  });
});
