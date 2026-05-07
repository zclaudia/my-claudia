import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { AttachmentDropZone } from '../components/AttachmentDropZone';

describe('AttachmentDropZone', () => {
  it('renders children inside the drop region', () => {
    render(
      <AttachmentDropZone onFiles={vi.fn()}>
        <span>drop here</span>
      </AttachmentDropZone>,
    );
    expect(screen.getByText('drop here')).toBeInTheDocument();
  });

  it('calls onFiles when files are dropped', () => {
    const onFiles = vi.fn();
    render(
      <AttachmentDropZone onFiles={onFiles}>
        <span>zone</span>
      </AttachmentDropZone>,
    );
    const region = screen.getByRole('region');
    const file = new File(['x'], 'x.png', { type: 'image/png' });

    fireEvent.dragOver(region, { dataTransfer: { types: ['Files'], files: [file] } });
    fireEvent.drop(region, { dataTransfer: { files: [file], types: ['Files'] } });

    expect(onFiles).toHaveBeenCalledWith([file]);
  });

  it('ignores non-file drags (e.g. text selection)', () => {
    const onFiles = vi.fn();
    render(
      <AttachmentDropZone onFiles={onFiles}>
        <span>zone</span>
      </AttachmentDropZone>,
    );
    const region = screen.getByRole('region');
    fireEvent.dragOver(region, { dataTransfer: { types: ['text/plain'] } });
    expect(region).toHaveAttribute('data-attachment-dropzone-active', 'false');
  });

  it('does nothing when disabled', () => {
    const onFiles = vi.fn();
    render(
      <AttachmentDropZone onFiles={onFiles} disabled>
        <span>zone</span>
      </AttachmentDropZone>,
    );
    const region = screen.getByRole('region');
    const file = new File(['x'], 'x.png');
    fireEvent.dragOver(region, { dataTransfer: { types: ['Files'] } });
    fireEvent.drop(region, { dataTransfer: { files: [file], types: ['Files'] } });
    expect(onFiles).not.toHaveBeenCalled();
  });
});
