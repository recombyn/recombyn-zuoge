import { describe, expect, it } from 'vitest';
import {
  resolveFontFileUrl,
  toggleCatalogTextBold,
} from '@/components/rcb/scene/document/fontCatalog';
import type { FontFamilyNode } from '@/components/rcb/scene/document/fontCatalogTypes';

const PUHUI: FontFamilyNode[] = [
  {
    family: 'Alibaba PuHuiTi',
    displayName: '阿里巴巴普惠体',
    children: [
      {
        family: 'Alibaba PuHuiTi',
        displayName: 'Regular',
        weight: 400,
        url: 'https://example.com/regular.woff2',
      },
      {
        family: 'Alibaba PuHuiTi Bold',
        displayName: 'Bold',
        weight: 700,
        url: 'https://example.com/bold.woff2',
      },
    ],
  },
];

describe('catalog Bold face for paint + outline', () => {
  it('resolveFontFileUrl picks Bold sibling when CSS weight is bold', () => {
    expect(resolveFontFileUrl('Alibaba PuHuiTi', 700, PUHUI)).toContain('bold.woff2');
    expect(resolveFontFileUrl('Alibaba PuHuiTi', 'bold', PUHUI)).toContain('bold.woff2');
  });

  it('resolveFontFileUrl keeps exact Bold face file', () => {
    expect(resolveFontFileUrl('Alibaba PuHuiTi Bold', 400, PUHUI)).toContain('bold.woff2');
  });

  it('toggleCatalogTextBold switches to real Bold / Regular faces', () => {
    const on = toggleCatalogTextBold('Alibaba PuHuiTi', 'normal', PUHUI);
    expect(on.fontFamily).toBe('Alibaba PuHuiTi Bold');
    expect(on.fontWeight).toBe('normal');

    const off = toggleCatalogTextBold(on.fontFamily, on.fontWeight, PUHUI);
    expect(off.fontFamily).toBe('Alibaba PuHuiTi');
    expect(off.fontWeight).toBe('normal');
  });
});
