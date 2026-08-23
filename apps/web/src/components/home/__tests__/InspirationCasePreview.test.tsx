import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import InspirationCasePreview from '@/components/home/InspirationCasePreview';
import type { OfficialCaseMeta } from '@/utils/officialCases';

vi.mock('@floating-ui/react', () => ({
  FloatingPortal: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

vi.mock('react-redux', () => ({
  useSelector: (fn: (s: unknown) => unknown) => fn({ auth: { user: null } }),
}));

const navigate = vi.fn();
vi.mock('react-router-dom', () => ({
  useNavigate: () => navigate,
}));

vi.mock('@/components/templates/TemplateThumbnail', () => ({
  default: () => <div data-testid="template-thumb" />,
}));

vi.mock('@/components/home/AuthorFollowAvatar', () => ({
  default: ({ name }: { name: string }) => <div data-testid="author-avatar">{name}</div>,
}));

vi.mock('@/components/base', () => ({
  message: { success: vi.fn(), warning: vi.fn(), error: vi.fn() },
}));

const meta: OfficialCaseMeta = {
  id: 'case-ui-mobile',
  nameKey: 'caseUiMobile',
  category: 'mobile',
  authorName: 'recombyn',
  authorUserId: 'official:recombyn',
  likeCount: 3,
  useCount: 24,
};

const projectDocument = {
  activeFrameId: 'f1',
  frames: [
    { id: 'f1', name: 'Page A', x: 0, y: 0, width: 390, height: 844, backgroundColor: '#fff' },
    { id: 'f2', name: 'Page B', x: 500, y: 0, width: 390, height: 844, backgroundColor: '#eee' },
  ],
  deltaSetLike: { ROOT: { id: 'ROOT', children: [] } },
};

describe('InspirationCasePreview', () => {
  beforeEach(() => {
    navigate.mockReset();
  });

  it('renders artboard rail from project document and switches frames', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    const onRemix = vi.fn();

    render(
      <InspirationCasePreview
        open
        caseMeta={meta}
        projectDocument={projectDocument}
        likedIds={new Set()}
        onClose={onClose}
        onRemix={onRemix}
        onToggleLike={vi.fn()}
      />
    );

    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: 'home.cases.makeSame' }).length).toBeGreaterThan(0);
    expect(screen.getAllByRole('button', { name: 'Page A' }).length).toBeGreaterThan(0);
    expect(screen.getAllByRole('button', { name: 'Page B' }).length).toBeGreaterThan(0);

    await user.click(screen.getAllByRole('button', { name: 'Page B' })[0]);
    expect(screen.getAllByRole('button', { name: 'Page B' })[0]).toHaveAttribute(
      'aria-current',
      'true'
    );
  });
});
