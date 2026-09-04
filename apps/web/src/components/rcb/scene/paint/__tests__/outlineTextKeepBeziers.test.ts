import { beforeEach, describe, expect, it, vi } from 'vitest';

const outlineTextFromFont = vi.fn();

vi.mock('@/components/rcb/scene/paint/outlineTextFont', () => ({
  outlineTextFromFont: (...args: unknown[]) => outlineTextFromFont(...args),
}));

vi.mock('@/components/rcb/scene/document/fontCatalog', () => ({
  loadFontCatalog: async () => undefined,
  resolveFontFileUrl: () => null,
}));

function textNodeAttrs(plain: string) {
  return {
    ORIGIN_DATA: JSON.stringify([{ children: [{ text: plain }] }]),
    fontSize: 24,
  };
}

describe('text outline keeps fontkit beziers', () => {
  beforeEach(() => {
    outlineTextFromFont.mockReset();
    outlineTextFromFont.mockResolvedValue({
      pathD: 'M 0 0 C 10 0 20 10 20 20 C 20 30 10 40 0 40 Z',
      closed: true,
      fillColor: '#111',
      fillRule: 'nonzero',
    });
  });

  it('does not flatten fontkit pathD into M/L polylines', async () => {
    const { buildOutlinePathAsync } = await import('../outlineToPath');
    const out = await buildOutlinePathAsync({
      key: 'text',
      width: 120,
      height: 40,
      attrs: textNodeAttrs('A'),
    });
    expect(outlineTextFromFont).toHaveBeenCalled();
    expect(out?.pathD).toBeTruthy();
    expect(out!.pathD).toMatch(/[CcQq]/);
  }, 30_000);
});
