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
    epicId?: string;
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
    epicId: over.epicId,
    createdAt: 0,
    updatedAt: 0,
  } as never;
}

function mkEpic(over: Partial<{ id: string; title: string; status: string }>) {
  return {
    id: over.id ?? 'e',
    projectId: 'p1',
    title: over.title ?? 'E',
    status: over.status ?? 'open',
    labels: [],
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
    // Default: epics fetch returns empty; individual tests can override.
    // listIssues is NOT mocked here so pre-set store state survives mount.
    vi.spyOn(api, 'listEpics').mockResolvedValue([]);
  });

  it('renders empty state when no issues', () => {
    render(<IssueListScreen projectId="p1" />);
    expect(screen.getByText(/No issues yet/i)).toBeInTheDocument();
  });

  it('renders an Epic with issue count', async () => {
    vi.spyOn(api, 'listEpics').mockResolvedValue([mkEpic({ id: 'e1', title: 'Add 2FA' })]);
    useOpenSpecStore.setState({
      issuesByProject: {
        p1: [
          mkIssue({ id: 's1', title: 'Initial flow', type: 'implement', epicId: 'e1' }),
          mkIssue({ id: 's2', title: 'Bug fix', type: 'bug', epicId: 'e1' }),
        ],
      },
    } as never);
    render(<IssueListScreen projectId="p1" />);
    await waitFor(() => expect(screen.getByText('Add 2FA')).toBeInTheDocument());
    expect(screen.getByText(/2 issues/)).toBeInTheDocument();
    // Sub-issues with an Epic are hidden from top list
    expect(screen.queryByText('Initial flow')).not.toBeInTheDocument();
  });

  it('renders free-standing sub-issue (no epic, not anonymous)', () => {
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

  it('clicking an Epic row opens epic-detail', async () => {
    vi.spyOn(api, 'listEpics').mockResolvedValue([mkEpic({ id: 'e1', title: 'Epic A' })]);
    render(<IssueListScreen projectId="p1" />);
    await waitFor(() => expect(screen.getByText('Epic A')).toBeInTheDocument());
    fireEvent.click(screen.getByText('Epic A'));
    const v = useOpenSpecStore.getState().viewByProject.p1;
    expect(v.screen).toBe('epic-detail');
    expect(v.selectedEpicId).toBe('e1');
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

  it('calls listIssues on mount and populates store', async () => {
    const spy = vi.spyOn(api, 'listIssues').mockResolvedValue([
      mkIssue({ id: 'autoload-1', title: 'Loaded From Server' }),
    ] as never);
    render(<IssueListScreen projectId="p1" />);
    await waitFor(() => expect(spy).toHaveBeenCalledWith('p1'));
    await waitFor(() => expect(screen.getByText('Loaded From Server')).toBeInTheDocument());
  });

  it('↻ button triggers another listIssues call', async () => {
    const spy = vi.spyOn(api, 'listIssues').mockResolvedValue([] as never);
    render(<IssueListScreen projectId="p1" />);
    await waitFor(() => expect(spy).toHaveBeenCalledTimes(1));
    fireEvent.click(screen.getByRole('button', { name: '↻' }));
    await waitFor(() => expect(spy).toHaveBeenCalledTimes(2));
  });
});
