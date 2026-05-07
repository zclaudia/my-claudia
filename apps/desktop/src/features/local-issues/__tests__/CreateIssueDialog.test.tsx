import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import type { LocalIssue } from '@my-claudia/shared';

const mockCreate = vi.fn().mockResolvedValue({
  id: 'created-1',
  projectId: 'p',
  title: 'New',
  description: undefined,
  status: 'open',
  priority: 'medium',
  labels: [],
  createdAt: 0,
  updatedAt: 0,
} satisfies LocalIssue);
const mockUpdate = vi.fn().mockResolvedValue(undefined);

vi.mock('../store', () => ({
  useLocalIssueStore: () => ({
    createIssue: mockCreate,
    updateIssue: mockUpdate,
  }),
}));

vi.mock('../../../hooks/useAndroidBack', () => ({
  useAndroidBack: vi.fn(),
}));

const mockUseAttachments = {
  items: [] as unknown[],
  isLoading: false,
  reload: vi.fn(),
  upload: vi.fn().mockResolvedValue({ id: 'a1' }),
  remove: vi.fn().mockResolvedValue(undefined),
  rename: vi.fn(),
};
const mockUploadAttachment = vi.fn().mockResolvedValue({ id: 'a1' });

vi.mock('../../attachments', async () => {
  const actual = await vi.importActual<typeof import('../../attachments')>('../../attachments');
  return {
    ...actual,
    uploadAttachment: (...args: unknown[]) => mockUploadAttachment(...args),
    useAttachments: () => mockUseAttachments,
  };
});

import { CreateIssueDialog } from '../components/CreateIssueDialog';

beforeEach(() => {
  mockCreate.mockClear();
  mockUpdate.mockClear();
  mockUploadAttachment.mockClear();
  mockUploadAttachment.mockResolvedValue({ id: 'a1' });
  mockUseAttachments.upload.mockClear();
  mockUseAttachments.remove.mockClear();
  mockUseAttachments.items = [];
});

describe('CreateIssueDialog (with attachments)', () => {
  it('renders the new-issue title and Attach button', () => {
    render(<CreateIssueDialog projectId="p" onClose={vi.fn()} />);
    expect(screen.getByText('New Issue')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /add attachment/i })).toBeInTheDocument();
    expect(screen.queryByTestId('pending-attachment')).not.toBeInTheDocument();
  });

  it('queues pending attachments via the hidden file input', async () => {
    render(<CreateIssueDialog projectId="p" onClose={vi.fn()} />);
    const input = screen.getByTestId('attachment-picker-input') as HTMLInputElement;
    Object.defineProperty(input, 'files', {
      value: [
        new File(['x'], 'a.png', { type: 'image/png' }),
        new File(['y'], 'b.txt', { type: 'text/plain' }),
      ],
      configurable: true,
    });
    fireEvent.change(input);

    await waitFor(() => {
      expect(screen.getAllByTestId('pending-attachment')).toHaveLength(2);
    });
  });

  it('uploads queued files AFTER createIssue resolves', async () => {
    const onClose = vi.fn();
    render(<CreateIssueDialog projectId="p" onClose={onClose} />);

    fireEvent.change(screen.getByPlaceholderText('Issue title'), { target: { value: 'My issue' } });

    const input = screen.getByTestId('attachment-picker-input') as HTMLInputElement;
    Object.defineProperty(input, 'files', {
      value: [new File(['x'], 'a.png', { type: 'image/png' })],
      configurable: true,
    });
    fireEvent.change(input);

    fireEvent.click(screen.getByRole('button', { name: /^create$/i }));

    await waitFor(() => expect(mockCreate).toHaveBeenCalled());
    await waitFor(() => expect(mockUploadAttachment).toHaveBeenCalled());
    expect(mockUploadAttachment).toHaveBeenCalledWith(
      'local_issue',
      'created-1',
      expect.any(File),
    );
    // createIssue must run before the upload.
    const createOrder = mockCreate.mock.invocationCallOrder[0];
    const uploadOrder = mockUploadAttachment.mock.invocationCallOrder[0];
    expect(createOrder).toBeLessThan(uploadOrder);
    await waitFor(() => expect(onClose).toHaveBeenCalled());
  });

  it('does NOT upload attachments when in edit mode (uses live hook directly)', async () => {
    const editIssue: LocalIssue = {
      id: 'iss-1',
      projectId: 'p',
      title: 'old',
      description: undefined,
      status: 'open',
      priority: 'medium',
      labels: [],
      createdAt: 0,
      updatedAt: 0,
    };
    render(<CreateIssueDialog projectId="p" onClose={vi.fn()} editIssue={editIssue} />);

    const input = screen.getByTestId('attachment-picker-input') as HTMLInputElement;
    Object.defineProperty(input, 'files', {
      value: [new File(['x'], 'a.png', { type: 'image/png' })],
      configurable: true,
    });
    fireEvent.change(input);

    await waitFor(() => expect(mockUseAttachments.upload).toHaveBeenCalled());
    expect(mockUploadAttachment).not.toHaveBeenCalled();
    // Edit mode shouldn't queue anything visually either.
    expect(screen.queryByTestId('pending-attachment')).not.toBeInTheDocument();
  });

  it('removes a pending attachment when X clicked', async () => {
    render(<CreateIssueDialog projectId="p" onClose={vi.fn()} />);
    const input = screen.getByTestId('attachment-picker-input') as HTMLInputElement;
    Object.defineProperty(input, 'files', {
      value: [new File(['x'], 'a.txt', { type: 'text/plain' })],
      configurable: true,
    });
    fireEvent.change(input);

    await waitFor(() => screen.getByTestId('pending-attachment'));
    fireEvent.click(screen.getByRole('button', { name: /remove a\.txt/i }));
    expect(screen.queryByTestId('pending-attachment')).not.toBeInTheDocument();
  });
});
