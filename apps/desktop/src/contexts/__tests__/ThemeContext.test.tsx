import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import { ThemeProvider, useTheme, isDarkTheme } from '../ThemeContext';

// Test component that exposes theme context
function ThemeConsumer() {
  const { theme, resolvedTheme, setTheme } = useTheme();
  return (
    <div>
      <span data-testid="theme">{theme}</span>
      <span data-testid="resolved">{resolvedTheme}</span>
      <button data-testid="set-light" onClick={() => setTheme('light')}>Light</button>
      <button data-testid="set-dark" onClick={() => setTheme('dark-neutral')}>Dark</button>
      <button data-testid="set-system" onClick={() => setTheme('system')}>System</button>
      <button data-testid="set-warm" onClick={() => setTheme('dark-warm')}>Warm</button>
      <button data-testid="set-cool" onClick={() => setTheme('dark-cool')}>Cool</button>
    </div>
  );
}

describe('ThemeContext', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    // Reset document classes
    document.documentElement.classList.remove('dark', 'dark-neutral', 'dark-warm', 'dark-cool');
    // Ensure matchMedia returns false (light mode) by default
    vi.mocked(window.matchMedia).mockImplementation((query) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    }));
  });

  describe('isDarkTheme', () => {
    it('returns false for light theme', () => {
      expect(isDarkTheme('light')).toBe(false);
    });

    it('returns true for dark-neutral theme', () => {
      expect(isDarkTheme('dark-neutral')).toBe(true);
    });

    it('returns true for dark-warm theme', () => {
      expect(isDarkTheme('dark-warm')).toBe(true);
    });

    it('returns true for dark-cool theme', () => {
      expect(isDarkTheme('dark-cool')).toBe(true);
    });
  });

  describe('ThemeProvider', () => {
    it('renders children', () => {
      render(
        <ThemeProvider>
          <div data-testid="child">Hello</div>
        </ThemeProvider>
      );
      expect(screen.getByTestId('child')).toHaveTextContent('Hello');
    });

    it('defaults to system theme', () => {
      render(
        <ThemeProvider>
          <ThemeConsumer />
        </ThemeProvider>
      );
      expect(screen.getByTestId('theme')).toHaveTextContent('system');
    });

    it('resolves system theme to light when prefers-color-scheme is light', () => {
      vi.mocked(window.matchMedia).mockImplementation((query) => ({
        matches: false, // light mode
        media: query,
        onchange: null,
        addListener: vi.fn(),
        removeListener: vi.fn(),
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        dispatchEvent: vi.fn(),
      }));

      render(
        <ThemeProvider>
          <ThemeConsumer />
        </ThemeProvider>
      );
      expect(screen.getByTestId('resolved')).toHaveTextContent('light');
    });

    it('resolves system theme to dark-neutral when prefers-color-scheme is dark', () => {
      vi.mocked(window.matchMedia).mockImplementation((query) => ({
        matches: true, // dark mode
        media: query,
        onchange: null,
        addListener: vi.fn(),
        removeListener: vi.fn(),
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        dispatchEvent: vi.fn(),
      }));

      render(
        <ThemeProvider>
          <ThemeConsumer />
        </ThemeProvider>
      );
      expect(screen.getByTestId('resolved')).toHaveTextContent('dark-neutral');
    });

    it('uses defaultTheme prop when no localStorage value', () => {
      render(
        <ThemeProvider defaultTheme="dark-warm">
          <ThemeConsumer />
        </ThemeProvider>
      );
      expect(screen.getByTestId('theme')).toHaveTextContent('dark-warm');
      expect(screen.getByTestId('resolved')).toHaveTextContent('dark-warm');
    });

    it('restores theme from localStorage', () => {
      localStorage.setItem('my-claudia-theme', 'dark-cool');

      render(
        <ThemeProvider>
          <ThemeConsumer />
        </ThemeProvider>
      );
      expect(screen.getByTestId('theme')).toHaveTextContent('dark-cool');
      expect(screen.getByTestId('resolved')).toHaveTextContent('dark-cool');
    });

    it('migrates old "dark" value to "dark-neutral"', () => {
      localStorage.setItem('my-claudia-theme', 'dark');

      render(
        <ThemeProvider>
          <ThemeConsumer />
        </ThemeProvider>
      );
      expect(screen.getByTestId('theme')).toHaveTextContent('dark-neutral');
      expect(localStorage.getItem('my-claudia-theme')).toBe('dark-neutral');
    });

    it('ignores invalid localStorage values and uses default', () => {
      localStorage.setItem('my-claudia-theme', 'invalid-theme');

      render(
        <ThemeProvider>
          <ThemeConsumer />
        </ThemeProvider>
      );
      expect(screen.getByTestId('theme')).toHaveTextContent('system');
    });
  });

  describe('setTheme', () => {
    it('updates the theme and persists to localStorage', () => {
      render(
        <ThemeProvider>
          <ThemeConsumer />
        </ThemeProvider>
      );

      act(() => {
        screen.getByTestId('set-dark').click();
      });

      expect(screen.getByTestId('theme')).toHaveTextContent('dark-neutral');
      expect(screen.getByTestId('resolved')).toHaveTextContent('dark-neutral');
      expect(localStorage.getItem('my-claudia-theme')).toBe('dark-neutral');
    });

    it('switches from dark to light', () => {
      localStorage.setItem('my-claudia-theme', 'dark-neutral');

      render(
        <ThemeProvider>
          <ThemeConsumer />
        </ThemeProvider>
      );

      act(() => {
        screen.getByTestId('set-light').click();
      });

      expect(screen.getByTestId('theme')).toHaveTextContent('light');
      expect(screen.getByTestId('resolved')).toHaveTextContent('light');
    });

    it('switches to warm dark theme', () => {
      render(
        <ThemeProvider defaultTheme="light">
          <ThemeConsumer />
        </ThemeProvider>
      );

      act(() => {
        screen.getByTestId('set-warm').click();
      });

      expect(screen.getByTestId('theme')).toHaveTextContent('dark-warm');
      expect(screen.getByTestId('resolved')).toHaveTextContent('dark-warm');
    });

    it('switches to cool dark theme', () => {
      render(
        <ThemeProvider defaultTheme="light">
          <ThemeConsumer />
        </ThemeProvider>
      );

      act(() => {
        screen.getByTestId('set-cool').click();
      });

      expect(screen.getByTestId('theme')).toHaveTextContent('dark-cool');
      expect(screen.getByTestId('resolved')).toHaveTextContent('dark-cool');
    });
  });

  describe('CSS class application', () => {
    it('adds dark class for dark themes', () => {
      render(
        <ThemeProvider defaultTheme="dark-neutral">
          <ThemeConsumer />
        </ThemeProvider>
      );

      expect(document.documentElement.classList.contains('dark')).toBe(true);
      expect(document.documentElement.classList.contains('dark-neutral')).toBe(true);
    });

    it('removes dark class for light theme', () => {
      document.documentElement.classList.add('dark', 'dark-neutral');

      render(
        <ThemeProvider defaultTheme="light">
          <ThemeConsumer />
        </ThemeProvider>
      );

      expect(document.documentElement.classList.contains('dark')).toBe(false);
      expect(document.documentElement.classList.contains('dark-neutral')).toBe(false);
    });

    it('switches dark variant classes correctly', () => {
      render(
        <ThemeProvider defaultTheme="dark-neutral">
          <ThemeConsumer />
        </ThemeProvider>
      );

      expect(document.documentElement.classList.contains('dark-neutral')).toBe(true);

      act(() => {
        screen.getByTestId('set-warm').click();
      });

      expect(document.documentElement.classList.contains('dark-warm')).toBe(true);
      expect(document.documentElement.classList.contains('dark-neutral')).toBe(false);
    });
  });

  describe('useTheme', () => {
    it('throws when used outside ThemeProvider', () => {
      // Suppress error output from React
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      expect(() => {
        render(<ThemeConsumer />);
      }).toThrow('useTheme must be used within a ThemeProvider');

      consoleSpy.mockRestore();
    });
  });
});
