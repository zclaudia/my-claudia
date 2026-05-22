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

  it('defaults to feature when no parentFeatureId', () => {
    render(<NewIssueDialog projectId="p1" onClose={() => {}} />);
    expect((screen.getByRole('combobox') as HTMLSelectElement).value).toBe('feature');
  });

  it('defaults to implement and hides feature option when parentFeatureId given', () => {
    render(<NewIssueDialog projectId="p1" parentFeatureId="f1" onClose={() => {}} />);
    const select = screen.getByRole('combobox') as HTMLSelectElement;
    expect(select.value).toBe('implement');
    expect(Array.from(select.options).map((o) => o.value)).not.toContain('feature');
  });

  it('submits feature → calls createFeature + upserts + closes', async () => {
    const onClose = vi.fn();
    const createSpy = vi.spyOn(api, 'createFeature').mockResolvedValue({
      id: 'f1',
      projectId: 'p1',
      title: 'My Feature',
      type: 'feature',
      status: 'open',
    } as never);
    render(<NewIssueDialog projectId="p1" onClose={onClose} />);
    fireEvent.change(screen.getByPlaceholderText('Feature title'), {
      target: { value: 'My Feature' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Create' }));
    await waitFor(() =>
      expect(createSpy).toHaveBeenCalledWith({ projectId: 'p1', title: 'My Feature' }),
    );
    expect(onClose).toHaveBeenCalled();
    expect(useOpenSpecStore.getState().issuesByProject.p1).toBeDefined();
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
    render(<NewIssueDialog projectId="p1" parentFeatureId="f1" onClose={onClose} />);
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'bug' } });
    fireEvent.change(screen.getByPlaceholderText('Change title'), { target: { value: 'B' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create' }));
    await waitFor(() =>
      expect(createSpy).toHaveBeenCalledWith({
        projectId: 'p1',
        type: 'bug',
        title: 'B',
        parentIssueId: 'f1',
      }),
    );
    expect(useOpenSpecStore.getState().specChangesById.sc1).toBeDefined();
  });

  it('Create button is disabled when title empty', () => {
    render(<NewIssueDialog projectId="p1" onClose={() => {}} />);
    expect(screen.getByRole('button', { name: 'Create' })).toBeDisabled();
  });

  it('shows error and stays open on failure', async () => {
    vi.spyOn(api, 'createFeature').mockRejectedValue(new Error('boom'));
    const onClose = vi.fn();
    render(<NewIssueDialog projectId="p1" onClose={onClose} />);
    fireEvent.change(screen.getByPlaceholderText('Feature title'), { target: { value: 'F' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create' }));
    await waitFor(() => expect(screen.getByText(/Error: boom/)).toBeInTheDocument());
    expect(onClose).not.toHaveBeenCalled();
  });
});
