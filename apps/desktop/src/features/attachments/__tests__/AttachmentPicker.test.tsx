import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { AttachmentPicker } from '../components/AttachmentPicker';

describe('AttachmentPicker', () => {
  it('renders default trigger and opens hidden file input on click', () => {
    const click = vi.fn();
    const onFiles = vi.fn();
    render(<AttachmentPicker onFiles={onFiles} />);

    const input = screen.getByTestId('attachment-picker-input') as HTMLInputElement;
    Object.defineProperty(input, 'click', { value: click });

    fireEvent.click(screen.getByRole('button', { name: /attach files/i }));
    expect(click).toHaveBeenCalledTimes(1);
  });

  it('forwards selected files to onFiles', () => {
    const onFiles = vi.fn();
    render(<AttachmentPicker onFiles={onFiles} />);

    const input = screen.getByTestId('attachment-picker-input') as HTMLInputElement;
    const file = new File(['x'], 'x.png', { type: 'image/png' });
    Object.defineProperty(input, 'files', { value: [file], configurable: true });
    fireEvent.change(input);

    expect(onFiles).toHaveBeenCalledWith([file]);
  });

  it('renders custom trigger when children supplied', () => {
    render(
      <AttachmentPicker onFiles={vi.fn()}>
        <span>custom trigger</span>
      </AttachmentPicker>,
    );
    expect(screen.getByText('custom trigger')).toBeInTheDocument();
  });

  it('does nothing when disabled and clicked', () => {
    const onFiles = vi.fn();
    render(<AttachmentPicker onFiles={onFiles} disabled />);

    const input = screen.getByTestId('attachment-picker-input') as HTMLInputElement;
    const click = vi.fn();
    Object.defineProperty(input, 'click', { value: click });

    fireEvent.click(screen.getByRole('button', { name: /attach files/i }));
    expect(click).not.toHaveBeenCalled();
  });
});
