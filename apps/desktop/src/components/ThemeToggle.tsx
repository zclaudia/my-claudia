import { useState, useRef, useEffect } from 'react';
import { useTheme, isDarkTheme, type Theme } from '../contexts/ThemeContext';

const THEME_OPTIONS: { value: Theme; label: string; icon: string }[] = [
  { value: 'light', label: 'Light', icon: '☀️' },
  { value: 'dark-neutral', label: 'Dark', icon: '🌙' },
  { value: 'dark-warm', label: 'Dark Warm', icon: '🔥' },
  { value: 'dark-cool', label: 'Dark Cool', icon: '❄️' },
  { value: 'system', label: 'System', icon: '💻' },
];

function getButtonIcon(theme: Theme, resolvedTheme: string): string {
  if (theme === 'system') return '💻';
  if (isDarkTheme(resolvedTheme as any)) return '🌙';
  return '☀️';
}

export function ThemeToggle() {
  const { theme, resolvedTheme, setTheme } = useTheme();
  const [isOpen, setIsOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  const currentOption = THEME_OPTIONS.find((opt) => opt.value === theme) || THEME_OPTIONS[4];

  // Close dropdown when clicking outside
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    }

    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside);
      return () => document.removeEventListener('mousedown', handleClickOutside);
    }
  }, [isOpen]);

  return (
    <div className="relative" ref={dropdownRef}>
      <button
        onClick={() => setIsOpen(!isOpen)}
        className={`
          flex items-center gap-1.5 px-2.5 py-1.5 text-xs rounded-lg transition-all
          ${isOpen
            ? 'bg-card text-foreground shadow-sm'
            : 'bg-secondary/50 text-muted-foreground hover:text-foreground hover:bg-secondary'
          }
        `}
        title="Change theme"
      >
        <span>{getButtonIcon(theme, resolvedTheme)}</span>
        <span className="hidden sm:inline">{currentOption.label}</span>
        <svg
          className={`w-3 h-3 transition-transform ${isOpen ? 'rotate-180' : ''}`}
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {/* Dropdown menu */}
      {isOpen && (
        <div className="absolute top-full right-0 mt-1 w-44 bg-popover border border-border rounded-lg shadow-lg z-50 overflow-hidden">
          {THEME_OPTIONS.map((option) => (
            <button
              key={option.value}
              onClick={() => {
                setTheme(option.value);
                setIsOpen(false);
              }}
              className={`
                w-full flex items-center gap-2 px-3 py-2 text-xs text-left transition-colors
                ${theme === option.value
                  ? 'bg-primary/10 text-primary'
                  : 'text-popover-foreground hover:bg-muted'
                }
              `}
            >
              <span>{option.icon}</span>
              <span>{option.label}</span>
              {theme === option.value && (
                <svg className="w-3 h-3 ml-auto" fill="currentColor" viewBox="0 0 20 20">
                  <path
                    fillRule="evenodd"
                    d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z"
                    clipRule="evenodd"
                  />
                </svg>
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
