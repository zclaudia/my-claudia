import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import type { LocalIssue } from '@my-claudia/shared';

const mockLoadIssues = vi.fn().mockResolvedValue(undefined);
const mockUseAttachmentCounts = vi.fn();
let mockIssues: LocalIssue[] = [];

vi.mock('../store', () => ({
  useLocalIssueStore: vi.fn((selector?: (s: unknown) => unknown) => {
    const state = {
      issues: { 'proj-1': mockIssues },
      loadIssues: mockLoadIssues,
    };
    return selector ? selector(state) : state;
  }),
}));

vi.mock('../../attachments', async () => {
  const actual = await vi.importActual<typeof import('../../attachments')>('../../attachments');
  return {
    ...actual,
    useAttachmentCounts: (...args: unknown[]) => {
      mockUseAttachmentCounts(...args);
    },
    useAttachmentCount: () => 0,
    useAttachments: () => ({
      items: [],
      isLoading: false,
      reload: vi.fn(),
      upload: vi.fn(),
      remove: vi.fn(),
      rename: vi.fn(),
    }),
  };
});

import { LocalIssuesPanel } from '../components/LocalIssuesPanel';

const makeIssue = (id: string, overrides: Partial<LocalIssue> = {}): LocalIssue => ({
  id,
  projectId: 'proj-1',
  title: `Issue ${id}`,
  description: undefined,
  status: 'open',
  priority: 'medium',
  labels: [],
  createdAt: 0,
  updatedAt: 0,
  ...overrides,
});

beforeEach(() => {
  mockLoadIssues.mockClear();
  mockUseAttachmentCounts.mockClear();
  mockIssues = [];
});

describe('LocalIssuesPanel - attachment count batching', () => {
  it('triggers loadIssues for the project', async () => {
    render(<LocalIssuesPanel projectId="proj-1" selectedIssueId={null} onSelectIssue={() => {}} />);
    await waitFor(() => expect(mockLoadIssues).toHaveBeenCalledWith('proj-1'));
  });

  it('passes all issue ids to useAttachmentCounts', () => {
    mockIssues = [makeIssue('a'), makeIssue('b'), makeIssue('c')];
    render(<LocalIssuesPanel projectId="proj-1" selectedIssueId={null} onSelectIssue={() => {}} />);
    expect(mockUseAttachmentCounts).toHaveBeenCalledWith('local_issue', ['a', 'b', 'c']);
  });

  it('passes empty array when there are no issues', () => {
    render(<LocalIssuesPanel projectId="proj-1" selectedIssueId={null} onSelectIssue={() => {}} />);
    expect(mockUseAttachmentCounts).toHaveBeenCalledWith('local_issue', []);
  });

  it('renders an issue card per issue', () => {
    mockIssues = [makeIssue('a'), makeIssue('b')];
    render(<LocalIssuesPanel projectId="proj-1" selectedIssueId={null} onSelectIssue={() => {}} />);
    expect(screen.getByText('Issue a')).toBeInTheDocument();
    expect(screen.getByText('Issue b')).toBeInTheDocument();
  });
});

describe('LocalIssuesPanel - actionable filter', () => {
  it('renders a "可动工" filter chip', () => {
    render(<LocalIssuesPanel projectId="proj-1" selectedIssueId={null} onSelectIssue={() => {}} />);
    expect(screen.getByRole('button', { name: /可动工/i })).toBeInTheDocument();
  });

  it('filters to actionable issues when the chip is active', () => {
    mockIssues = [
      makeIssue('a', { title: 'Regular bug', labels: [] }),
      makeIssue('b', { title: 'Saved plan', labels: ['actionable'] }),
    ];
    render(<LocalIssuesPanel projectId="proj-1" selectedIssueId={null} onSelectIssue={() => {}} />);
    expect(screen.getByText('Regular bug')).toBeInTheDocument();
    expect(screen.getByText('Saved plan')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /可动工/i }));

    expect(screen.queryByText('Regular bug')).not.toBeInTheDocument();
    expect(screen.getByText('Saved plan')).toBeInTheDocument();
  });
});
