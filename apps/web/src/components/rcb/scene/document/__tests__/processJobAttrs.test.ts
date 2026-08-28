import { describe, expect, it, vi, afterEach } from 'vitest';
import {
  createMonotonicProgress,
  mapServerUploadProgress,
  PROCESS_JOB_STALE_MS,
  UPLOAD_PROCESSING_PCT,
  UPLOAD_QUEUED_PCT,
  UPLOAD_WIRE_MAX,
  wirePctFromBytes,
  formatProcessProgressLabel,
  isStaleProcessJob,
  processJobAttrPatch,
  readProcessJobIds,
  readProcessStartedAt,
  stripProcessProgressLabel,
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

  it('strips trailing progress percent from labels', () => {
    expect(stripProcessProgressLabel('上传中 42%')).toBe('上传中');
    expect(stripProcessProgressLabel('', '上传中')).toBe('上传中');
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

  it('maps wire bytes into 0..WIRE_MAX', () => {
    expect(wirePctFromBytes(0, 1000)).toBe(0);
    expect(wirePctFromBytes(500, 1000)).toBe(Math.round(0.5 * UPLOAD_WIRE_MAX));
    expect(wirePctFromBytes(1000, 1000)).toBe(UPLOAD_WIRE_MAX);
  });

  it('never reports a lower percentage', () => {
    const seen: number[] = [];
    const report = createMonotonicProgress((pct) => seen.push(pct));
    report(10);
    report(40);
    report(30);
    report(95);
    expect(seen).toEqual([10, 40, 95]);
  });

  it('maps server finalize stages above the wire band', () => {
    expect(mapServerUploadProgress(30, true)).toBe(UPLOAD_WIRE_MAX);
    expect(mapServerUploadProgress(75, true)).toBe(UPLOAD_QUEUED_PCT);
    expect(mapServerUploadProgress(85, true)).toBe(UPLOAD_PROCESSING_PCT);
    expect(mapServerUploadProgress(100, true)).toBe(100);
  });

  it('formats progress labels without showing 0%', () => {
    expect(formatProcessProgressLabel('上传中', 0, '上传中')).toBe('上传中');
    expect(formatProcessProgressLabel('上传中', 42, '上传中')).toBe('上传中 42%');
  });
});
