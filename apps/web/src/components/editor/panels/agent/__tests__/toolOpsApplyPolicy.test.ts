import { describe, expect, it } from 'vitest';
import {
  TOOL_OPS_INTER_OP_DELAY_MS,
  resolveToolOpsInterOpDelayMs,
} from '../toolOpsApplyPolicy';

describe('toolOpsApplyPolicy', () => {
  it('defaults to visible stagger for normal batches', () => {
    expect(resolveToolOpsInterOpDelayMs({ opCount: 6 })).toBe(TOOL_OPS_INTER_OP_DELAY_MS);
  });

  it('uses faster delay for very large batches', () => {
    expect(resolveToolOpsInterOpDelayMs({ opCount: 30 })).toBe(24);
  });

  it('honors explicit override', () => {
    expect(resolveToolOpsInterOpDelayMs({ overrideMs: 0 })).toBe(0);
  });
});
