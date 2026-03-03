import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { PermissionSelector } from '../PermissionSelector';
import type { AgentPermissionPolicy } from '@my-claudia/shared';

describe('PermissionSelector', () => {
  const mockProjectPolicy: AgentPermissionPolicy = {
    enabled: true,
    trustLevel: 'moderate',
    customRules: [],
    escalateAlways: ['AskUserQuestion', 'ExitPlanMode'],
  };

  const defaultOverride = {
    enabled: true,
    trustLevel: 'aggressive' as const,
    customRules: [],
    escalateAlways: ['AskUserQuestion', 'ExitPlanMode'],
  };

  it('should render without crashing', () => {
    render(
      <PermissionSelector
        value={null}
        onChange={() => {}}
        projectPolicy={mockProjectPolicy}
      />
    );

    expect(screen.getByRole('button')).toBeInTheDocument();
  });

  it('should display project default when no override', () => {
    render(
      <PermissionSelector
        value={null}
        onChange={() => {}}
        projectPolicy={mockProjectPolicy}
      />
    );

    expect(screen.getByText(/Project Default/)).toBeInTheDocument();
  });

  it('should display current override when set', () => {
    render(
      <PermissionSelector
        value={defaultOverride}
        onChange={() => {}}
        projectPolicy={mockProjectPolicy}
      />
    );

    expect(screen.getByText(/Aggressive/)).toBeInTheDocument();
  });

  it('should show ring when override is active', () => {
    const { container } = render(
      <PermissionSelector
        value={defaultOverride}
        onChange={() => {}}
        projectPolicy={mockProjectPolicy}
      />
    );

    const button = container.querySelector('button');
    expect(button).toHaveClass('ring-2');
    expect(button).toHaveClass('ring-primary/30');
  });

  it('should NOT show ring when using project default', () => {
    const { container } = render(
      <PermissionSelector
        value={null}
        onChange={() => {}}
        projectPolicy={mockProjectPolicy}
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
        projectPolicy={mockProjectPolicy}
      />
    );

    fireEvent.click(screen.getByRole('button'));

    expect(screen.getByText('Session Permission Override')).toBeInTheDocument();
    expect(screen.getByText(/Conservative/)).toBeInTheDocument();
    expect(screen.getByText(/Moderate/)).toBeInTheDocument();
    expect(screen.getByText(/Aggressive/)).toBeInTheDocument();
    expect(screen.getByText(/Full Trust/)).toBeInTheDocument();
  });

  it('should close dropdown when clicking outside', () => {
    render(
      <PermissionSelector
        value={null}
        onChange={() => {}}
        projectPolicy={mockProjectPolicy}
      />
    );

    fireEvent.click(screen.getByRole('button'));
    expect(screen.getByText('Session Permission Override')).toBeInTheDocument();

    // Click outside
    fireEvent.mouseDown(document.body);

    expect(screen.queryByText('Session Permission Override')).not.toBeInTheDocument();
  });

  it('should call onChange with selected trust level', () => {
    const handleChange = vi.fn();

    render(
      <PermissionSelector
        value={null}
        onChange={handleChange}
        projectPolicy={mockProjectPolicy}
      />
    );

    fireEvent.click(screen.getByRole('button'));
    fireEvent.click(screen.getByText(/Aggressive/));

    expect(handleChange).toHaveBeenCalledWith(
      expect.objectContaining({
        enabled: true,
        trustLevel: 'aggressive',
        customRules: [],
        escalateAlways: ['AskUserQuestion', 'ExitPlanMode'],
      })
    );
  });

  it('should call onChange with null when selecting project default', () => {
    const handleChange = vi.fn();

    render(
      <PermissionSelector
        value={defaultOverride}
        onChange={handleChange}
        projectPolicy={mockProjectPolicy}
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
        projectPolicy={mockProjectPolicy}
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
        projectPolicy={mockProjectPolicy}
        disabled={true}
      />
    );

    fireEvent.click(screen.getByRole('button'));

    expect(screen.queryByText('Session Permission Override')).not.toBeInTheDocument();
  });

  it('should highlight selected trust level', () => {
    render(
      <PermissionSelector
        value={defaultOverride}
        onChange={() => {}}
        projectPolicy={mockProjectPolicy}
      />
    );

    fireEvent.click(screen.getByRole('button'));

    const aggressiveOption = screen.getByText(/Aggressive/).closest('button');
    expect(aggressiveOption).toHaveClass('bg-primary/10');
  });

  it('should highlight project default when no override', () => {
    render(
      <PermissionSelector
        value={null}
        onChange={() => {}}
        projectPolicy={mockProjectPolicy}
      />
    );

    fireEvent.click(screen.getByRole('button'));

    const defaultOption = screen.getByText(/Project Default/).closest('button');
    expect(defaultOption).toHaveClass('bg-primary/10');
  });

  it('should display project policy info in project default option', () => {
    render(
      <PermissionSelector
        value={null}
        onChange={() => {}}
        projectPolicy={mockProjectPolicy}
      />
    );

    fireEvent.click(screen.getByRole('button'));

    expect(screen.getByText(/Use project setting \(moderate\)/)).toBeInTheDocument();
  });

  it('should show temporary override info in footer', () => {
    render(
      <PermissionSelector
        value={null}
        onChange={() => {}}
        projectPolicy={mockProjectPolicy}
      />
    );

    fireEvent.click(screen.getByRole('button'));

    expect(screen.getByText(/Session override is temporary/)).toBeInTheDocument();
  });

  it('should handle all trust levels', () => {
    const handleChange = vi.fn();
    const trustLevels = ['conservative', 'moderate', 'aggressive', 'full_trust'] as const;

    render(
      <PermissionSelector
        value={null}
        onChange={handleChange}
        projectPolicy={mockProjectPolicy}
      />
    );

    fireEvent.click(screen.getByRole('button'));

    for (const level of trustLevels) {
      const option = screen.getByText(new RegExp(level.replace('_', ' '), 'i'));
      fireEvent.click(option);

      expect(handleChange).toHaveBeenCalledWith(
        expect.objectContaining({
          enabled: true,
          trustLevel: level,
        })
      );

      handleChange.mockClear();

      // Reopen dropdown for next iteration
      if (level !== trustLevels[trustLevels.length - 1]) {
        fireEvent.click(screen.getByRole('button'));
      }
    }
  });

  it('should handle disabled project policy', () => {
    const disabledPolicy: AgentPermissionPolicy = {
      ...mockProjectPolicy,
      enabled: false,
    };

    render(
      <PermissionSelector
        value={null}
        onChange={() => {}}
        projectPolicy={disabledPolicy}
      />
    );

    fireEvent.click(screen.getByRole('button'));

    expect(screen.getByText(/Ask for all permissions/)).toBeInTheDocument();
  });

  it('should handle null project policy', () => {
    render(
      <PermissionSelector
        value={null}
        onChange={() => {}}
        projectPolicy={null}
      />
    );

    expect(screen.getByRole('button')).toBeInTheDocument();
  });
});
