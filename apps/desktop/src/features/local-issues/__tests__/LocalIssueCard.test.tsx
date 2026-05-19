import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import type { LocalIssue } from '@my-claudia/shared';

let mockBadgeCount = 0;

vi.mock('../../attachments', async () => {
  const actual = await vi.importActual<typeof import('../../attachments')>('../../attachments');
  return {
    ...actual,
    useAttachmentCount: () => mockBadgeCount,
  };
});

import { LocalIssueCard } from '../components/LocalIssueCard';

const issue: LocalIssue = {
  id: 'iss-1',
  projectId: 'proj-1',
  title: 'Bug title',
  description: 'Reproduction steps',
  status: 'open',
  priority: 'medium',
  labels: ['bug'],
  createdAt: Date.now(),
  updatedAt: Date.now(),
};

beforeEach(() => {
  mockBadgeCount = 0;
});

describe('LocalIssueCard', () => {
  it('renders title, status, priority, and labels', () => {
    render(<LocalIssueCard issue={issue} projectId="proj-1" onOpen={vi.fn()} />);
    expect(screen.getByText('Bug title')).toBeInTheDocument();
    expect(screen.getByText('open')).toBeInTheDocument();
    expect(screen.getByText('medium')).toBeInTheDocument();
    expect(screen.getByText('bug')).toBeInTheDocument();
  });

  it('clicking the card invokes onOpen with the issue id', () => {
    const onOpen = vi.fn();
    render(<LocalIssueCard issue={issue} projectId="proj-1" onOpen={onOpen} />);
    fireEvent.click(screen.getByRole('button'));
    expect(onOpen).toHaveBeenCalledWith('iss-1');
  });

  it('shows attachment count badge when there are attachments', () => {
    mockBadgeCount = 3;
    render(<LocalIssueCard issue={issue} projectId="proj-1" onOpen={vi.fn()} />);
    expect(screen.getByTitle('3 attachments')).toBeInTheDocument();
  });

  it('hides attachment badge when count is 0', () => {
    render(<LocalIssueCard issue={issue} projectId="proj-1" onOpen={vi.fn()} />);
    expect(screen.queryByTitle(/attachment/)).not.toBeInTheDocument();
  });

  it('shows the actionable bolt icon when the actionable label is present', () => {
    const actionableIssue = { ...issue, labels: ['actionable'] };
    render(<LocalIssueCard issue={actionableIssue} projectId="proj-1" onOpen={vi.fn()} />);
    expect(screen.getByTitle(/ready to execute/i)).toBeInTheDocument();
  });

  it('does not show the bolt icon for issues without the actionable label', () => {
    render(<LocalIssueCard issue={issue} projectId="proj-1" onOpen={vi.fn()} />);
    expect(screen.queryByTitle(/ready to execute/i)).not.toBeInTheDocument();
  });
});
