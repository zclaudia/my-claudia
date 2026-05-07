import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import type { Attachment } from '@my-claudia/shared';

vi.mock('../api', () => ({
  fetchAttachmentBlobUrl: vi.fn().mockResolvedValue('blob:http://x/abc'),
}));

import { AttachmentThumbnail } from '../components/AttachmentThumbnail';
import { fetchAttachmentBlobUrl } from '../api';

const att = (overrides: Partial<Attachment> = {}): Attachment => ({
  id: 'a1',
  ownerKind: 'local_issue',
  ownerId: 'issue-1',
  name: 'pic.png',
  mimeType: 'image/png',
  size: 1234,
  kind: 'image',
  sortOrder: 0,
  createdAt: 1000,
  ...overrides,
});

beforeEach(() => {
  (fetchAttachmentBlobUrl as any).mockClear();
  Object.defineProperty(URL, 'createObjectURL', {
    value: vi.fn(() => 'blob:created'),
    configurable: true,
  });
  Object.defineProperty(URL, 'revokeObjectURL', {
    value: vi.fn(),
    configurable: true,
  });
});

describe('AttachmentThumbnail', () => {
  it('renders image preview when kind is image', async () => {
    render(<AttachmentThumbnail attachment={att()} />);
    await waitFor(() => {
      expect(screen.getByRole('img', { name: 'pic.png' })).toBeInTheDocument();
    });
    expect(fetchAttachmentBlobUrl).toHaveBeenCalledWith('a1');
  });

  it('renders icon for non-image kinds and skips blob fetch', () => {
    render(
      <AttachmentThumbnail
        attachment={att({ id: 'doc-1', kind: 'document', name: 'spec.pdf' })}
      />,
    );
    expect(screen.queryByRole('img')).not.toBeInTheDocument();
    expect(fetchAttachmentBlobUrl).not.toHaveBeenCalled();
  });

  it('fires onRemove when the X button is clicked', async () => {
    const onRemove = vi.fn();
    render(<AttachmentThumbnail attachment={att()} onRemove={onRemove} />);
    await waitFor(() => screen.getByRole('img'));
    fireEvent.click(screen.getByRole('button', { name: /remove pic\.png/i }));
    expect(onRemove).toHaveBeenCalledWith('a1');
  });

  it('fires onClick on outer button when thumbnail tapped', async () => {
    const onClick = vi.fn();
    render(<AttachmentThumbnail attachment={att()} onClick={onClick} />);
    await waitFor(() => screen.getByRole('img'));
    fireEvent.click(screen.getByRole('button', { name: /open pic\.png/i }));
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it('shows formatted file size', () => {
    render(<AttachmentThumbnail attachment={att({ size: 2048, kind: 'file' })} />);
    expect(screen.getByText('2.0 KB')).toBeInTheDocument();
  });

  it('renders the slotTopLeft node when provided (used by sortable wrapper)', () => {
    render(
      <AttachmentThumbnail
        attachment={att({ id: 'doc-1', kind: 'document', name: 'spec.pdf' })}
        slotTopLeft={<span data-testid="custom-slot">handle</span>}
      />,
    );
    expect(screen.getByTestId('custom-slot')).toBeInTheDocument();
  });
});
