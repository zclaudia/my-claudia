import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

const mockSetTheme = vi.fn();
let mockTheme = 'dark-neutral';
let mockResolvedTheme = 'dark-neutral';

vi.mock('../../contexts/ThemeContext', () => ({
  useTheme: () => ({
    theme: mockTheme,
    resolvedTheme: mockResolvedTheme,
    setTheme: mockSetTheme,
  }),
  isDarkTheme: (t: string) => t !== 'light',
}));

import { ThemeToggle } from '../ThemeToggle';

describe('ThemeToggle', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockTheme = 'dark-neutral';
    mockResolvedTheme = 'dark-neutral';
  });

  it('renders without crashing', () => {
    const { container } = render(<ThemeToggle />);
    expect(container.firstChild).toBeDefined();
  });

  it('renders a toggle button', () => {
    render(<ThemeToggle />);
    const buttons = screen.getAllByRole('button');
    expect(buttons.length).toBeGreaterThan(0);
  });

  it('displays the current theme label', () => {
    render(<ThemeToggle />);
    expect(screen.getByText('Dark')).toBeTruthy();
  });

  it('opens dropdown when button is clicked', () => {
    render(<ThemeToggle />);
    const toggleBtn = screen.getByTitle('Change theme');
    fireEvent.click(toggleBtn);

    // All theme options should be visible
    expect(screen.getByText('Light')).toBeTruthy();
    expect(screen.getByText('Dark Warm')).toBeTruthy();
    expect(screen.getByText('Dark Cool')).toBeTruthy();
    expect(screen.getByText('System')).toBeTruthy();
  });

  it('closes dropdown when toggle button is clicked again', () => {
    render(<ThemeToggle />);
    const toggleBtn = screen.getByTitle('Change theme');

    fireEvent.click(toggleBtn);
    expect(screen.getByText('Light')).toBeTruthy();

    fireEvent.click(toggleBtn);
    // Dropdown should be closed, only the current theme label visible in the button
    expect(screen.queryByText('Dark Warm')).toBeNull();
  });

  it('calls setTheme when a theme option is selected', () => {
    render(<ThemeToggle />);
    const toggleBtn = screen.getByTitle('Change theme');
    fireEvent.click(toggleBtn);

    const lightOption = screen.getByText('Light');
    fireEvent.click(lightOption);

    expect(mockSetTheme).toHaveBeenCalledWith('light');
  });

  it('selects system theme', () => {
    render(<ThemeToggle />);
    fireEvent.click(screen.getByTitle('Change theme'));
    fireEvent.click(screen.getByText('System'));
    expect(mockSetTheme).toHaveBeenCalledWith('system');
  });

  it('selects dark-warm theme', () => {
    render(<ThemeToggle />);
    fireEvent.click(screen.getByTitle('Change theme'));
    fireEvent.click(screen.getByText('Dark Warm'));
    expect(mockSetTheme).toHaveBeenCalledWith('dark-warm');
  });

  it('selects dark-cool theme', () => {
    render(<ThemeToggle />);
    fireEvent.click(screen.getByTitle('Change theme'));
    fireEvent.click(screen.getByText('Dark Cool'));
    expect(mockSetTheme).toHaveBeenCalledWith('dark-cool');
  });

  it('closes dropdown after selecting a theme', () => {
    render(<ThemeToggle />);
    fireEvent.click(screen.getByTitle('Change theme'));
    fireEvent.click(screen.getByText('Light'));

    // Dropdown should be closed
    expect(screen.queryByText('Dark Warm')).toBeNull();
  });

  it('closes dropdown when clicking outside', () => {
    const { container } = render(
      <div>
        <ThemeToggle />
        <div data-testid="outside">outside</div>
      </div>
    );

    fireEvent.click(screen.getByTitle('Change theme'));
    expect(screen.getByText('Dark Warm')).toBeTruthy();

    fireEvent.mouseDown(screen.getByTestId('outside'));
    expect(screen.queryByText('Dark Warm')).toBeNull();
  });

  it('shows check mark on current theme in dropdown', () => {
    const { container } = render(<ThemeToggle />);
    fireEvent.click(screen.getByTitle('Change theme'));

    // The "Dark" option (dark-neutral) in the dropdown should have the primary styling
    // Use w-full to distinguish dropdown option buttons from the toggle button
    const allButtons = container.querySelectorAll('button');
    const darkButton = Array.from(allButtons).find(
      b => b.textContent?.includes('Dark') && !b.textContent?.includes('Warm') && !b.textContent?.includes('Cool') && b.className.includes('w-full')
    );
    expect(darkButton?.className).toContain('bg-primary/10');
  });

  it('renders light icon when theme is light', () => {
    mockTheme = 'light';
    mockResolvedTheme = 'light';
    render(<ThemeToggle />);
    expect(screen.getByText('Light')).toBeTruthy();
  });

  it('renders monitor icon when theme is system', () => {
    mockTheme = 'system';
    mockResolvedTheme = 'dark-neutral';
    render(<ThemeToggle />);
    expect(screen.getByText('System')).toBeTruthy();
  });
});
