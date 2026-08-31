import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import RailRecentList from '@/components/layout/RailRecentList';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, opts?: { name?: string }) => {
      const map: Record<string, string> = {
        'home.deleteProjectConfirmTitle': 'Delete project?',
        'home.deleteProjectConfirmBody': `This cannot be undone. Delete "${opts?.name}"?`,
        'common.cancel': 'Cancel',
        'common.delete': 'Delete',
        'home.untitled': 'Untitled',
        'home.recentEmpty': 'No recent',
        'home.recent': 'Recent',
        'home.rename': 'Rename',
        'home.newProject': 'New project',
        'home.batchDeleteFailed': 'Delete failed',
      };
      return map[key] ?? key;
    },
  }),
}));

const removeProjectFromCloud = vi.fn();
vi.mock('@/components/editor/useProjectCloudSync', () => ({
  removeProjectFromCloud: (...args: unknown[]) => removeProjectFromCloud(...args),
  renameProjectOnCloud: vi.fn(),
  requestProjectFlush: vi.fn(),
}));

vi.mock('@/service/projects', () => ({
  invalidateProjectsListCache: vi.fn(),
  refreshProjectsListAfterMutation: vi.fn(),
}));

vi.mock('@/utils/useDeferredBusy', () => ({
  useDeferredBusy: () => false,
}));

vi.mock('@/components/base', async () => {
  const Button = (await import('@/components/base/button')).default;
  const Dialog = ({
    show,
    title,
    footer,
    children,
  }: {
    show: boolean;
    title?: string;
    footer?: React.ReactNode;
    children?: React.ReactNode;
  }) =>
    show ? (
      <div role="dialog" aria-label={title}>
        <h2>{title}</h2>
        {children}
        <div data-testid="dialog-footer">{footer}</div>
      </div>
    ) : null;

  function Dropdown({
    items,
    onClick,
    children,
  }: {
    items: Array<{ key: string; label: React.ReactNode }>;
    onClick?: (key: string) => void;
    children: React.ReactNode;
  }) {
    return (
      <div>
        {children}
        <div data-testid="dropdown-menu">
          {items.map((item) => (
            <button
              key={item.key}
              type="button"
              onClick={() => onClick?.(item.key)}
            >
              {item.label}
            </button>
          ))}
        </div>
      </div>
    );
  }

  return {
    Button,
    Dialog,
    Dropdown,
    Tooltip: ({ children }: { children: React.ReactNode }) => <>{children}</>,
    message: {
      destructive: vi.fn(),
      error: vi.fn(),
      success: vi.fn(),
    },
  };
});

const deleteTemplate = vi.fn();
vi.mock('@/store', () => ({
  useSelector: (fn: (s: unknown) => unknown) =>
    fn({ editor: { currentId: null } }),
}));

vi.mock('@/store/modules/editor', () => ({
  deleteTemplate: (...args: unknown[]) => deleteTemplate(...args),
  renameTemplateById: vi.fn(),
}));

describe('RailRecentList delete confirm loading', () => {
  beforeEach(() => {
    removeProjectFromCloud.mockReset();
    deleteTemplate.mockReset();
  });

  it('shows a spinner on Delete while cloud delete is pending', async () => {
    const user = userEvent.setup();
    let resolveDelete!: () => void;
    removeProjectFromCloud.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          resolveDelete = resolve;
        })
    );

    render(
      <RailRecentList
        expanded
        projects={[
          {
            id: 'p1',
            name: '未命名作品测试',
            openedAt: Date.now(),
            updatedAt: Date.now(),
          },
        ]}
        onOpenProject={vi.fn()}
        onCreate={vi.fn()}
      />
    );

    const menuDelete = screen
      .getAllByRole('button')
      .find((b) => b.textContent?.includes('Delete') && b.closest('[data-testid="dropdown-menu"]'));
    expect(menuDelete).toBeTruthy();
    await user.click(menuDelete!);

    const dialog = await screen.findByRole('dialog', { name: /delete project/i });
    const footer = screen.getByTestId('dialog-footer');
    const confirmDelete = Array.from(footer.querySelectorAll('button')).find((b) =>
      /^Delete$/i.test((b.textContent || '').trim())
    );
    expect(confirmDelete).toBeTruthy();
    expect(confirmDelete!.querySelector('.animate-spin')).toBeNull();

    await user.click(confirmDelete!);

    await waitFor(() => {
      expect(confirmDelete!.querySelector('.animate-spin')).toBeTruthy();
    });
    expect(confirmDelete).toBeDisabled();
    expect(removeProjectFromCloud).toHaveBeenCalledWith('p1');

    resolveDelete();
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).toBeNull();
    });
  });
});
