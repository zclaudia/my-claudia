import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import type { Attachment } from '@my-claudia/shared';

vi.mock('../api', () => ({
  fetchAttachmentBlobUrl: vi.fn().mockResolvedValue('blob:http://x/abc'),
  downloadAttachment: vi.fn().mockResolvedValue(undefined),
}));

import { AttachmentList } from '../components/AttachmentList';
import { downloadAttachment } from '../api';

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
  (downloadAttachment as any).mockClear();
});

describe('AttachmentList', () => {
  it('renders nothing without items and no emptyText', () => {
    const { container } = render(<AttachmentList items={[]} />);
    expect(container.firstChild).toBeNull();
  });

  it('renders empty placeholder when items empty', () => {
    render(<AttachmentList items={[]} emptyText="No attachments" />);
    expect(screen.getByText('No attachments')).toBeInTheDocument();
  });

  it('renders a thumbnail per item', async () => {
    render(
      <AttachmentList
        items={[
          att({ id: 'a' }),
          att({ id: 'b', kind: 'document', mimeType: 'application/pdf' }),
        ]}
      />,
    );
    expect(screen.getAllByTestId('attachment-thumbnail')).toHaveLength(2);
    await waitFor(() => screen.getByRole('img', { name: 'pic.png' }));
  });

  it('opens lightbox when image thumbnail is clicked', async () => {
    render(<AttachmentList items={[att()]} />);
    await waitFor(() => screen.getByRole('img', { name: 'pic.png' }));
    fireEvent.click(screen.getByRole('button', { name: /open pic\.png/i }));

    await waitFor(() =>
      expect(screen.getByRole('dialog', { name: /preview pic\.png/i })).toBeInTheDocument(),
    );
    // Wait for lightbox's own image src effect to settle to avoid act() warnings.
    await waitFor(() =>
      expect(screen.getAllByRole('img', { name: 'pic.png' }).length).toBeGreaterThanOrEqual(2),
    );
  });

  it('downloads when a non-image thumbnail is clicked', () => {
    render(
      <AttachmentList
        items={[att({ id: 'doc-1', kind: 'document', mimeType: 'application/pdf', name: 'a.pdf' })]}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: /open a\.pdf/i }));
    expect(downloadAttachment).toHaveBeenCalledWith('doc-1', 'a.pdf');
  });

  it('does not render drag handles in static mode', () => {
    // Use non-image kind to skip useAttachmentSrc's async effect noise.
    const docs = [
      att({ id: 'a', kind: 'document', mimeType: 'application/pdf' }),
      att({ id: 'b', kind: 'document', mimeType: 'application/pdf' }),
    ];
    render(<AttachmentList items={docs} />);
    expect(screen.queryAllByTestId('attachment-drag-handle')).toHaveLength(0);
  });

  it('renders drag handles per item when sortable + ownerKind/Id are provided', () => {
    const docs = [
      att({ id: 'a', kind: 'document', mimeType: 'application/pdf' }),
      att({ id: 'b', kind: 'document', mimeType: 'application/pdf' }),
    ];
    render(
      <AttachmentList items={docs} sortable ownerKind="local_issue" ownerId="issue-1" />,
    );
    expect(screen.getAllByTestId('attachment-drag-handle')).toHaveLength(2);
  });

  it('falls back to static rendering when sortable is true but owner missing', () => {
    render(
      <AttachmentList
        items={[att({ id: 'a', kind: 'document', mimeType: 'application/pdf' })]}
        sortable
      />,
    );
    // No owner => can't persist order => render static (no handles).
    expect(screen.queryAllByTestId('attachment-drag-handle')).toHaveLength(0);
  });
});
