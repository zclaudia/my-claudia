// apps/desktop/src/features/openspec/__tests__/NewIssueDialog.test.tsx
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { NewIssueDialog } from '../components/NewIssueDialog.js';
import { useOpenSpecStore } from '../store.js';
import * as api from '../api.js';

describe('NewIssueDialog', () => {
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

  it('defaults to epic when no parentEpicId', () => {
    render(<NewIssueDialog projectId="p1" onClose={() => {}} />);
    expect((screen.getByRole('combobox') as HTMLSelectElement).value).toBe('epic');
  });

  it('defaults to implement and hides epic option when parentEpicId given', () => {
    render(<NewIssueDialog projectId="p1" parentEpicId="e1" onClose={() => {}} />);
    const select = screen.getByRole('combobox') as HTMLSelectElement;
    expect(select.value).toBe('implement');
    expect(Array.from(select.options).map((o) => o.value)).not.toContain('epic');
  });

  it('submits epic → calls createEpic and closes', async () => {
    const onClose = vi.fn();
    const createSpy = vi.spyOn(api, 'createEpic').mockResolvedValue({
      id: 'e1',
      projectId: 'p1',
      title: 'My Epic',
      status: 'open',
      labels: [],
      createdAt: 0,
      updatedAt: 0,
    });
    render(<NewIssueDialog projectId="p1" onClose={onClose} />);
    fireEvent.change(screen.getByPlaceholderText('Epic title'), {
      target: { value: 'My Epic' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Create' }));
    await waitFor(() =>
      expect(createSpy).toHaveBeenCalledWith({ projectId: 'p1', title: 'My Epic' }),
    );
    expect(onClose).toHaveBeenCalled();
  });

  it('submits sub-issue → calls createSubIssue and stores spec_change', async () => {
    const onClose = vi.fn();
    const createSpy = vi.spyOn(api, 'createSubIssue').mockResolvedValue({
      issue: { id: 's1', projectId: 'p1', type: 'bug', title: 'B', status: 'open' } as never,
      specChange: {
        id: 'sc1',
        projectId: 'p1',
        subIssueId: 's1',
        slug: 'b',
        title: 'B',
        status: 'drafting',
        deltaSpecPaths: [],
      } as never,
    });
    render(<NewIssueDialog projectId="p1" parentEpicId="e1" onClose={onClose} />);
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'bug' } });
    fireEvent.change(screen.getByPlaceholderText('Issue title'), { target: { value: 'B' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create' }));
    await waitFor(() =>
      expect(createSpy).toHaveBeenCalledWith({
        projectId: 'p1',
        type: 'bug',
        title: 'B',
        epicId: 'e1',
      }),
    );
    expect(useOpenSpecStore.getState().specChangesById.sc1).toBeDefined();
  });

  it('Create button is disabled when title empty', () => {
    render(<NewIssueDialog projectId="p1" onClose={() => {}} />);
    expect(screen.getByRole('button', { name: 'Create' })).toBeDisabled();
  });

  it('shows error and stays open on failure', async () => {
    vi.spyOn(api, 'createEpic').mockRejectedValue(new Error('boom'));
    const onClose = vi.fn();
    render(<NewIssueDialog projectId="p1" onClose={onClose} />);
    fireEvent.change(screen.getByPlaceholderText('Epic title'), { target: { value: 'F' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create' }));
    await waitFor(() => expect(screen.getByText(/Error: boom/)).toBeInTheDocument());
    expect(onClose).not.toHaveBeenCalled();
  });
});
