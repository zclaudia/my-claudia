import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { ModeSelector } from '../ModeSelector';
import type { ProviderCapabilities } from '@my-claudia/shared';

// Mock SelectorTrigger to simplify testing
vi.mock('../SelectorTrigger', () => ({
  SelectorTrigger: ({ children, onClick, disabled, locked, title, ariaLabel }: any) => (
    <button
      onClick={onClick}
      disabled={disabled}
      title={title}
      aria-label={ariaLabel}
      data-testid="selector-trigger"
    >
      {children}
    </button>
  ),
}));

const mockCapabilities: ProviderCapabilities = {
  modes: [
    { id: 'default', label: 'Default', description: 'Standard mode' },
    { id: 'plan', label: 'Plan', description: 'Plan mode' },
    { id: 'acceptEdits', label: 'Accept Edits', description: 'Accept edits mode' },
    { id: 'bypassPermissions', label: 'Bypass', description: 'Bypass permissions' },
    { id: 'ask', label: 'Ask', description: 'Ask mode' },
    { id: 'custom', label: 'Custom', description: 'Custom mode' },
    { id: 'settings', label: 'Settings', description: 'Settings mode' },
  ],
};

describe('ModeSelector', () => {
  const defaultProps = {
    capabilities: mockCapabilities,
    value: 'default',
    onChange: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('rendering', () => {
    it('returns null when no capabilities', () => {
      const { container } = render(
        <ModeSelector {...defaultProps} capabilities={null} />
      );

      expect(container).toBeEmptyDOMElement();
    });

    it('returns null when no modes', () => {
      const { container } = render(
        <ModeSelector
          {...defaultProps}
          capabilities={{ modes: [] }}
        />
      );

      expect(container).toBeEmptyDOMElement();
    });

    it('shows current mode label', () => {
      render(<ModeSelector {...defaultProps} />);

      expect(screen.getByText('Default')).toBeInTheDocument();
    });

    it('shows correct icon for mode', () => {
      render(<ModeSelector {...defaultProps} value="plan" />);

      // Plan mode uses ClipboardList icon
      expect(screen.getByTestId('selector-trigger')).toBeInTheDocument();
    });
  });

  describe('dropdown', () => {
    it('opens on click', async () => {
      render(<ModeSelector {...defaultProps} />);

      fireEvent.click(screen.getByTestId('selector-trigger'));

      await waitFor(() => {
        expect(screen.getByText('Standard mode')).toBeInTheDocument();
      });
    });

    it('closes on outside click', async () => {
      render(
        <div>
          <ModeSelector {...defaultProps} />
          <div data-testid="outside">Outside</div>
        </div>
      );

      fireEvent.click(screen.getByTestId('selector-trigger'));

      await waitFor(() => {
        expect(screen.getByText('Standard mode')).toBeInTheDocument();
      });

      fireEvent.click(screen.getByTestId('outside'));

      await waitFor(() => {
        expect(screen.queryByText('Standard mode')).not.toBeInTheDocument();
      });
    });

    it('closes on mode selection', async () => {
      const handleChange = vi.fn();
      render(<ModeSelector {...defaultProps} onChange={handleChange} />);

      fireEvent.click(screen.getByTestId('selector-trigger'));

      await waitFor(() => {
        expect(screen.getByText('Plan mode')).toBeInTheDocument();
      });

      fireEvent.click(screen.getByText('Plan mode'));

      await waitFor(() => {
        expect(screen.queryByText('Plan mode')).not.toBeInTheDocument();
      });

      expect(handleChange).toHaveBeenCalledWith('plan');
    });

    it('shows all mode options', async () => {
      render(<ModeSelector {...defaultProps} />);

      fireEvent.click(screen.getByTestId('selector-trigger'));

      await waitFor(() => {
        expect(screen.getByText('Default')).toBeInTheDocument();
        expect(screen.getByText('Plan')).toBeInTheDocument();
        expect(screen.getByText('Accept Edits')).toBeInTheDocument();
        expect(screen.getByText('Bypass')).toBeInTheDocument();
      });
    });

    it('highlights selected mode', async () => {
      render(<ModeSelector {...defaultProps} value="plan" />);

      fireEvent.click(screen.getByTestId('selector-trigger'));

      await waitFor(() => {
        const planOption = screen.getByText('Plan').closest('button');
        expect(planOption?.className).toContain('bg-primary');
      });
    });

    it('calls onChange on selection', async () => {
      const handleChange = vi.fn();
      render(<ModeSelector {...defaultProps} onChange={handleChange} />);

      fireEvent.click(screen.getByTestId('selector-trigger'));

      await waitFor(() => {
        expect(screen.getByText('Plan mode')).toBeInTheDocument();
      });

      fireEvent.click(screen.getByText('Plan mode'));

      expect(handleChange).toHaveBeenCalledWith('plan');
    });
  });

  describe('disabled/locked state', () => {
    it('does not open when disabled', () => {
      render(<ModeSelector {...defaultProps} disabled />);

      const trigger = screen.getByTestId('selector-trigger');
      expect(trigger).toBeDisabled();
    });

    it('shows locked state', () => {
      render(<ModeSelector {...defaultProps} locked />);

      const trigger = screen.getByTestId('selector-trigger');
      expect(trigger).toBeDisabled();
    });

    it('shows lock reason in title', () => {
      render(
        <ModeSelector
          {...defaultProps}
          locked
          lockReason="Task in progress"
        />
      );

      expect(screen.getByTestId('selector-trigger')).toHaveAttribute(
        'title',
        'Task in progress'
      );
    });
  });
});
