import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import type { Attachment, LocalIssue } from '@my-claudia/shared';

vi.mock('../store', () => ({
  useLocalIssueStore: () => ({
    closeIssue: vi.fn(),
    reopenIssue: vi.fn(),
    deleteIssue: vi.fn(),
    updateIssue: vi.fn(),
  }),
}));

const mockAttachments: { items: Attachment[] } = { items: [] };
const useAttachmentsMock = vi.fn();
let mockBadgeCount = 0;

vi.mock('../../attachments', async () => {
  const actual = await vi.importActual<typeof import('../../attachments')>('../../attachments');
  return {
    ...actual,
    useAttachments: (kind: string | null, id: string | null) => {
      useAttachmentsMock(kind, id);
      return {
        items: kind && id ? mockAttachments.items : [],
        isLoading: false,
        reload: vi.fn(),
        upload: vi.fn(),
        remove: vi.fn().mockResolvedValue(undefined),
        rename: vi.fn(),
      };
    },
    useAttachmentCount: () => mockBadgeCount,
  };
});

import { LocalIssueCard } from '../components/LocalIssueCard';

const issue: LocalIssue = {
  id: 'iss-1',
  projectId: 'proj-1',
  title: 'Bug',
  description: 'Reproduction steps',
  status: 'open',
  priority: 'medium',
  labels: [],
  createdAt: Date.now(),
  updatedAt: Date.now(),
};

const att = (overrides: Partial<Attachment> = {}): Attachment => ({
  id: 'a1',
  ownerKind: 'local_issue',
  ownerId: 'iss-1',
  name: 'pic.png',
  mimeType: 'image/png',
  size: 1024,
  kind: 'image',
  sortOrder: 0,
  createdAt: 0,
  ...overrides,
});

beforeEach(() => {
  useAttachmentsMock.mockClear();
  mockAttachments.items = [];
  mockBadgeCount = 0;
});

describe('LocalIssueCard', () => {
  it('does NOT load full attachment list while collapsed', () => {
    render(<LocalIssueCard issue={issue} projectId="proj-1" onEdit={vi.fn()} />);
    expect(useAttachmentsMock).toHaveBeenCalledWith(null, null);
  });

  it('loads full attachment list when expanded', () => {
    render(<LocalIssueCard issue={issue} projectId="proj-1" onEdit={vi.fn()} />);
    fireEvent.click(screen.getAllByRole('button')[0]);
    expect(useAttachmentsMock).toHaveBeenLastCalledWith('local_issue', 'iss-1');
  });

  it('shows count badge while collapsed when store has a count', () => {
    mockBadgeCount = 3;
    render(<LocalIssueCard issue={issue} projectId="proj-1" onEdit={vi.fn()} />);
    expect(screen.getByTitle('3 attachments')).toBeInTheDocument();
  });

  it('renders attachment list when expanded', async () => {
    mockBadgeCount = 2;
    mockAttachments.items = [att({ id: 'a' }), att({ id: 'b', name: 'doc.pdf', kind: 'document' })];

    render(<LocalIssueCard issue={issue} projectId="proj-1" onEdit={vi.fn()} />);
    fireEvent.click(screen.getAllByRole('button')[0]);

    await waitFor(() => screen.getByText('Reproduction steps'));
    expect(screen.getByTitle('2 attachments')).toBeInTheDocument();
    expect(screen.getAllByTestId('attachment-thumbnail')).toHaveLength(2);
  });

  it('hides badge when count is 0', () => {
    render(<LocalIssueCard issue={issue} projectId="proj-1" onEdit={vi.fn()} />);
    expect(screen.queryByTitle(/attachment/)).not.toBeInTheDocument();
  });
});
