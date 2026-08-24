import { describe, expect, it, vi, afterEach } from 'vitest';
import {
  isStaleProcessJob,
  processJobAttrPatch,
  readProcessJobIds,
  readProcessStartedAt,
  PROCESS_JOB_STALE_MS,
} from '../processJobAttrs';

describe('processJobAttrs', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('reads job ids from JSON attr', () => {
    expect(
      readProcessJobIds({
        id: 'n1',
        key: 'image',
        attrs: { processJobIds: '["job-a","job-b"]' },
      } as any)
    ).toEqual(['job-a', 'job-b']);
  });

  it('returns empty list for invalid JSON', () => {
    expect(
      readProcessJobIds({
        id: 'n1',
        key: 'image',
        attrs: { processJobIds: 'not-json' },
      } as any)
    ).toEqual([]);
  });

  it('builds patch with stringified ids and timestamp', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-24T08:00:00.000Z'));
    expect(processJobAttrPatch(['j1'])).toEqual({
      processJobIds: '["j1"]',
      processStartedAt: String(Date.now()),
    });
  });

  it('treats missing start time as stale', () => {
    expect(
      isStaleProcessJob({
        id: 'n1',
        key: 'image',
        attrs: { processJobIds: '["j1"]' },
      } as any)
    ).toBe(true);
  });

  it('treats old jobs as stale', () => {
    vi.useFakeTimers();
    const started = Date.now();
    vi.setSystemTime(started + PROCESS_JOB_STALE_MS + 1);
    expect(
      isStaleProcessJob({
        id: 'n1',
        key: 'image',
        attrs: { processStartedAt: String(started), processJobIds: '["j1"]' },
      } as any)
    ).toBe(true);
    expect(readProcessStartedAt({ attrs: { processStartedAt: String(started) } } as any)).toBe(
      started
    );
  });
});
