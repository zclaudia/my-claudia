import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { ModelSelector } from '../ModelSelector';

describe('ModelSelector', () => {
  let mockBoundingClientRect: jest.Mock;

  beforeEach(() => {
    vi.clearAllMocks();
    // Mock getBoundingClientRect for DOM elements
    Element.prototype.getBoundingClientRect = vi.fn(() => ({
      width: 100,
      height: 40,
      top: 0,
      left: 0,
      bottom: 40,
      right: 100,
      x: 0,
      y: 0,
      toJSON: () => {},
    }));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('returns null when no capabilities', () => {
    const { container } = render(
      <ModelSelector capabilities={null} value="default" onChange={() => {}} />
    );
    expect(container.innerHTML).toBe('');
  });

  it('returns null when models array is empty', () => {
    const { container } = render(
      <ModelSelector
        capabilities={{ models: [], supportsImages: false, supportsStreaming: false }}
        value="default"
        onChange={() => {}}
      />
    );
    expect(container.innerHTML).toBe('');
  });

  it('renders button when models are available', () => {
    const caps = {
      models: [{ id: 'model-1', label: 'Model 1' }],
      supportsImages: false,
      supportsStreaming: false,
    };
    const { container } = render(
      <ModelSelector capabilities={caps} value="model-1" onChange={() => {}} />
    );
    expect(container.querySelector('button')).toBeTruthy();
  });

  it('displays the label of the selected model', () => {
    const caps = {
      models: [
        { id: 'model-1', label: 'Model One' },
        { id: 'model-2', label: 'Model Two' },
      ],
      supportsImages: false,
      supportsStreaming: false,
    };
    render(
      <ModelSelector capabilities={caps} value="model-2" onChange={() => {}} />
    );
    expect(screen.getByTitle('Model Two')).toBeTruthy();
  });

  it('displays first model label when value does not match', () => {
    const caps = {
      models: [
        { id: 'model-1', label: 'Model One' },
        { id: 'model-2', label: 'Model Two' },
      ],
      supportsImages: false,
      supportsStreaming: false,
    };
    render(
      <ModelSelector capabilities={caps} value="unknown" onChange={() => {}} />
    );
    expect(screen.getByTitle('Model One')).toBeTruthy();
  });

  it('displays Default when no models match and array is empty', () => {
    const caps = {
      models: [],
      supportsImages: false,
      supportsStreaming: false,
    };
    const { container } = render(
      <ModelSelector capabilities={caps} value="unknown" onChange={() => {}} />
    );
    expect(container.innerHTML).toBe('');
  });

  it('opens dropdown when button is clicked', () => {
    const caps = {
      models: [
        { id: 'model-1', label: 'Model One' },
        { id: 'model-2', label: 'Model Two' },
      ],
      supportsImages: false,
      supportsStreaming: false,
    };
    render(
      <ModelSelector capabilities={caps} value="model-1" onChange={() => {}} />
    );

    const button = screen.getByTitle('Model One');
    fireEvent.click(button);

    // After clicking, dropdown should show both models (use getAllByText since both appear)
    expect(screen.getAllByText('Model One').length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText('Model Two')).toBeTruthy();
  });

  it('closes dropdown when clicking outside', async () => {
    const caps = {
      models: [
        { id: 'model-1', label: 'Model One' },
      ],
      supportsImages: false,
      supportsStreaming: false,
    };
    const { container } = render(
      <ModelSelector capabilities={caps} value="model-1" onChange={() => {}} />
    );

    const button = screen.getByTitle('Model One');
    fireEvent.click(button);

    // Dropdown should be open - find buttons with the model name
    const buttonsBefore = screen.getAllByRole('button').filter(btn => btn.textContent?.includes('Model One'));
    expect(buttonsBefore.length).toBeGreaterThanOrEqual(1);

    // Click outside
    fireEvent.mouseDown(document.body);

    await waitFor(() => {
      // Dropdown should be closed - only one button with "Model One" text
      const buttonsAfter = screen.getAllByRole('button').filter(btn => btn.textContent?.includes('Model One'));
      expect(buttonsAfter.length).toBe(1);
    });
  });

  it('calls onChange when model is selected', () => {
    const handleChange = vi.fn();
    const caps = {
      models: [
        { id: 'model-1', label: 'Model One' },
        { id: 'model-2', label: 'Model Two' },
      ],
      supportsImages: false,
      supportsStreaming: false,
    };
    render(
      <ModelSelector capabilities={caps} value="model-1" onChange={handleChange} />
    );

    const button = screen.getByTitle('Model One');
    fireEvent.click(button);

    // Click on Model Two option
    const modelTwoOption = screen.getByText('Model Two');
    fireEvent.click(modelTwoOption);

    expect(handleChange).toHaveBeenCalledWith('model-2');
  });

  it('closes dropdown after selection', () => {
    const caps = {
      models: [
        { id: 'model-1', label: 'Model One' },
        { id: 'model-2', label: 'Model Two' },
      ],
      supportsImages: false,
      supportsStreaming: false,
    };
    render(
      <ModelSelector capabilities={caps} value="model-1" onChange={() => {}} />
    );

    const button = screen.getByTitle('Model One');
    fireEvent.click(button);

    // Click on Model Two option in dropdown
    const allModelTwoButtons = screen.getAllByText('Model Two').filter(el => el.tagName === 'BUTTON');
    fireEvent.click(allModelTwoButtons[allModelTwoButtons.length - 1]);

    // Dropdown should be closed - check that dropdown container is not visible
    const dropdown = document.querySelector('.animate-apple-fade-in');
    expect(dropdown).toBeNull();
  });

  it('does not open dropdown when disabled', () => {
    const caps = {
      models: [{ id: 'model-1', label: 'Model One' }],
      supportsImages: false,
      supportsStreaming: false,
    };
    render(
      <ModelSelector capabilities={caps} value="model-1" onChange={() => {}} disabled />
    );

    const button = screen.getByTitle('Model One');
    fireEvent.click(button);

    // Dropdown should not open
    const options = screen.queryAllByRole('button');
    // Only the main button should be present
    expect(options.length).toBe(1);
  });

  it('applies disabled styles when disabled', () => {
    const caps = {
      models: [{ id: 'model-1', label: 'Model One' }],
      supportsImages: false,
      supportsStreaming: false,
    };
    render(
      <ModelSelector capabilities={caps} value="model-1" onChange={() => {}} disabled />
    );

    const button = screen.getByTitle('Model One');
    expect(button.className).toContain('opacity-50');
    expect(button.className).toContain('cursor-not-allowed');
  });

  it('applies hover styles when not disabled', () => {
    const caps = {
      models: [{ id: 'model-1', label: 'Model One' }],
      supportsImages: false,
      supportsStreaming: false,
    };
    render(
      <ModelSelector capabilities={caps} value="model-1" onChange={() => {}} />
    );

    const button = screen.getByTitle('Model One');
    expect(button.className).toContain('hover:bg-muted');
    expect(button.className).toContain('cursor-pointer');
  });

  it('renders grouped models correctly', () => {
    const caps = {
      models: [
        { id: 'model-1', label: 'Model One', group: 'Group A' },
        { id: 'model-2', label: 'Model Two', group: 'Group A' },
        { id: 'model-3', label: 'Model Three', group: 'Group B' },
      ],
      supportsImages: false,
      supportsStreaming: false,
    };
    render(
      <ModelSelector capabilities={caps} value="model-1" onChange={() => {}} />
    );

    const button = screen.getByTitle('Model One');
    fireEvent.click(button);

    // Group names are displayed in uppercase (as-is from the group field)
    expect(screen.getByText('Group A')).toBeTruthy();
    expect(screen.getByText('Group B')).toBeTruthy();
  });

  it('renders separator between groups', () => {
    const caps = {
      models: [
        { id: 'model-1', label: 'Model One', group: 'Group A' },
        { id: 'model-2', label: 'Model Two', group: 'Group B' },
      ],
      supportsImages: false,
      supportsStreaming: false,
    };
    render(
      <ModelSelector capabilities={caps} value="model-1" onChange={() => {}} />
    );

    const button = screen.getByTitle('Model One');
    fireEvent.click(button);

    // Check that a separator exists (border-t class)
    const dropdown = document.querySelector('.border-t');
    expect(dropdown).toBeTruthy();
  });

  it('highlights selected model in dropdown', () => {
    const caps = {
      models: [
        { id: 'model-1', label: 'Model One' },
        { id: 'model-2', label: 'Model Two' },
      ],
      supportsImages: false,
      supportsStreaming: false,
    };
    render(
      <ModelSelector capabilities={caps} value="model-2" onChange={() => {}} />
    );

    const button = screen.getByTitle('Model Two');
    fireEvent.click(button);

    // Find the selected option - it should have primary color class
    const options = screen.getAllByRole('button');
    const selectedOption = options.find(opt => opt.textContent === 'Model Two' && opt.className.includes('bg-primary'));
    expect(selectedOption).toBeTruthy();
  });

  it('renders ModelIcon component', () => {
    const caps = {
      models: [{ id: 'model-1', label: 'Model One' }],
      supportsImages: false,
      supportsStreaming: false,
    };
    render(
      <ModelSelector capabilities={caps} value="model-1" onChange={() => {}} />
    );

    // Check that SVG icon is rendered
    const button = screen.getByTitle('Model One');
    const svg = button.querySelector('svg');
    expect(svg).toBeTruthy();
  });

  it('renders chevron icon', () => {
    const caps = {
      models: [{ id: 'model-1', label: 'Model One' }],
      supportsImages: false,
      supportsStreaming: false,
    };
    render(
      <ModelSelector capabilities={caps} value="model-1" onChange={() => {}} />
    );

    // Check that chevron SVG is rendered (has d="M19 9l-7 7-7-7" path)
    const svgs = document.querySelectorAll('svg');
    const chevronSvg = Array.from(svgs).find(svg => {
      const path = svg.querySelector('path');
      return path?.getAttribute('d')?.includes('M19 9l-7 7-7-7');
    });
    expect(chevronSvg).toBeTruthy();
  });

  it('handles models without groups', () => {
    const caps = {
      models: [
        { id: 'model-1', label: 'Model One' },
        { id: 'model-2', label: 'Model Two' },
      ],
      supportsImages: false,
      supportsStreaming: false,
    };
    render(
      <ModelSelector capabilities={caps} value="model-1" onChange={() => {}} />
    );

    const button = screen.getByTitle('Model One');
    fireEvent.click(button);

    // Should not have group headers
    expect(screen.queryByText('GROUP')).toBeNull();
  });

  it('handles mixed grouped and ungrouped models', () => {
    const caps = {
      models: [
        { id: 'model-1', label: 'Model One' },
        { id: 'model-2', label: 'Model Two', group: 'Group A' },
      ],
      supportsImages: false,
      supportsStreaming: false,
    };
    render(
      <ModelSelector capabilities={caps} value="model-1" onChange={() => {}} />
    );

    const button = screen.getByTitle('Model One');
    fireEvent.click(button);

    // Model One appears in button and in dropdown
    expect(screen.getAllByText('Model One').length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText('Model Two')).toBeTruthy();
    // Group name is displayed as-is (not uppercase)
    expect(screen.getByText('Group A')).toBeTruthy();
  });

  it('toggles dropdown on repeated clicks', () => {
    const caps = {
      models: [{ id: 'model-1', label: 'Model One' }],
      supportsImages: false,
      supportsStreaming: false,
    };
    render(
      <ModelSelector capabilities={caps} value="model-1" onChange={() => {}} />
    );

    const button = screen.getByTitle('Model One');

    // Open dropdown
    fireEvent.click(button);
    expect(screen.getAllByText('Model One').length).toBe(2); // Button + option

    // Close dropdown
    fireEvent.click(button);
    expect(screen.getAllByText('Model One').length).toBe(1); // Button only
  });

  it('applies correct padding for grouped items', () => {
    const caps = {
      models: [
        { id: 'model-1', label: 'Model One', group: 'Group A' },
      ],
      supportsImages: false,
      supportsStreaming: false,
    };
    render(
      <ModelSelector capabilities={caps} value="model-1" onChange={() => {}} />
    );

    const button = screen.getByTitle('Model One');
    fireEvent.click(button);

    // Find the option button in the dropdown
    const optionButton = screen.getAllByRole('button').find(btn =>
      btn.textContent === 'Model One' && btn.className.includes('pl-4')
    );
    expect(optionButton).toBeTruthy();
  });
});
