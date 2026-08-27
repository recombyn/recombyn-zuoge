import { describe, expect, it } from 'vitest';
import {
  composerConsumesWheel,
  textFrameBlocksBrowserZoom,
  textFrameConsumesWheel,
  wheelShouldStayLocal,
} from '../wheelScrollOwners';

function wheel(overrides: Partial<WheelEvent> = {}): WheelEvent {
  return {
    deltaY: 10,
    deltaMode: 0,
    ctrlKey: false,
    metaKey: false,
    ...overrides,
  } as WheelEvent;
}

function mockScrollEl(
  size: { scrollHeight: number; clientHeight: number; scrollTop?: number },
  closestMap: Record<string, unknown>
) {
  const el = {
    scrollHeight: size.scrollHeight,
    clientHeight: size.clientHeight,
    scrollTop: size.scrollTop ?? 0,
    closest: (sel: string) => closestMap[sel] ?? null,
    querySelector: () => null,
  };
  return el as unknown as HTMLElement;
}

describe('composerConsumesWheel', () => {
  it('does not consume when composer is not scrollable', () => {
    const composer = mockScrollEl(
      { scrollHeight: 40, clientHeight: 40 },
      { '[data-agent-composer]': null }
    );
    (composer as any).closest = (sel: string) =>
      sel === '[data-agent-composer]' ? composer : null;
    expect(composerConsumesWheel(composer, wheel())).toBe(false);
  });

  it('does not consume pinch / ctrl+wheel so canvas can zoom', () => {
    const composer = mockScrollEl(
      { scrollHeight: 200, clientHeight: 80 },
      {}
    );
    (composer as any).closest = (sel: string) =>
      sel === '[data-agent-composer]' ? composer : null;
    expect(composerConsumesWheel(composer, wheel({ ctrlKey: true }))).toBe(false);
    expect(composerConsumesWheel(composer, wheel({ metaKey: true }))).toBe(false);
  });

  it('consumes wheel when composer can scroll in that direction', () => {
    const composer = mockScrollEl(
      { scrollHeight: 200, clientHeight: 80, scrollTop: 0 },
      {}
    );
    (composer as any).closest = (sel: string) =>
      sel === '[data-agent-composer]' ? composer : null;
    expect(composerConsumesWheel(composer, wheel({ deltaY: 10 }))).toBe(true);
    expect(composerConsumesWheel(composer, wheel({ deltaY: -10 }))).toBe(false);
  });
});

describe('textFrameConsumesWheel', () => {
  it('consumes wheel on a scrollable text-frame overlay', () => {
    const overlay = mockScrollEl(
      { scrollHeight: 400, clientHeight: 200, scrollTop: 0 },
      {}
    );
    (overlay as any).closest = (sel: string) =>
      sel === '[data-text-frame-overlay]' ? overlay : null;
    expect(textFrameConsumesWheel(overlay, wheel({ deltaY: 20 }))).toBe(true);
    expect(wheelShouldStayLocal(overlay, wheel({ deltaY: 20 }))).toBe(true);
  });

  it('does not pan-block when text frame cannot scroll further', () => {
    const overlay = mockScrollEl(
      { scrollHeight: 400, clientHeight: 200, scrollTop: 0 },
      {}
    );
    (overlay as any).closest = (sel: string) =>
      sel === '[data-text-frame-overlay]' ? overlay : null;
    expect(textFrameConsumesWheel(overlay, wheel({ deltaY: -20 }))).toBe(false);
  });

  it('blocks browser pinch-zoom over text-frame surface', () => {
    const overlay = mockScrollEl(
      { scrollHeight: 400, clientHeight: 200, scrollTop: 0 },
      {}
    );
    (overlay as any).closest = (sel: string) =>
      sel === '[data-text-frame-overlay]' ? overlay : null;
    expect(textFrameBlocksBrowserZoom(overlay, wheel({ ctrlKey: true }))).toBe(true);
    expect(textFrameBlocksBrowserZoom(overlay, wheel())).toBe(false);
  });
});
