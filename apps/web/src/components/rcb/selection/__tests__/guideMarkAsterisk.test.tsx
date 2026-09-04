import { describe, expect, it } from 'vitest';
import { render } from '@testing-library/react';
import { GuideMarkAsterisk } from '../chrome/SmartGuidesOverlay';

describe('GuideMarkAsterisk', () => {
  it('renders a 米 mark (four arms) instead of a filled circle', () => {
    const { container } = render(
      <svg>
        <GuideMarkAsterisk x={10} y={20} r={4} strokeWidth={1} />
      </svg>
    );
    const mark = container.querySelector('[data-rcb-guide-mark="asterisk"]');
    expect(mark).toBeTruthy();
    expect(mark?.querySelectorAll('line').length).toBe(4);
    expect(container.querySelector('circle')).toBeNull();
  });
});
