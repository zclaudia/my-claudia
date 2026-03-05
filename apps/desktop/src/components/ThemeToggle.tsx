import { useState, useRef, useEffect } from 'react';
import { useTheme, isDarkTheme, type Theme } from '../contexts/ThemeContext';
import { Sun, Moon, Flame, Snowflake, Monitor, Check, ChevronDown, type LucideIcon } from 'lucide-react';

const THEME_OPTIONS: { value: Theme; label: string; icon: LucideIcon }[] = [
  { value: 'light', label: 'Light', icon: Sun },
  { value: 'dark-neutral', label: 'Dark', icon: Moon },
  { value: 'dark-warm', label: 'Dark Warm', icon: Flame },
  { value: 'dark-cool', label: 'Dark Cool', icon: Snowflake },
  { value: 'system', label: 'System', icon: Monitor },
];

function getButtonIcon(theme: Theme, resolvedTheme: string): LucideIcon {
  if (theme === 'system') return Monitor;
  if (isDarkTheme(resolvedTheme as any)) return Moon;
  return Sun;
}

export function ThemeToggle() {
  const { theme, resolvedTheme, setTheme } = useTheme();
  const [isOpen, setIsOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  const currentOption = THEME_OPTIONS.find((opt) => opt.value === theme) || THEME_OPTIONS[4];
  const ButtonIcon = getButtonIcon(theme, resolvedTheme);

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
            ? 'bg-card text-foreground shadow-apple-sm'
            : 'bg-secondary/50 text-muted-foreground hover:text-foreground hover:bg-secondary'
          }
        `}
        title="Change theme"
      >
        <ButtonIcon size={14} strokeWidth={1.75} />
        <span className="hidden sm:inline">{currentOption.label}</span>
        <ChevronDown
          size={12}
          className={`transition-transform ${isOpen ? 'rotate-180' : ''}`}
        />
      </button>

      {/* Dropdown menu */}
      {isOpen && (
        <div className="absolute top-full right-0 mt-1 w-44 bg-popover/95 glass border border-border/50 rounded-xl shadow-apple-xl z-50 overflow-hidden animate-apple-fade-in">
          {THEME_OPTIONS.map((option) => {
            const OptionIcon = option.icon;
            return (
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
                <OptionIcon size={14} strokeWidth={1.75} />
                <span>{option.label}</span>
                {theme === option.value && (
                  <Check size={12} className="ml-auto" />
                )}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
