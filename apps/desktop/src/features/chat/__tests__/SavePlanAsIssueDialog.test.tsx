import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { SavePlanAsIssueDialog } from '../SavePlanAsIssueDialog';

describe('SavePlanAsIssueDialog', () => {
  it('pre-fills the title input with the supplied default', () => {
    render(
      <SavePlanAsIssueDialog
        defaultTitle="Refactor auth"
        onSave={vi.fn()}
        onCancel={vi.fn()}
      />,
    );
    const input = screen.getByLabelText(/title/i) as HTMLInputElement;
    expect(input.value).toBe('Refactor auth');
  });

  it('calls onSave with the (possibly edited) title when 保存 is clicked', () => {
    const onSave = vi.fn();
    render(
      <SavePlanAsIssueDialog
        defaultTitle="Refactor auth"
        onSave={onSave}
        onCancel={vi.fn()}
      />,
    );
    const input = screen.getByLabelText(/title/i) as HTMLInputElement;
    fireEvent.change(input, { target: { value: 'Different title' } });
    fireEvent.click(screen.getByRole('button', { name: /save/i }));
    expect(onSave).toHaveBeenCalledWith('Different title');
  });

  it('disables save when title is blank', () => {
    const onSave = vi.fn();
    render(
      <SavePlanAsIssueDialog defaultTitle="  " onSave={onSave} onCancel={vi.fn()} />,
    );
    const saveBtn = screen.getByRole('button', { name: /save/i });
    expect(saveBtn).toBeDisabled();
    fireEvent.click(saveBtn);
    expect(onSave).not.toHaveBeenCalled();
  });

  it('cancel invokes onCancel without saving', () => {
    const onCancel = vi.fn();
    const onSave = vi.fn();
    render(
      <SavePlanAsIssueDialog defaultTitle="x" onSave={onSave} onCancel={onCancel} />,
    );
    fireEvent.click(screen.getByRole('button', { name: /cancel/i }));
    expect(onCancel).toHaveBeenCalled();
    expect(onSave).not.toHaveBeenCalled();
  });

  it('shows a disabled spinner state when submitting=true', () => {
    render(
      <SavePlanAsIssueDialog
        defaultTitle="x"
        submitting
        onSave={vi.fn()}
        onCancel={vi.fn()}
      />,
    );
    expect(screen.getByRole('button', { name: /saving/i })).toBeDisabled();
  });
});
