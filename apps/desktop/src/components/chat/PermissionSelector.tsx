import { useState, useRef, useEffect } from 'react';
import type { AgentPermissionPolicy } from '@my-claudia/shared';

interface PermissionSelectorProps {
  value: Partial<AgentPermissionPolicy> | null;
  onChange: (policy: Partial<AgentPermissionPolicy> | null) => void;
  projectPolicy: AgentPermissionPolicy | null;
  disabled?: boolean;
}

/** Shield icon */
function ShieldIcon({ className = 'w-3.5 h-3.5' }: { className?: string }) {
  return (
    <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={2}
        d="M9 12.75L11.25 15 15 9.75m-3-7.036A11.959 11.959 0 013.598 6 11.99 11.99 0 003 9.749c0 5.592 3.824 10.29 9 11.623 5.176-1.332 9-6.03 9-11.622 0-1.31-.21-2.571-.598-3.751h-.152c-3.196 0-6.1-1.248-8.25-3.285z"
      />
    </svg>
  );
}

const TRUST_LEVELS = [
  { id: 'conservative', label: '🛡️ Conservative', description: 'Read-only + sensitive file guard' },
  { id: 'moderate', label: '⚖️ Moderate', description: '+ File edits + workspace guard' },
  { id: 'aggressive', label: '🚀 Aggressive', description: '+ Safe bash + network guard' },
  { id: 'full_trust', label: '🔓 Full Trust', description: 'Everything except dangerous bash' },
];

export function PermissionSelector({ value, onChange, projectPolicy, disabled }: PermissionSelectorProps) {
  const [isOpen, setIsOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  // Close dropdown on outside click
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

  // Strip emoji prefix from label for the trigger button (dropdown keeps emojis)
  const stripEmoji = (label: string) => label.replace(/^[^\w\s]*\s*/, '');

  // Determine current label for trigger button (without emoji)
  const getTriggerLabel = () => {
    if (!value) {
      // Using project default
      if (projectPolicy?.enabled) {
        const level = TRUST_LEVELS.find(l => l.id === projectPolicy.trustLevel);
        return level ? stripEmoji(level.label) : 'Project Default';
      }
      return 'Project Default';
    }
    const level = TRUST_LEVELS.find(l => l.id === value.trustLevel);
    return level ? stripEmoji(level.label) : 'Custom';
  };

  const triggerLabel = getTriggerLabel();
  const hasOverride = value !== null;

  const handleSelect = (trustLevel: string | null) => {
    if (trustLevel === null) {
      // Clear override - use project default
      onChange(null);
    } else {
      // Set session override
      onChange({
        enabled: true,
        trustLevel: trustLevel as AgentPermissionPolicy['trustLevel'],
        customRules: [],
        escalateAlways: ['AskUserQuestion', 'ExitPlanMode'],
      });
    }
    setIsOpen(false);
  };

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => !disabled && setIsOpen(!isOpen)}
        disabled={disabled}
        className={`
          flex items-center gap-1 px-1.5 py-1 rounded-md text-[11px] font-medium
          transition-colors h-7
          ${disabled
            ? 'opacity-50 cursor-not-allowed text-muted-foreground'
            : hasOverride
            ? 'hover:bg-muted active:bg-muted/80 cursor-pointer text-primary'
            : 'hover:bg-muted active:bg-muted/80 cursor-pointer text-muted-foreground hover:text-foreground'
          }
        `}
        title={triggerLabel}
      >
        <ShieldIcon />
        <span className="hidden md:inline truncate max-w-[80px] lg:max-w-none">{triggerLabel}</span>
        <svg className="w-3 h-3 text-muted-foreground" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {isOpen && (
        <div className="absolute bottom-full left-0 mb-1 z-50 bg-popover border border-border rounded-lg shadow-lg py-1 min-w-[240px] max-h-[300px] overflow-y-auto">
          {/* Header */}
          <div className="px-3 py-1.5 text-[10px] text-muted-foreground font-semibold uppercase tracking-wider border-b border-border">
            Session Permission Override
          </div>

          {/* Project Default option */}
          <button
            onClick={() => handleSelect(null)}
            className={`
              w-full text-left px-3 py-1.5 transition-colors
              ${!hasOverride
                ? 'bg-primary/10 text-primary font-medium'
                : 'text-foreground hover:bg-muted active:bg-muted'
              }
            `}
          >
            <div className="text-[13px]">⚙️ Project Default</div>
            <div className="text-[10px] text-muted-foreground mt-0.5">
              {projectPolicy?.enabled
                ? `Use project setting (${projectPolicy.trustLevel})`
                : 'Ask for all permissions'}
            </div>
          </button>

          <div className="my-1 border-t border-border" />

          {/* Trust level options */}
          {TRUST_LEVELS.map((level) => (
            <button
              key={level.id}
              onClick={() => handleSelect(level.id)}
              className={`
                w-full text-left px-3 py-1.5 transition-colors
                ${value?.trustLevel === level.id
                  ? 'bg-primary/10 text-primary font-medium'
                  : 'text-foreground hover:bg-muted active:bg-muted'
                }
              `}
            >
              <div className="text-[13px]">{level.label}</div>
              <div className="text-[10px] text-muted-foreground mt-0.5">
                {level.description}
              </div>
            </button>
          ))}

          {/* Info footer */}
          <div className="px-3 py-1.5 text-[10px] text-muted-foreground border-t border-border mt-1">
            💡 Session override is temporary and will be cleared on page refresh
          </div>
        </div>
      )}
    </div>
  );
}
