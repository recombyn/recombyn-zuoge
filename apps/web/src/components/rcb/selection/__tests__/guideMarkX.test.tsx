import { describe, expect, it } from 'vitest';
import { render } from '@testing-library/react';
import { GuideMarkX } from '../chrome/SmartGuidesOverlay';

describe('GuideMarkX', () => {
  it('renders an × mark (two diagonals) instead of a filled circle', () => {
    const { container } = render(
      <svg>
        <GuideMarkX x={10} y={20} r={4} strokeWidth={1} />
      </svg>
    );
    const mark = container.querySelector('[data-rcb-guide-mark="x"]');
    expect(mark).toBeTruthy();
    expect(mark?.querySelectorAll('line').length).toBe(2);
    expect(container.querySelector('circle')).toBeNull();
  });
});
