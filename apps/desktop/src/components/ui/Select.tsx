import { useEffect, useRef, useState, useCallback, useMemo, type ReactNode } from 'react';
import { ChevronDown, Check } from 'lucide-react';

export interface SelectOption<T extends string = string> {
  value: T;
  label: ReactNode;
  description?: ReactNode;
  disabled?: boolean;
}

export type SelectSize = 'sm' | 'md' | 'lg';

export interface SelectProps<T extends string = string> {
  value: T | '';
  onChange: (value: T) => void;
  options: SelectOption<T>[];
  placeholder?: ReactNode;
  disabled?: boolean;
  size?: SelectSize;
  block?: boolean;
  className?: string;
  triggerClassName?: string;
  panelClassName?: string;
  title?: string;
  align?: 'left' | 'right';
  ariaLabel?: string;
}

const SIZE_CLASSES: Record<SelectSize, { trigger: string; panelText: string }> = {
  sm: {
    trigger: 'h-6 px-2 text-[11px] gap-1',
    panelText: 'text-[11px]',
  },
  md: {
    trigger: 'h-7 px-2.5 text-[12px] gap-1.5',
    panelText: 'text-[12px]',
  },
  lg: {
    trigger: 'h-[38px] px-3 text-sm gap-1.5',
    panelText: 'text-sm',
  },
};

export function Select<T extends string = string>({
  value,
  onChange,
  options,
  placeholder,
  disabled,
  size = 'sm',
  block = false,
  className = '',
  triggerClassName = '',
  panelClassName = '',
  title,
  align = 'left',
  ariaLabel,
}: SelectProps<T>) {
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

  const selected = useMemo(() => options.find((opt) => opt.value === value), [options, value]);
  const sizing = SIZE_CLASSES[size];

  useEffect(() => {
    if (!isOpen) return;
    const handleMouseDown = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    };
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setIsOpen(false);
        triggerRef.current?.focus();
      }
    };
    document.addEventListener('mousedown', handleMouseDown);
    document.addEventListener('keydown', handleKey);
    return () => {
      document.removeEventListener('mousedown', handleMouseDown);
      document.removeEventListener('keydown', handleKey);
    };
  }, [isOpen]);

  const handleSelect = useCallback((next: T, optionDisabled: boolean | undefined) => {
    if (optionDisabled) return;
    onChange(next);
    setIsOpen(false);
    triggerRef.current?.focus();
  }, [onChange]);

  const triggerLabel = selected ? selected.label : (placeholder ?? '');

  return (
    <div ref={containerRef} className={`relative ${block ? 'block w-full' : 'inline-block'} ${className}`}>
      <button
        ref={triggerRef}
        type="button"
        onClick={() => !disabled && setIsOpen((v) => !v)}
        disabled={disabled}
        title={title}
        aria-haspopup="listbox"
        aria-expanded={isOpen}
        aria-label={ariaLabel}
        className={`
          flex items-center justify-between w-full
          ${sizing.trigger}
          rounded-full bg-background border border-border
          font-medium
          focus:outline-none focus:ring-1 focus:ring-primary
          transition-colors
          ${disabled
            ? 'opacity-50 cursor-not-allowed'
            : 'hover:border-primary/40 cursor-pointer'}
          ${triggerClassName}
        `}
      >
        <span className={`truncate text-left ${selected ? '' : 'text-muted-foreground'}`}>
          {triggerLabel}
        </span>
        <ChevronDown
          size={12}
          strokeWidth={2}
          className={`flex-shrink-0 text-muted-foreground transition-transform ${isOpen ? 'rotate-180' : ''}`}
        />
      </button>

      {isOpen && (
        <div
          role="listbox"
          className={`
            absolute z-50 mt-1 min-w-full
            ${align === 'right' ? 'right-0' : 'left-0'}
            bg-popover/95 glass border border-border/50
            rounded-xl shadow-apple-xl py-1
            max-h-[280px] overflow-y-auto
            animate-apple-fade-in
            ${panelClassName}
          `}
        >
          {options.map((opt) => {
            const isActive = opt.value === value;
            return (
              <button
                key={opt.value}
                type="button"
                role="option"
                aria-selected={isActive}
                disabled={opt.disabled}
                onClick={() => handleSelect(opt.value, opt.disabled)}
                className={`
                  w-full text-left px-3 py-1.5 ${sizing.panelText}
                  flex items-start gap-2
                  transition-colors whitespace-nowrap
                  ${opt.disabled
                    ? 'opacity-50 cursor-not-allowed'
                    : isActive
                      ? 'bg-primary/10 text-primary font-medium'
                      : 'text-foreground hover:bg-muted active:bg-muted'}
                `}
              >
                <Check
                  size={12}
                  strokeWidth={2.5}
                  className={`mt-[3px] flex-shrink-0 ${isActive ? 'opacity-100 text-primary' : 'opacity-0'}`}
                />
                <span className="flex-1 min-w-0">
                  <span className="block truncate">{opt.label}</span>
                  {opt.description && (
                    <span className="block text-[10px] text-muted-foreground mt-0.5 truncate">
                      {opt.description}
                    </span>
                  )}
                </span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
