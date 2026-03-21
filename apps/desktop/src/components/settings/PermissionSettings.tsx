import { useState, useEffect, useCallback } from 'react';
import { fetchApi } from '../../services/api';
import type {
  CategoryPermissionPolicy,
  CategoryProfile,
  CategoryAction,
  PermissionCategory,
  GlobalGuards,
} from '@my-claudia/shared';
import {
  DEFAULT_CATEGORY_POLICY,
  DEFAULT_CATEGORY_PROFILES,
  DEFAULT_GLOBAL_GUARDS,
} from '@my-claudia/shared';

interface AgentConfigResponse {
  id: number;
  enabled: boolean;
  permissionPolicy: string | null;
}

const CATEGORY_LABELS: Record<PermissionCategory, { label: string; description: string }> = {
  fileRead: { label: 'File Read', description: 'Read, Glob, Grep, WebFetch, WebSearch' },
  fileWrite: { label: 'File Write', description: 'Write, Edit, NotebookEdit' },
  shellSafe: { label: 'Shell (safe)', description: 'Bash commands (non-network, non-destructive)' },
  networkOps: { label: 'Network Ops', description: 'curl, wget, ssh, git push/pull, npm publish' },
  destructiveOps: { label: 'Destructive Ops', description: 'rm -rf, sudo, mkfs, dd, format' },
  userQuestions: { label: 'User Questions', description: 'AskUserQuestion (always requires approval)' },
};

const CATEGORY_ORDER: PermissionCategory[] = [
  'fileRead', 'fileWrite', 'shellSafe', 'networkOps', 'destructiveOps', 'userQuestions',
];

const ACTION_OPTIONS: Array<{ value: CategoryAction; label: string }> = [
  { value: 'auto-approve', label: 'Auto-approve' },
  { value: 'ask', label: 'Ask' },
  { value: 'block', label: 'Block' },
];

const SESSION_SECTIONS: Array<{ key: keyof CategoryPermissionPolicy['profiles']; label: string; description: string }> = [
  { key: 'regular', label: 'Coding Sessions', description: 'Regular interactive sessions where you are actively reviewing' },
  { key: 'background', label: 'Supervisor Sessions', description: 'Background autonomous tasks like code review and PR management' },
  { key: 'agent', label: 'Agent Sessions', description: 'Agent assistant sessions with tool and task orchestration' },
];

function CategoryRow({ category, value, onChange, disabled }: {
  category: PermissionCategory;
  value: CategoryAction;
  onChange: (action: CategoryAction) => void;
  disabled?: boolean;
}) {
  const info = CATEGORY_LABELS[category];
  const isLocked = category === 'userQuestions';

  return (
    <div className="flex items-center justify-between py-1">
      <div className="min-w-0 mr-3">
        <span className="text-xs font-medium">{info.label}</span>
        <p className="text-[10px] text-muted-foreground truncate">{info.description}</p>
      </div>
      <select
        value={isLocked ? 'ask' : value}
        onChange={(e) => onChange(e.target.value as CategoryAction)}
        disabled={disabled || isLocked}
        className={`h-6 px-1.5 text-[11px] bg-background border border-border rounded-md focus:outline-none focus:ring-1 focus:ring-primary flex-shrink-0 ${
          isLocked ? 'opacity-50 cursor-not-allowed' : ''
        }`}
        title={isLocked ? 'User questions always require approval' : undefined}
      >
        {ACTION_OPTIONS.map((opt) => (
          <option key={opt.value} value={opt.value}>{opt.label}</option>
        ))}
      </select>
    </div>
  );
}

function ProfileSection({ label, description, profile, onChange, disabled, defaultOpen }: {
  label: string;
  description: string;
  profile: CategoryProfile;
  onChange: (category: PermissionCategory, action: CategoryAction) => void;
  disabled?: boolean;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen ?? true);

  return (
    <div className="border border-border rounded-lg overflow-hidden">
      <button
        onClick={() => setOpen(!open)}
        className="w-full flex items-center justify-between p-2.5 hover:bg-secondary/50 transition-colors"
      >
        <div className="text-left">
          <span className="text-xs font-medium">{label}</span>
          <p className="text-[10px] text-muted-foreground">{description}</p>
        </div>
        <svg
          className={`w-3.5 h-3.5 text-muted-foreground transition-transform flex-shrink-0 ${open ? 'rotate-180' : ''}`}
          fill="none" stroke="currentColor" viewBox="0 0 24 24"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>
      {open && (
        <div className="px-3 pb-2.5 space-y-0.5 border-t border-border">
          {CATEGORY_ORDER.map((cat) => (
            <CategoryRow
              key={cat}
              category={cat}
              value={profile[cat]}
              onChange={(action) => onChange(cat, action)}
              disabled={disabled}
            />
          ))}
        </div>
      )}
    </div>
  );
}

export function PermissionSettings() {
  const [policy, setPolicy] = useState<CategoryPermissionPolicy>(DEFAULT_CATEGORY_POLICY);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadPolicy = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetchApi<AgentConfigResponse>('/api/agent/config');
      if (res.success && res.data?.permissionPolicy) {
        const raw = JSON.parse(res.data.permissionPolicy);
        // Handle both old and new format client-side
        if (raw.profiles) {
          setPolicy({
            ...DEFAULT_CATEGORY_POLICY,
            ...raw,
            profiles: {
              regular: { ...DEFAULT_CATEGORY_PROFILES.regular, ...raw.profiles?.regular },
              background: { ...DEFAULT_CATEGORY_PROFILES.background, ...raw.profiles?.background },
              agent: { ...DEFAULT_CATEGORY_PROFILES.agent, ...raw.profiles?.agent },
            },
            globalGuards: { ...DEFAULT_GLOBAL_GUARDS, ...raw.globalGuards },
          });
        } else {
          // Old trustLevel format — use defaults (server will normalize on next save)
          setPolicy(DEFAULT_CATEGORY_POLICY);
        }
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to load');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadPolicy(); }, [loadPolicy]);

  const savePolicy = useCallback(async (updated: CategoryPermissionPolicy) => {
    setSaving(true);
    try {
      await fetchApi('/api/agent/config', {
        method: 'PUT',
        body: JSON.stringify({ permissionPolicy: JSON.stringify(updated) }),
      });
      setPolicy(updated);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to save');
    } finally {
      setSaving(false);
    }
  }, []);

  const updateProfile = useCallback((
    sessionType: keyof CategoryPermissionPolicy['profiles'],
    category: PermissionCategory,
    action: CategoryAction,
  ) => {
    const updated = {
      ...policy,
      profiles: {
        ...policy.profiles,
        [sessionType]: {
          ...policy.profiles[sessionType],
          [category]: action,
        },
      },
    };
    savePolicy(updated);
  }, [policy, savePolicy]);

  const updateGuard = useCallback((key: keyof GlobalGuards, value: boolean) => {
    const updated = {
      ...policy,
      globalGuards: { ...policy.globalGuards, [key]: value },
    };
    savePolicy(updated);
  }, [policy, savePolicy]);

  const toggleEnabled = useCallback(() => {
    const updated = { ...policy, enabled: !policy.enabled };
    savePolicy(updated);
  }, [policy, savePolicy]);

  const resetDefaults = useCallback(() => {
    savePolicy(DEFAULT_CATEGORY_POLICY);
  }, [savePolicy]);

  if (loading) {
    return (
      <div className="space-y-6">
        <div className="p-3 bg-secondary/50 rounded-lg text-sm text-muted-foreground">Loading...</div>
      </div>
    );
  }

  return (
    <div className="space-y-6">

      {/* Enable toggle */}
      <div className="p-3 bg-secondary/50 rounded-lg">
        <div className="flex items-center justify-between">
          <div>
            <span className="text-sm">Auto-Approve Tools</span>
            <p className="text-xs text-muted-foreground mt-0.5">
              Automatically approve or block tool calls based on category rules
            </p>
          </div>
          <button
            onClick={toggleEnabled}
            disabled={saving}
            className={`relative w-10 h-5 rounded-full transition-colors flex-shrink-0 ${
              policy.enabled ? 'bg-primary' : 'bg-muted'
            }`}
          >
            <span className={`absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform ${
              policy.enabled ? 'translate-x-5' : 'translate-x-0'
            }`} />
          </button>
        </div>
        {!policy.enabled && (
          <p className="text-[10px] text-muted-foreground/70 mt-2 italic">
            When disabled, all tool calls require manual approval.
          </p>
        )}
      </div>

      {/* Session profiles */}
      {policy.enabled && (
        <div>
          <h3 className="text-sm font-medium mb-3">Session Profiles</h3>
          <div className="space-y-2">
            {SESSION_SECTIONS.map((section) => (
              <ProfileSection
                key={section.key}
                label={section.label}
                description={section.description}
                profile={policy.profiles[section.key]}
                onChange={(cat, action) => updateProfile(section.key, cat, action)}
                disabled={saving}
                defaultOpen={section.key === 'regular'}
              />
            ))}
          </div>
        </div>
      )}

      {/* Global guards */}
      {policy.enabled && (
        <div>
          <h3 className="text-sm font-medium mb-3">Safety Guards</h3>
          <div className="p-3 bg-secondary/50 rounded-lg space-y-2">
            <label className="flex items-start gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={policy.globalGuards.blockSensitiveFiles}
                onChange={(e) => updateGuard('blockSensitiveFiles', e.target.checked)}
                disabled={saving}
                className="mt-0.5 rounded border-border"
              />
              <div>
                <span className="text-xs font-medium">Protect sensitive files</span>
                <p className="text-[10px] text-muted-foreground">.env, .ssh, credentials, *.key, *.pem — requires approval even if category is auto-approve</p>
              </div>
            </label>
            <label className="flex items-start gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={policy.globalGuards.blockOutsideWorkspace}
                onChange={(e) => updateGuard('blockOutsideWorkspace', e.target.checked)}
                disabled={saving}
                className="mt-0.5 rounded border-border"
              />
              <div>
                <span className="text-xs font-medium">Enforce workspace scope</span>
                <p className="text-[10px] text-muted-foreground">Block file/bash operations targeting paths outside the project directory</p>
              </div>
            </label>
          </div>
        </div>
      )}

      {/* Reset + error */}
      {policy.enabled && (
        <button
          onClick={resetDefaults}
          disabled={saving}
          className="text-xs text-muted-foreground hover:text-foreground transition-colors"
        >
          Reset to defaults
        </button>
      )}

      {error && (
        <p className="text-xs text-destructive">{error}</p>
      )}
    </div>
  );
}
