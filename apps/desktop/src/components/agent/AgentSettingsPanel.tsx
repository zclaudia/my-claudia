import { useState, useEffect, useCallback } from 'react';
import { useAgentStore } from '../../stores/agentStore';
import * as api from '../../services/api';
import type { AgentPermissionPolicy } from '@my-claudia/shared';

interface AgentSettingsPanelProps {
  onClose: () => void;
}

const DEFAULT_POLICY: AgentPermissionPolicy = {
  enabled: false,
  trustLevel: 'conservative',
  customRules: [],
  escalateAlways: ['AskUserQuestion'],
};

const TRUST_LEVELS: Array<{
  id: AgentPermissionPolicy['trustLevel'];
  label: string;
  description: string;
}> = [
  {
    id: 'conservative',
    label: 'Conservative',
    description: 'Auto-approve read-only tools (Read, Glob, Grep). Everything else asks you.',
  },
  {
    id: 'moderate',
    label: 'Moderate',
    description: 'Also auto-approve file edits (Write, Edit). Bash still asks you.',
  },
  {
    id: 'aggressive',
    label: 'Aggressive',
    description: 'Auto-approve most tools including safe Bash commands. Only dangerous commands ask.',
  },
];

export function AgentSettingsPanel({ onClose }: AgentSettingsPanelProps) {
  const { permissionPolicy, updatePermissionPolicy } = useAgentStore();
  const [policy, setPolicy] = useState<AgentPermissionPolicy>(permissionPolicy || DEFAULT_POLICY);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);

  // Load policy from server on mount
  useEffect(() => {
    api.getAgentConfig()
      .then(config => {
        if (config.permissionPolicy) {
          try {
            const parsed = typeof config.permissionPolicy === 'string'
              ? JSON.parse(config.permissionPolicy)
              : config.permissionPolicy;
            setPolicy(parsed);
            updatePermissionPolicy(parsed);
          } catch {
            // Use default
          }
        }
      })
      .catch(err => {
        console.error('[AgentSettings] Failed to load config:', err);
      });
  }, [updatePermissionPolicy]);

  const handleSave = useCallback(async () => {
    setSaving(true);
    try {
      await api.updateAgentConfig({
        permissionPolicy: JSON.stringify(policy),
      });
      updatePermissionPolicy(policy);
      setDirty(false);
    } catch (err) {
      console.error('[AgentSettings] Failed to save:', err);
    } finally {
      setSaving(false);
    }
  }, [policy, updatePermissionPolicy]);

  const updatePolicy = useCallback((update: Partial<AgentPermissionPolicy>) => {
    setPolicy(prev => ({ ...prev, ...update }));
    setDirty(true);
  }, []);

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-border flex-shrink-0">
        <div className="flex items-center gap-2">
          <button
            onClick={onClose}
            className="p-1 rounded hover:bg-secondary text-muted-foreground hover:text-foreground"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
          </button>
          <span className="font-semibold text-sm">Permission Settings</span>
        </div>
        {dirty && (
          <button
            onClick={handleSave}
            disabled={saving}
            className="px-3 py-1 text-xs rounded bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
          >
            {saving ? 'Saving...' : 'Save'}
          </button>
        )}
      </div>

      {/* Settings body */}
      <div className="flex-1 overflow-y-auto p-4 space-y-5">
        {/* Master toggle */}
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm font-medium">Auto-approve permissions</p>
            <p className="text-xs text-muted-foreground mt-0.5">
              Let the agent automatically handle permission requests
            </p>
          </div>
          <button
            onClick={() => updatePolicy({ enabled: !policy.enabled })}
            className={`relative w-10 h-5 rounded-full transition-colors ${
              policy.enabled ? 'bg-primary' : 'bg-muted'
            }`}
          >
            <span
              className={`absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform ${
                policy.enabled ? 'translate-x-5' : 'translate-x-0'
              }`}
            />
          </button>
        </div>

        {policy.enabled && (
          <>
            {/* Trust level */}
            <div>
              <p className="text-sm font-medium mb-2">Trust level</p>
              <div className="space-y-2">
                {TRUST_LEVELS.map(level => (
                  <button
                    key={level.id}
                    onClick={() => updatePolicy({ trustLevel: level.id })}
                    className={`w-full text-left p-3 rounded-lg border transition-colors ${
                      policy.trustLevel === level.id
                        ? 'border-primary bg-primary/5'
                        : 'border-border hover:border-muted-foreground/30'
                    }`}
                  >
                    <div className="flex items-center gap-2">
                      <div className={`w-3 h-3 rounded-full border-2 flex items-center justify-center ${
                        policy.trustLevel === level.id ? 'border-primary' : 'border-muted-foreground/40'
                      }`}>
                        {policy.trustLevel === level.id && (
                          <div className="w-1.5 h-1.5 rounded-full bg-primary" />
                        )}
                      </div>
                      <span className="text-sm font-medium">{level.label}</span>
                    </div>
                    <p className="text-xs text-muted-foreground mt-1 ml-5">
                      {level.description}
                    </p>
                  </button>
                ))}
              </div>
            </div>

            {/* Quick reference */}
            <div className="rounded-lg border border-border p-3">
              <p className="text-xs font-medium text-muted-foreground mb-2">What gets auto-approved:</p>
              <div className="space-y-1">
                <PolicyRow label="Read, Glob, Grep, WebFetch" approved={true} />
                <PolicyRow label="Write, Edit" approved={policy.trustLevel !== 'conservative'} />
                <PolicyRow label="Task (subagents)" approved={policy.trustLevel !== 'conservative'} />
                <PolicyRow label="Safe Bash commands" approved={policy.trustLevel === 'aggressive'} />
                <PolicyRow label="Dangerous Bash (rm -rf, sudo)" approved={false} escalated />
                <PolicyRow label="AskUserQuestion" approved={false} escalated />
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function PolicyRow({ label, approved, escalated }: { label: string; approved: boolean; escalated?: boolean }) {
  return (
    <div className="flex items-center justify-between text-xs">
      <span className="text-muted-foreground">{label}</span>
      {escalated ? (
        <span className="text-amber-500">Asks you</span>
      ) : approved ? (
        <span className="text-green-500">Auto-approved</span>
      ) : (
        <span className="text-muted-foreground/60">Asks you</span>
      )}
    </div>
  );
}
