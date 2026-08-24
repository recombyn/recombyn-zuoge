import { describe, expect, it } from 'vitest';
import { composerConsumesWheel } from '../wheelScrollOwners';

function wheel(overrides: Partial<WheelEvent> = {}): WheelEvent {
  return {
    deltaY: 10,
    deltaMode: 0,
    ctrlKey: false,
    metaKey: false,
    ...overrides,
  } as WheelEvent;
}

function mockComposer(size: { scrollHeight: number; clientHeight: number; scrollTop?: number }) {
  const el = {
    scrollHeight: size.scrollHeight,
    clientHeight: size.clientHeight,
    scrollTop: size.scrollTop ?? 0,
    closest: (sel: string) => (sel === '[data-agent-composer]' ? el : null),
  };
  return el as unknown as HTMLElement;
}

describe('composerConsumesWheel', () => {
  it('does not consume when composer is not scrollable', () => {
    const composer = mockComposer({ scrollHeight: 40, clientHeight: 40 });
    expect(composerConsumesWheel(composer, wheel())).toBe(false);
  });

  it('does not consume pinch / ctrl+wheel so canvas can zoom', () => {
    const composer = mockComposer({ scrollHeight: 200, clientHeight: 80 });
    expect(composerConsumesWheel(composer, wheel({ ctrlKey: true }))).toBe(false);
    expect(composerConsumesWheel(composer, wheel({ metaKey: true }))).toBe(false);
  });

  it('consumes wheel when composer can scroll in that direction', () => {
    const composer = mockComposer({ scrollHeight: 200, clientHeight: 80, scrollTop: 0 });
    expect(composerConsumesWheel(composer, wheel({ deltaY: 10 }))).toBe(true);
    expect(composerConsumesWheel(composer, wheel({ deltaY: -10 }))).toBe(false);
  });
});
