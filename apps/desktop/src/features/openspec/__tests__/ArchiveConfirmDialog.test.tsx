// apps/desktop/src/features/openspec/__tests__/ArchiveConfirmDialog.test.tsx
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { ArchiveConfirmDialog } from '../components/ArchiveConfirmDialog.js';
import { useOpenSpecStore } from '../store.js';
import * as api from '../api.js';

function mkIssue() {
  return {
    id: 's',
    projectId: 'p1',
    title: 'X',
    status: 'reviewing',
    priority: 'medium',
    labels: [],
    type: 'implement',
    isAnonymous: false,
    specChangeId: 'sc1',
    createdAt: 0,
    updatedAt: 0,
  } as never;
}

describe('ArchiveConfirmDialog', () => {
  beforeEach(() => {
    useOpenSpecStore.setState({
      issuesByProject: { p1: [mkIssue()] },
      specChangesById: {
        sc1: {
          id: 'sc1',
          slug: 'x',
          deltaSpecPaths: ['openspec/changes/x/specs/auth/spec.md'],
        } as never,
      },
      executorsBySpecChange: {},
      corpusByProject: {},
      viewByProject: {},
    });
    vi.restoreAllMocks();
  });

  it('renders delta capability list', () => {
    render(<ArchiveConfirmDialog projectId="p1" subIssueId="s" onClose={() => {}} />);
    expect(screen.getByText('auth')).toBeInTheDocument();
  });

  it('successful archive shows confirmation + Done button', async () => {
    vi.spyOn(api, 'closeAndArchive').mockResolvedValue({
      issue: mkIssue(),
      archive: { ok: true, capabilities: [], archivedDir: '/tmp/archive' },
    } as never);
    render(<ArchiveConfirmDialog projectId="p1" subIssueId="s" onClose={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: 'Close & Archive' }));
    await waitFor(() => expect(screen.getByText(/Archive complete/i)).toBeInTheDocument());
    expect(screen.getByRole('button', { name: 'Done' })).toBeInTheDocument();
  });

  it('failed validation displays per-capability errors', async () => {
    vi.spyOn(api, 'closeAndArchive').mockResolvedValue({
      issue: mkIssue(),
      archive: {
        ok: false,
        validationErrors: [
          {
            capability: 'auth',
            issues: [
              'requirement[Login].scenario[Valid]: bodyLines empty',
              'requirement[Login]: missing RFC keyword',
            ],
          },
          { capability: 'billing', issues: ['delta is empty'] },
        ],
      },
    } as never);
    render(<ArchiveConfirmDialog projectId="p1" subIssueId="s" onClose={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: 'Close & Archive' }));
    await waitFor(() => expect(screen.getByText(/Validation failed/)).toBeInTheDocument());
    // 'auth' appears twice: once in the delta capability list at top of dialog,
    // once inside the validation errors panel. Both are expected.
    expect(screen.getAllByText('auth').length).toBeGreaterThanOrEqual(2);
    expect(screen.getByText('billing')).toBeInTheDocument();
    expect(screen.getByText(/bodyLines empty/)).toBeInTheDocument();
  });

  it('Close & Archive remains clickable after validation failure (user can retry)', async () => {
    vi.spyOn(api, 'closeAndArchive').mockResolvedValue({
      issue: mkIssue(),
      archive: {
        ok: false,
        validationErrors: [{ capability: 'auth', issues: ['x'] }],
      },
    } as never);
    render(<ArchiveConfirmDialog projectId="p1" subIssueId="s" onClose={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: 'Close & Archive' }));
    await waitFor(() => expect(screen.getByText(/Validation failed/)).toBeInTheDocument());
    expect(screen.getByRole('button', { name: 'Close & Archive' })).not.toBeDisabled();
  });
});
