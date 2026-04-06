import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { PermissionSelector } from '../PermissionSelector';
import type { UnifiedPermissionPolicy } from '@my-claudia/shared';

describe('PermissionSelector', () => {
  const defaultOverride: Partial<UnifiedPermissionPolicy> = {
    enabled: true,
    profile: {
      fileRead: 'auto-approve',
      fileWrite: 'auto-approve',
      shellSafe: 'auto-approve',
      networkOps: 'auto-approve',
      destructiveOps: 'auto-approve',
      userQuestions: 'ask',
    },
  };

  it('should render without crashing', () => {
    render(
      <PermissionSelector
        value={null}
        onChange={() => {}}
      />
    );

    expect(screen.getByRole('button')).toBeInTheDocument();
  });

  it('should display current override when set', () => {
    render(
      <PermissionSelector
        value={defaultOverride}
        onChange={() => {}}
      />
    );

    // Should show some indication of the active preset
    expect(screen.getByRole('button')).toBeInTheDocument();
  });

  it('should show override styling when override is active', () => {
    const { container } = render(
      <PermissionSelector
        value={defaultOverride}
        onChange={() => {}}
      />
    );

    const button = container.querySelector('button');
    // When override is active, button shows text-primary styling
    expect(button).toHaveClass('text-primary');
  });

  it('should NOT show ring when using project default', () => {
    const { container } = render(
      <PermissionSelector
        value={null}
        onChange={() => {}}
      />
    );

    const button = container.querySelector('button');
    expect(button).not.toHaveClass('ring-2');
  });

  it('should open dropdown when clicked', () => {
    render(
      <PermissionSelector
        value={null}
        onChange={() => {}}
      />
    );

    fireEvent.click(screen.getByRole('button'));

    expect(screen.getByText('Session Permission Override')).toBeInTheDocument();
    // v3 presets: Read Only, Standard, Power User, Full Auto
    expect(screen.getAllByText(/Read Only/).length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText(/Standard/).length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText(/Power User/).length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText(/Full Auto/).length).toBeGreaterThanOrEqual(1);
  });

  it('should close dropdown when clicking outside', () => {
    render(
      <PermissionSelector
        value={null}
        onChange={() => {}}
      />
    );

    fireEvent.click(screen.getByRole('button'));
    expect(screen.getByText('Session Permission Override')).toBeInTheDocument();

    // Click outside
    fireEvent.mouseDown(document.body);

    expect(screen.queryByText('Session Permission Override')).not.toBeInTheDocument();
  });

  it('should call onChange with selected preset', () => {
    const handleChange = vi.fn();

    render(
      <PermissionSelector
        value={null}
        onChange={handleChange}
      />
    );

    fireEvent.click(screen.getByRole('button'));
    fireEvent.click(screen.getByText(/Power User/));

    expect(handleChange).toHaveBeenCalledWith(
      expect.objectContaining({
        profile: expect.objectContaining({
          shellSafe: 'auto-approve',
        }),
      })
    );
  });

  it('should call onChange with null when selecting project default', () => {
    const handleChange = vi.fn();

    render(
      <PermissionSelector
        value={defaultOverride}
        onChange={handleChange}
      />
    );

    fireEvent.click(screen.getByRole('button'));
    fireEvent.click(screen.getByText(/Project Default/));

    expect(handleChange).toHaveBeenCalledWith(null);
  });

  it('should be disabled when disabled prop is true', () => {
    render(
      <PermissionSelector
        value={null}
        onChange={() => {}}
        disabled={true}
      />
    );

    const button = screen.getByRole('button');
    expect(button).toBeDisabled();
  });

  it('should not open dropdown when disabled', () => {
    render(
      <PermissionSelector
        value={null}
        onChange={() => {}}
        disabled={true}
      />
    );

    fireEvent.click(screen.getByRole('button'));

    expect(screen.queryByText('Session Permission Override')).not.toBeInTheDocument();
  });

  it('should show temporary override info in footer', () => {
    render(
      <PermissionSelector
        value={null}
        onChange={() => {}}
      />
    );

    fireEvent.click(screen.getByRole('button'));

    expect(screen.getByText(/Session override is temporary/)).toBeInTheDocument();
  });
});
