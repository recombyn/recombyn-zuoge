import { describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import Button from '@/components/base/button';

describe('Button loading spinner', () => {
  it('renders a spinning indicator before the label when loading', () => {
    render(
      <Button type="primary" destructive loading>
        Delete
      </Button>
    );

    const btn = screen.getByRole('button', { name: /delete/i });
    expect(btn).toBeDisabled();
    const spinner = btn.querySelector('.animate-spin');
    expect(spinner).toBeTruthy();
    expect(spinner?.className).toMatch(/rounded-full/);
    expect(spinner?.className).toMatch(/border-current/);
  });

  it('shows the spinner while an async click handler is in flight', async () => {
    const user = userEvent.setup();
    let resolveDelete!: () => void;
    const pending = new Promise<void>((resolve) => {
      resolveDelete = resolve;
    });

    function Fixture() {
      const [deleting, setDeleting] = useState(false);
      return (
        <Button
          type="primary"
          destructive
          loading={deleting}
          onClick={() => {
            setDeleting(true);
            void pending.finally(() => setDeleting(false));
          }}
        >
          Delete
        </Button>
      );
    }

    render(<Fixture />);
    const btn = screen.getByRole('button', { name: /delete/i });
    expect(btn.querySelector('.animate-spin')).toBeNull();

    await user.click(btn);
    await waitFor(() => {
      expect(btn.querySelector('.animate-spin')).toBeTruthy();
    });
    expect(btn).toBeDisabled();

    resolveDelete();
    await waitFor(() => {
      expect(btn.querySelector('.animate-spin')).toBeNull();
    });
  });

  it('does not fire onClick again while loading', async () => {
    const user = userEvent.setup();
    const onClick = vi.fn();
    render(
      <Button type="primary" loading onClick={onClick}>
        Save
      </Button>
    );
    await user.click(screen.getByRole('button', { name: /save/i }));
    expect(onClick).not.toHaveBeenCalled();
  });
});
