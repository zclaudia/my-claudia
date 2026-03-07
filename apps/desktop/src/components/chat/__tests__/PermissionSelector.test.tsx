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

    // When no override, trigger button shows the project policy's trust level label
    const button = screen.getByRole('button');
    expect(button).toHaveAttribute('title', 'Moderate');
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
    // When override is active, button shows text-primary styling (not ring)
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
    expect(screen.getAllByText(/Conservative/).length).toBeGreaterThanOrEqual(1);
    // "Moderate" appears both in trigger button and dropdown option
    expect(screen.getAllByText(/Moderate/).length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText(/Aggressive/).length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText(/Full Trust/).length).toBeGreaterThanOrEqual(1);
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

    // "Aggressive" appears in both the trigger and the dropdown; find the dropdown option
    const aggressiveElements = screen.getAllByText(/Aggressive/);
    // The dropdown option button should have bg-primary/10 class
    const aggressiveOption = aggressiveElements
      .map(el => el.closest('button'))
      .find(btn => btn?.classList.contains('bg-primary/10'));
    expect(aggressiveOption).toBeTruthy();
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
      // Multiple elements may match (trigger + dropdown option), get all and click the last one (dropdown option)
      const options = screen.getAllByText(new RegExp(level.replace('_', ' '), 'i'));
      fireEvent.click(options[options.length - 1]);

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
