import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import {
  CANVAS_BULK_OP_LOADING_AT,
  canvasBulkItemCount,
  runCanvasBulkOp,
} from '../canvasBulkOpLoading';

vi.mock('@/components/base', () => {
  const hide = vi.fn();
  return {
    message: {
      loading: vi.fn(() => hide),
    },
  };
});

import { message } from '@/components/base';

describe('canvasBulkOpLoading', () => {
  beforeEach(() => {
    vi.mocked(message.loading).mockClear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('counts nodes + frames', () => {
    expect(canvasBulkItemCount(2, 1)).toBe(3);
    expect(CANVAS_BULK_OP_LOADING_AT).toBeGreaterThan(2);
  });

  it('runs small ops immediately without loading toast', () => {
    const run = vi.fn();
    runCanvasBulkOp({ count: 2, label: 'copying', run });
    expect(run).toHaveBeenCalledTimes(1);
    expect(message.loading).not.toHaveBeenCalled();
  });

  it('defers large ops behind loading toast', async () => {
    vi.stubGlobal(
      'requestAnimationFrame',
      (cb: FrameRequestCallback) => {
        cb(0);
        return 1;
      }
    );
    const run = vi.fn();
    const hide = vi.fn();
    vi.mocked(message.loading).mockReturnValue(hide);
    runCanvasBulkOp({ count: CANVAS_BULK_OP_LOADING_AT, label: 'deleting', run });
    expect(message.loading).toHaveBeenCalledWith('deleting', 0);
    expect(run).toHaveBeenCalledTimes(1);
    expect(hide).toHaveBeenCalledTimes(1);
  });
});
