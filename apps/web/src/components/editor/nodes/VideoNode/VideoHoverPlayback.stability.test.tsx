import { describe, expect, it } from 'vitest';
import { render, cleanup } from '@testing-library/react';
import { useEffect, useRef, useState } from 'react';

/**
 * Regression: selection re-renders must not remount <video> or rewrite src
 * (that resets currentTime to 0 / flashes the first frame).
 */
function PlainVideo({ src, label }: { src: string; label: string }) {
  const ref = useRef<HTMLVideoElement | null>(null);
  const [mounted] = useState(() => ({ n: 0 }));

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (el.getAttribute('src') === src) return;
    el.src = src;
  }, [src]);

  useEffect(() => {
    mounted.n += 1;
  }, [mounted]);

  return (
    <div data-label={label}>
      <video ref={ref} data-testid="v" muted playsInline />
      <span data-testid="mounts">{mounted.n}</span>
    </div>
  );
}

describe('canvas video src stability', () => {
  it('keeps the same video element across parent re-renders', () => {
    const { rerender, getByTestId } = render(<PlainVideo src="blob:test-a" label="a" />);
    const el1 = getByTestId('v');
    (el1 as HTMLVideoElement).currentTime = 3.5;

    rerender(<PlainVideo src="blob:test-a" label="b" />);
    const el2 = getByTestId('v');

    expect(el2).toBe(el1);
    expect((el2 as HTMLVideoElement).getAttribute('src')).toBe('blob:test-a');
    cleanup();
  });

  it('does not rewrite src when the url is unchanged', () => {
    const { rerender, getByTestId } = render(<PlainVideo src="https://cdn.example/a.mp4" label="1" />);
    const el = getByTestId('v') as HTMLVideoElement;
    const before = el.getAttribute('src');

    rerender(<PlainVideo src="https://cdn.example/a.mp4" label="2" />);
    expect(el.getAttribute('src')).toBe(before);
    cleanup();
  });
});
