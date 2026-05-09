import { useState, useRef, useEffect } from 'react';
import { Shield, Scale, Rocket, LockOpen, Settings, Lightbulb, ChevronDown, SlidersHorizontal } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import type { UnifiedPermissionPolicy, CategoryAction, PermissionCategory, CategoryProfile } from '@my-claudia/shared';

interface PermissionSelectorProps {
  value: Partial<UnifiedPermissionPolicy> | null;
  onChange: (policy: Partial<UnifiedPermissionPolicy> | null) => void;
  disabled?: boolean;
}

// Preset profiles mapping to v3 CategoryProfile
const PRESETS: { id: string; label: string; icon: LucideIcon; description: string; profile: CategoryProfile }[] = [
  {
    id: 'read-only',
    label: 'Read Only',
    icon: Shield,
    description: 'Only auto-approve read operations',
    profile: { fileRead: 'auto-approve', fileWrite: 'ask', shellSafe: 'ask', networkOps: 'ask', destructiveOps: 'block', userQuestions: 'ask' },
  },
  {
    id: 'standard',
    label: 'Standard',
    icon: Scale,
    description: '+ File edits auto-approved',
    profile: { fileRead: 'auto-approve', fileWrite: 'auto-approve', shellSafe: 'ask', networkOps: 'ask', destructiveOps: 'block', userQuestions: 'ask' },
  },
  {
    id: 'power-user',
    label: 'Power User',
    icon: Rocket,
    description: '+ Safe shell auto-approved',
    profile: { fileRead: 'auto-approve', fileWrite: 'auto-approve', shellSafe: 'auto-approve', networkOps: 'ask', destructiveOps: 'block', userQuestions: 'ask' },
  },
  {
    id: 'full-auto',
    label: 'Full Auto',
    icon: LockOpen,
    description: '+ Network ops auto-approved',
    profile: { fileRead: 'auto-approve', fileWrite: 'auto-approve', shellSafe: 'auto-approve', networkOps: 'auto-approve', destructiveOps: 'block', userQuestions: 'ask' },
  },
];

const CATEGORY_ORDER: PermissionCategory[] = [
  'fileRead', 'fileWrite', 'shellSafe', 'networkOps', 'destructiveOps', 'userQuestions',
];

const CATEGORY_LABELS: Record<PermissionCategory, string> = {
  fileRead: 'File Read',
  fileWrite: 'File Write',
  shellSafe: 'Shell (safe)',
  networkOps: 'Network',
  destructiveOps: 'Destructive',
  userQuestions: 'User Qs',
};

const ACTION_OPTIONS: Array<{ value: CategoryAction; label: string }> = [
  { value: 'auto-approve', label: 'Auto' },
  { value: 'ask', label: 'Ask' },
  { value: 'block', label: 'Block' },
];

function profilesEqual(a: CategoryProfile, b: CategoryProfile): boolean {
  return CATEGORY_ORDER.every(cat => a[cat] === b[cat]);
}

export function PermissionSelector({ value, onChange, disabled }: PermissionSelectorProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [showCustom, setShowCustom] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!isOpen) { setShowCustom(false); return; }
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [isOpen]);

  // Determine current label
  const getTriggerLabel = () => {
    if (!value) return 'Project Default';
    const profile = value.profile;
    if (profile) {
      const match = PRESETS.find(p => profilesEqual(p.profile, profile as CategoryProfile));
      if (match) return match.label;
      return 'Custom';
    }
    return 'Project Default';
  };

  const triggerLabel = getTriggerLabel();
  const hasOverride = value !== null;

  const handleSelectPreset = (preset: typeof PRESETS[number] | null) => {
    if (preset === null) {
      onChange(null);
    } else {
      onChange({ enabled: true, profile: { ...preset.profile } });
    }
    setIsOpen(false);
  };

  const handleCustomChange = (cat: PermissionCategory, action: CategoryAction) => {
    // Only store explicitly changed categories — unset ones inherit from project/global
    const newProfile = { ...value?.profile, [cat]: action } as CategoryProfile;
    onChange({ ...value, enabled: true, profile: newProfile });
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
        <Shield size={14} strokeWidth={1.75} />
        <span className="hidden md:inline truncate max-w-[80px] lg:max-w-none">{triggerLabel}</span>
        <ChevronDown size={12} className="text-muted-foreground" />
      </button>

      {isOpen && (
        <div className="absolute bottom-full left-0 mb-1 z-50 bg-popover/95 glass border border-border/50 rounded-xl shadow-apple-xl py-1 min-w-[260px] max-h-[400px] overflow-y-auto animate-apple-fade-in">
          {/* Header */}
          <div className="px-3 py-1.5 text-[10px] text-muted-foreground font-semibold uppercase tracking-wider border-b border-border">
            Session Permission Override
          </div>

          {/* Project Default option */}
          <button
            onClick={() => handleSelectPreset(null)}
            className={`
              w-full text-left px-3 py-1.5 transition-colors
              ${!hasOverride
                ? 'bg-primary/10 text-primary font-medium'
                : 'text-foreground hover:bg-muted active:bg-muted'
              }
            `}
          >
            <div className="flex items-center gap-1.5 text-[13px]"><Settings size={13} strokeWidth={1.75} /> Project Default</div>
            <div className="text-[10px] text-muted-foreground mt-0.5">
              Use project or global permission settings
            </div>
          </button>

          <div className="my-1 border-t border-border" />

          {/* Preset options */}
          {!showCustom && (
            <>
              {PRESETS.map((preset) => {
                const isActive = value?.profile && profilesEqual(preset.profile, value.profile as CategoryProfile);
                return (
                  <button
                    key={preset.id}
                    onClick={() => handleSelectPreset(preset)}
                    className={`
                      w-full text-left px-3 py-1.5 transition-colors
                      ${isActive
                        ? 'bg-primary/10 text-primary font-medium'
                        : 'text-foreground hover:bg-muted active:bg-muted'
                      }
                    `}
                  >
                    <div className="flex items-center gap-1.5 text-[13px]"><preset.icon size={13} strokeWidth={1.75} /> {preset.label}</div>
                    <div className="text-[10px] text-muted-foreground mt-0.5">
                      {preset.description}
                    </div>
                  </button>
                );
              })}

              <div className="my-1 border-t border-border" />

              {/* Custom option */}
              <button
                onClick={() => setShowCustom(true)}
                className={`
                  w-full text-left px-3 py-1.5 transition-colors
                  ${triggerLabel === 'Custom'
                    ? 'bg-primary/10 text-primary font-medium'
                    : 'text-foreground hover:bg-muted active:bg-muted'
                  }
                `}
              >
                <div className="flex items-center gap-1.5 text-[13px]"><SlidersHorizontal size={13} strokeWidth={1.75} /> Custom...</div>
                <div className="text-[10px] text-muted-foreground mt-0.5">
                  Fine-tune each category individually
                </div>
              </button>
            </>
          )}

          {/* Custom category editor */}
          {showCustom && (
            <div className="px-3 py-2 space-y-1">
              <button
                onClick={() => setShowCustom(false)}
                className="text-[10px] text-muted-foreground hover:text-foreground mb-1"
              >
                &larr; Back to presets
              </button>
              {CATEGORY_ORDER.map((cat) => {
                const isLocked = cat === 'userQuestions';
                const currentValue = (value?.profile as Record<string, CategoryAction> | undefined)?.[cat];
                return (
                  <div key={cat} className="flex items-center justify-between py-0.5">
                    <span className="text-[11px] font-medium">{CATEGORY_LABELS[cat]}</span>
                    <select
                      value={isLocked ? 'ask' : (currentValue ?? 'inherit')}
                      onChange={(e) => {
                        const val = e.target.value;
                        if (val === 'inherit') {
                          // Remove this category from override
                          const newProfile = { ...value?.profile } as Record<string, CategoryAction>;
                          delete newProfile[cat];
                          onChange(Object.keys(newProfile).length > 0
                            ? { ...value, enabled: true, profile: newProfile as CategoryProfile }
                            : null);
                        } else {
                          handleCustomChange(cat, val as CategoryAction);
                        }
                      }}
                      disabled={isLocked}
                      className={`h-5 px-1.5 text-[10px] bg-background border border-border rounded-full focus:outline-none focus:ring-1 focus:ring-primary ${
                        isLocked ? 'opacity-50 cursor-not-allowed' : ''
                      } ${currentValue ? '' : 'text-muted-foreground'}`}
                    >
                      <option value="inherit">Inherit</option>
                      {ACTION_OPTIONS.map((opt) => (
                        <option key={opt.value} value={opt.value}>{opt.label}</option>
                      ))}
                    </select>
                  </div>
                );
              })}
            </div>
          )}

          {/* Info footer */}
          <div className="px-3 py-1.5 text-[10px] text-muted-foreground border-t border-border mt-1">
            <span className="flex items-center gap-1"><Lightbulb size={10} strokeWidth={1.75} /> Session override is temporary</span>
          </div>
        </div>
      )}
    </div>
  );
}
