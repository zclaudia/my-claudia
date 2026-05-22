// apps/desktop/src/features/openspec/__tests__/IssueListScreen.test.tsx
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { IssueListScreen } from '../components/IssueListScreen.js';
import { useOpenSpecStore } from '../store.js';
import * as api from '../api.js';

function mkIssue(
  over: Partial<{
    id: string;
    title: string;
    type: string;
    status: string;
    isAnonymous: boolean;
    parentIssueId?: string;
  }>,
) {
  return {
    id: over.id ?? 'i',
    projectId: 'p1',
    title: over.title ?? 'T',
    status: over.status ?? 'open',
    priority: 'medium',
    labels: [],
    type: over.type ?? 'implement',
    isAnonymous: over.isAnonymous ?? false,
    parentIssueId: over.parentIssueId,
    createdAt: 0,
    updatedAt: 0,
  } as never;
}

describe('IssueListScreen', () => {
  beforeEach(() => {
    useOpenSpecStore.setState({
      issuesByProject: {},
      specChangesById: {},
      executorsBySpecChange: {},
      corpusByProject: {},
      viewByProject: {},
    });
    vi.restoreAllMocks();
  });

  it('renders empty state when no issues', () => {
    render(<IssueListScreen projectId="p1" />);
    expect(screen.getByText(/No issues yet/i)).toBeInTheDocument();
  });

  it('renders a parent feature with sub-issue count', () => {
    useOpenSpecStore.setState({
      issuesByProject: {
        p1: [
          mkIssue({ id: 'f1', title: 'Add 2FA', type: 'feature' }),
          mkIssue({ id: 's1', title: 'Initial flow', type: 'implement', parentIssueId: 'f1' }),
          mkIssue({ id: 's2', title: 'Bug fix', type: 'bug', parentIssueId: 'f1' }),
        ],
      },
    } as never);
    render(<IssueListScreen projectId="p1" />);
    expect(screen.getByText('Add 2FA')).toBeInTheDocument();
    expect(screen.getByText(/2 sub-issues/)).toBeInTheDocument();
    // Sub-issues with parent are hidden from top list
    expect(screen.queryByText('Initial flow')).not.toBeInTheDocument();
  });

  it('renders free-standing sub-issue (no parent, not anonymous)', () => {
    useOpenSpecStore.setState({
      issuesByProject: { p1: [mkIssue({ id: 's1', title: 'Quick refactor', type: 'implement' })] },
    } as never);
    render(<IssueListScreen projectId="p1" />);
    expect(screen.getByText('Quick refactor')).toBeInTheDocument();
  });

  it('anonymous issues are folded by default', () => {
    useOpenSpecStore.setState({
      issuesByProject: {
        p1: [
          mkIssue({ id: 'a1', title: 'Anon 1', isAnonymous: true }),
          mkIssue({ id: 'a2', title: 'Anon 2', isAnonymous: true }),
        ],
      },
    } as never);
    render(<IssueListScreen projectId="p1" />);
    expect(screen.getByText('Anonymous (2)')).toBeInTheDocument();
    expect(screen.queryByText('Anon 1')).not.toBeInTheDocument();
  });

  it('expands anonymous list on click', () => {
    useOpenSpecStore.setState({
      issuesByProject: { p1: [mkIssue({ id: 'a1', title: 'Anon 1', isAnonymous: true })] },
    } as never);
    render(<IssueListScreen projectId="p1" />);
    fireEvent.click(screen.getByText(/Anonymous \(1\)/));
    expect(screen.getByText('Anon 1')).toBeInTheDocument();
  });

  it('type filter narrows the list', () => {
    useOpenSpecStore.setState({
      issuesByProject: {
        p1: [
          mkIssue({ id: 'b1', title: 'Bug A', type: 'bug' }),
          mkIssue({ id: 'i1', title: 'Impl A', type: 'implement' }),
        ],
      },
    } as never);
    render(<IssueListScreen projectId="p1" />);
    fireEvent.click(screen.getByText('Bugs'));
    expect(screen.getByText('Bug A')).toBeInTheDocument();
    expect(screen.queryByText('Impl A')).not.toBeInTheDocument();
  });

  it('clicking a feature row opens feature-detail', async () => {
    useOpenSpecStore.setState({
      issuesByProject: { p1: [mkIssue({ id: 'f1', title: 'F', type: 'feature' })] },
    } as never);
    vi.spyOn(api, 'getIssue').mockResolvedValue(
      mkIssue({ id: 'f1', title: 'F', type: 'feature' }) as never,
    );
    render(<IssueListScreen projectId="p1" />);
    fireEvent.click(screen.getByText('F'));
    await waitFor(() => {
      const v = useOpenSpecStore.getState().viewByProject.p1;
      expect(v.screen).toBe('feature-detail');
      expect(v.selectedFeatureId).toBe('f1');
    });
  });

  it('clicking a sub-issue row opens sub-issue-detail', async () => {
    useOpenSpecStore.setState({
      issuesByProject: { p1: [mkIssue({ id: 's1', title: 'S', type: 'implement' })] },
    } as never);
    vi.spyOn(api, 'getIssue').mockResolvedValue(
      mkIssue({ id: 's1', title: 'S', type: 'implement' }) as never,
    );
    render(<IssueListScreen projectId="p1" />);
    fireEvent.click(screen.getByText('S'));
    await waitFor(() => {
      const v = useOpenSpecStore.getState().viewByProject.p1;
      expect(v.screen).toBe('sub-issue-detail');
      expect(v.selectedSubIssueId).toBe('s1');
    });
  });

  it('"+ New Issue" sets showNewIssue=true', () => {
    render(<IssueListScreen projectId="p1" />);
    fireEvent.click(screen.getByText('+ New Issue'));
    expect(useOpenSpecStore.getState().viewByProject.p1.showNewIssue).toBe(true);
  });
});
