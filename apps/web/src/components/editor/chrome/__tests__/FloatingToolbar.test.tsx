import { describe, expect, it } from 'vitest';
import { render } from '@testing-library/react';
import { FloatingToolbar } from '../FloatingToolbar';

describe('FloatingToolbar', () => {
  it('renders nothing when there are no visible children', () => {
    const { container } = render(
      <FloatingToolbar>
        {null}
        {false}
        {[]}
      </FloatingToolbar>
    );
    expect(container.firstChild).toBeNull();
  });

  it('renders the pill when there is content', () => {
    const { container, getByText } = render(
      <FloatingToolbar>
        <button type="button">Align</button>
      </FloatingToolbar>
    );
    expect(container.firstChild).not.toBeNull();
    expect(getByText('Align')).toBeTruthy();
  });
});
