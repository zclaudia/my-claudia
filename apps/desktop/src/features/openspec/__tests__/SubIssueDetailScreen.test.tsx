// apps/desktop/src/features/openspec/__tests__/SubIssueDetailScreen.test.tsx
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { SubIssueDetailScreen } from '../components/SubIssueDetailScreen.js';
import { useOpenSpecStore } from '../store.js';
import * as api from '../api.js';

function mkIssue(over: Record<string, unknown>) {
  return {
    id: 's',
    projectId: 'p1',
    title: 'S',
    status: 'open',
    priority: 'medium',
    labels: [],
    type: 'implement',
    isAnonymous: false,
    parentIssueId: undefined,
    specChangeId: 'sc1',
    createdAt: 0,
    updatedAt: 0,
    ...over,
  } as never;
}

describe('SubIssueDetailScreen', () => {
  beforeEach(() => {
    useOpenSpecStore.setState({
      issuesByProject: {},
      specChangesById: {},
      executorsBySpecChange: {},
      corpusByProject: {},
      viewByProject: {},
    });
    vi.restoreAllMocks();
    vi.spyOn(api, 'getSpecChange').mockResolvedValue({
      id: 'sc1',
      slug: 'x',
      status: 'drafting',
    } as never);
    vi.spyOn(api, 'listExecutors').mockResolvedValue([]);
  });

  it('renders title + breadcrumb', () => {
    useOpenSpecStore.setState({
      issuesByProject: { p1: [mkIssue({ id: 's', title: 'My Change' })] },
    } as never);
    render(<SubIssueDetailScreen projectId="p1" subIssueId="s" />);
    // Title appears in both the breadcrumb and the <h3> heading.
    expect(screen.getAllByText('My Change').length).toBeGreaterThan(0);
    expect(screen.getByRole('heading', { name: 'My Change' })).toBeInTheDocument();
  });

  it('shows "→ planning" button for open issue', () => {
    useOpenSpecStore.setState({
      issuesByProject: { p1: [mkIssue({ id: 's', status: 'open' })] },
    } as never);
    render(<SubIssueDetailScreen projectId="p1" subIssueId="s" />);
    expect(screen.getByRole('button', { name: /→ planning/ })).toBeInTheDocument();
  });

  it('shows Close & Archive when status=reviewing', () => {
    useOpenSpecStore.setState({
      issuesByProject: { p1: [mkIssue({ id: 's', status: 'reviewing' })] },
    } as never);
    render(<SubIssueDetailScreen projectId="p1" subIssueId="s" />);
    expect(screen.getByRole('button', { name: /Close & Archive/ })).toBeInTheDocument();
  });

  it('clicking Close & Archive opens the confirm dialog', () => {
    useOpenSpecStore.setState({
      issuesByProject: { p1: [mkIssue({ id: 's', status: 'reviewing' })] },
    } as never);
    render(<SubIssueDetailScreen projectId="p1" subIssueId="s" />);
    fireEvent.click(screen.getByRole('button', { name: /Close & Archive/ }));
    expect(useOpenSpecStore.getState().viewByProject.p1.showArchiveConfirm).toBe(true);
  });

  it('clicking Manual Executor + button calls createExecutor', async () => {
    useOpenSpecStore.setState({
      issuesByProject: { p1: [mkIssue({ id: 's' })] },
    } as never);
    const spy = vi.spyOn(api, 'createExecutor').mockResolvedValue({
      id: 'e1',
      projectId: 'p1',
      specChangeId: 'sc1',
      type: 'manual',
      statusSummary: 'pending',
      createdAt: 0,
      updatedAt: 0,
    } as never);
    render(<SubIssueDetailScreen projectId="p1" subIssueId="s" />);
    fireEvent.click(screen.getByRole('button', { name: /\+ Manual Executor/ }));
    await waitFor(() => expect(spy).toHaveBeenCalled());
  });

  describe('SpecChange artifact tabs', () => {
    beforeEach(() => {
      const sc = {
        id: 'sc1',
        slug: 'x',
        status: 'drafting',
        deltaSpecPaths: [
          'openspec/changes/x/specs/auth/spec.md',
          'openspec/changes/x/specs/billing/spec.md',
        ],
      };
      useOpenSpecStore.setState({
        issuesByProject: { p1: [mkIssue({ id: 's', title: 'S' })] },
        specChangesById: { sc1: sc as never },
      } as never);
      // Override the outer beforeEach mock so the post-mount refetch keeps
      // deltaSpecPaths populated.
      vi.spyOn(api, 'getSpecChange').mockResolvedValue(sc as never);
      vi.spyOn(api, 'readProposal').mockResolvedValue('PROPOSAL_TEXT');
      vi.spyOn(api, 'readDesign').mockResolvedValue('DESIGN_TEXT');
      vi.spyOn(api, 'readTasks').mockResolvedValue('TASKS_TEXT');
      vi.spyOn(api, 'readDeltaSpec').mockResolvedValue('DELTA_TEXT');
    });

    it('switches between artifact tabs', async () => {
      render(<SubIssueDetailScreen projectId="p1" subIssueId="s" />);
      // Proposal is the default — wait until the textarea shows its content.
      await waitFor(() => {
        const ta = screen.getByRole('textbox') as HTMLTextAreaElement;
        expect(ta.value).toBe('PROPOSAL_TEXT');
      });

      fireEvent.click(screen.getByRole('button', { name: 'design' }));
      await waitFor(() => {
        const ta = screen.getByRole('textbox') as HTMLTextAreaElement;
        expect(ta.value).toBe('DESIGN_TEXT');
      });

      fireEvent.click(screen.getByRole('button', { name: 'tasks' }));
      await waitFor(() => {
        const ta = screen.getByRole('textbox') as HTMLTextAreaElement;
        expect(ta.value).toBe('TASKS_TEXT');
      });
    });

    it('Save calls writeProposal when on proposal tab', async () => {
      const spy = vi.spyOn(api, 'writeProposal').mockResolvedValue({
        id: 'sc1',
        slug: 'x',
        status: 'drafting',
        deltaSpecPaths: [],
      } as never);
      render(<SubIssueDetailScreen projectId="p1" subIssueId="s" />);
      const textarea = await waitFor(() => {
        const ta = screen.getByRole('textbox') as HTMLTextAreaElement;
        expect(ta.value).toBe('PROPOSAL_TEXT');
        return ta;
      });
      fireEvent.change(textarea, { target: { value: 'EDITED' } });
      fireEvent.click(screen.getByRole('button', { name: /^Save$/ }));
      await waitFor(() => {
        expect(spy).toHaveBeenCalledWith('sc1', 'EDITED');
      });
    });

    it('delta tab shows existing capabilities + Add input', async () => {
      render(<SubIssueDetailScreen projectId="p1" subIssueId="s" />);
      // Wait for initial load to finish so we don't race.
      await waitFor(() => {
        const ta = screen.getByRole('textbox') as HTMLTextAreaElement;
        expect(ta.value).toBe('PROPOSAL_TEXT');
      });
      fireEvent.click(screen.getByRole('button', { name: 'delta' }));
      // Capability chips parsed from deltaSpecPaths.
      expect(screen.getByRole('button', { name: 'auth' })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'billing' })).toBeInTheDocument();
      // + Add input present.
      expect(screen.getByPlaceholderText('new capability')).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /\+ Add/ })).toBeInTheDocument();
    });
  });
});
