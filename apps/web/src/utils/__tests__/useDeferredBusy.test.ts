import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useDeferredBusy } from '@/utils/useDeferredBusy';

describe('useDeferredBusy', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('does not show when busy clears before delay', () => {
    const { result, rerender } = renderHook(
      ({ busy }) => useDeferredBusy(busy, { delayMs: 200, minVisibleMs: 280 }),
      { initialProps: { busy: true } }
    );
    expect(result.current).toBe(false);

    act(() => {
      vi.advanceTimersByTime(150);
    });
    expect(result.current).toBe(false);

    rerender({ busy: false });
    act(() => {
      vi.advanceTimersByTime(500);
    });
    expect(result.current).toBe(false);
  });

  it('shows after delay and holds min visible after busy clears', () => {
    const { result, rerender } = renderHook(
      ({ busy }) => useDeferredBusy(busy, { delayMs: 200, minVisibleMs: 280 }),
      { initialProps: { busy: true } }
    );

    act(() => {
      vi.advanceTimersByTime(200);
    });
    expect(result.current).toBe(true);

    rerender({ busy: false });
    act(() => {
      vi.advanceTimersByTime(200);
    });
    expect(result.current).toBe(true);

    act(() => {
      vi.advanceTimersByTime(80);
    });
    expect(result.current).toBe(false);
  });

  it('stays visible if busy returns before hide finishes', () => {
    const { result, rerender } = renderHook(
      ({ busy }) => useDeferredBusy(busy, { delayMs: 200, minVisibleMs: 280 }),
      { initialProps: { busy: true } }
    );

    act(() => {
      vi.advanceTimersByTime(200);
    });
    expect(result.current).toBe(true);

    rerender({ busy: false });
    act(() => {
      vi.advanceTimersByTime(100);
    });
    rerender({ busy: true });
    act(() => {
      vi.advanceTimersByTime(500);
    });
    expect(result.current).toBe(true);
  });
});
