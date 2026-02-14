import { useState, useRef, useEffect } from 'react';
import type { ProviderCapabilities } from '@my-claudia/shared';

interface ModeSelectorProps {
  capabilities: ProviderCapabilities | null;
  value: string;
  onChange: (modeId: string) => void;
  disabled?: boolean;
}

/** Shield / mode icon */
function ModeIcon({ className = 'w-3.5 h-3.5' }: { className?: string }) {
  return (
    <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={2}
        d="M9.594 3.94c.09-.542.56-.94 1.11-.94h2.593c.55 0 1.02.398 1.11.94l.213 1.281c.063.374.313.686.645.87.074.04.147.083.22.127.325.196.72.257 1.075.124l1.217-.456a1.125 1.125 0 011.37.49l1.296 2.247a1.125 1.125 0 01-.26 1.431l-1.003.827c-.293.241-.438.613-.43.992a7.723 7.723 0 010 .255c-.008.378.137.75.43.991l1.004.827c.424.35.534.955.26 1.43l-1.298 2.247a1.125 1.125 0 01-1.369.491l-1.217-.456c-.355-.133-.75-.072-1.076.124a6.47 6.47 0 01-.22.128c-.331.183-.581.495-.644.869l-.213 1.281c-.09.543-.56.94-1.11.94h-2.594c-.55 0-1.019-.398-1.11-.94l-.213-1.281c-.062-.374-.312-.686-.644-.87a6.52 6.52 0 01-.22-.127c-.325-.196-.72-.257-1.076-.124l-1.217.456a1.125 1.125 0 01-1.369-.49l-1.297-2.247a1.125 1.125 0 01.26-1.431l1.004-.827c.292-.24.437-.613.43-.991a6.932 6.932 0 010-.255c.007-.38-.138-.751-.43-.992l-1.004-.827a1.125 1.125 0 01-.26-1.43l1.297-2.247a1.125 1.125 0 011.37-.491l1.216.456c.356.133.751.072 1.076-.124.072-.044.146-.086.22-.128.332-.183.582-.495.644-.869l.214-1.28z"
      />
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={2}
        d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"
      />
    </svg>
  );
}

export function ModeSelector({ capabilities, value, onChange, disabled }: ModeSelectorProps) {
  const [isOpen, setIsOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  // Close dropdown on outside click — must be before any conditional return
  useEffect(() => {
    if (!isOpen) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [isOpen]);

  // Hide entirely when no capabilities or no modes
  if (!capabilities || capabilities.modes.length === 0) return null;

  const options = capabilities.modes;
  const current = options.find(m => m.id === value) || options[0];

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => !disabled && setIsOpen(!isOpen)}
        disabled={disabled}
        title={current.description}
        className={`
          flex items-center gap-1.5 px-2.5 py-1.5 rounded-full text-xs font-medium
          border transition-colors min-h-[36px]
          ${disabled
            ? 'opacity-50 cursor-not-allowed border-border text-muted-foreground'
            : 'hover:border-primary/50 active:bg-muted cursor-pointer border-border text-foreground'
          }
        `}
      >
        {current.icon ? <span>{current.icon}</span> : <ModeIcon />}
        <span>{current.label}</span>
        <span className="text-[10px] text-muted-foreground">&#9662;</span>
      </button>

      {isOpen && (
        <div className="absolute bottom-full left-0 mb-1 z-50 bg-popover border border-border rounded-lg shadow-lg py-1 min-w-[160px]">
          {options.map((option) => (
            <button
              key={option.id}
              onClick={() => {
                onChange(option.id);
                setIsOpen(false);
              }}
              title={option.description}
              className={`
                w-full text-left px-3 py-1.5 text-[13px] transition-colors
                flex items-center gap-2
                ${value === option.id
                  ? 'bg-primary/10 text-primary font-medium'
                  : 'text-foreground hover:bg-muted active:bg-muted'
                }
              `}
            >
              {option.icon && <span className="text-sm">{option.icon}</span>}
              <div className="flex flex-col">
                <span>{option.label}</span>
                {option.description && (
                  <span className="text-[10px] text-muted-foreground font-normal leading-tight">{option.description}</span>
                )}
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
