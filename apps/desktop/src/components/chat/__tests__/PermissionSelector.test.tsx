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

    // Trigger button shows the effective trust level name when project policy is enabled
    expect(screen.getByText(/Moderate/)).toBeInTheDocument();
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

  it('should show override styling when override is active', () => {
    const { container } = render(
      <PermissionSelector
        value={defaultOverride}
        onChange={() => {}}
        projectPolicy={mockProjectPolicy}
      />
    );

    const button = container.querySelector('button');
    // Override active: trigger text is styled with primary color
    expect(button).toHaveClass('text-primary');
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
    // "Moderate" appears in both trigger and dropdown option
    expect(screen.getAllByText(/Moderate/).length).toBeGreaterThanOrEqual(2);
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

    fireEvent.click(screen.getAllByRole('button')[0]);

    // "Aggressive" appears in trigger and dropdown; get the one inside the dropdown option
    const aggressiveElements = screen.getAllByText(/Aggressive/);
    const aggressiveOption = aggressiveElements[aggressiveElements.length - 1].closest('button');
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

    fireEvent.click(screen.getAllByRole('button')[0]);

    for (const level of trustLevels) {
      const matches = screen.getAllByText(new RegExp(level.replace('_', ' '), 'i'));
      // Click the last match (dropdown option, not trigger)
      fireEvent.click(matches[matches.length - 1]);

      expect(handleChange).toHaveBeenCalledWith(
        expect.objectContaining({
          enabled: true,
          trustLevel: level,
        })
      );

      handleChange.mockClear();

      // Reopen dropdown for next iteration
      if (level !== trustLevels[trustLevels.length - 1]) {
        fireEvent.click(screen.getAllByRole('button')[0]);
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
