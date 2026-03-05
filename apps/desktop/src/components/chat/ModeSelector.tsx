import { useState, useRef, useEffect } from 'react';
import { Shield, ClipboardList, Pencil, Zap, Settings, type LucideIcon } from 'lucide-react';
import type { ProviderCapabilities } from '@my-claudia/shared';

interface ModeSelectorProps {
  capabilities: ProviderCapabilities | null;
  value: string;
  onChange: (modeId: string) => void;
  disabled?: boolean;
}

const MODE_ICONS: Record<string, LucideIcon> = {
  default: Shield,
  plan: ClipboardList,
  acceptEdits: Pencil,
  bypassPermissions: Zap,
  ask: Settings,
};

function getModeIcon(modeId: string): LucideIcon {
  return MODE_ICONS[modeId] || Settings;
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
          flex items-center gap-1 px-1.5 py-1 rounded-md text-[11px] font-medium
          transition-colors h-7
          ${disabled
            ? 'opacity-50 cursor-not-allowed text-muted-foreground'
            : 'hover:bg-muted active:bg-muted/80 cursor-pointer text-muted-foreground hover:text-foreground'
          }
        `}
        aria-label={`Mode: ${current.label}`}
      >
        {(() => { const Icon = getModeIcon(current.id); return <Icon size={14} strokeWidth={1.75} />; })()}
        <span className="hidden lg:inline truncate max-w-[60px] xl:max-w-[100px]">{current.label}</span>
        <svg className="w-3 h-3 text-muted-foreground" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {isOpen && (
        <div className="absolute bottom-full left-0 mb-1 z-50 bg-popover/95 glass border border-border/50 rounded-xl shadow-apple-xl py-1 min-w-[160px] animate-apple-fade-in">
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
              {(() => { const Icon = getModeIcon(option.id); return <Icon size={14} strokeWidth={1.75} />; })()}
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
