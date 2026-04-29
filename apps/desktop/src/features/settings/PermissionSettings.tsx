import { useState, useEffect, useCallback } from 'react';
import { getAgentConfig, updateAgentConfig } from '../../services/api/servers';
import { listAllWorkflows } from '../../features/workflows/api';
import * as providersApi from '../../services/api/providers';
import type { ProviderConfig } from '@my-claudia/shared/core/provider';
import { useProviderMetaStore } from '../../stores/providerMetaStore';
import { useServerStore } from '../../stores/serverStore';
import type {
  UnifiedPermissionPolicy,
  CategoryAction,
  PermissionCategory,
  GlobalGuards,
  AIReviewConfig,
  Workflow,
} from '@my-claudia/shared';
import {
  DEFAULT_UNIFIED_POLICY,
  normalizeToUnifiedPolicy,
} from '@my-claudia/shared';

const PERMISSION_FALLBACK_TEMPLATE_ID = 'permission-escalation-default';

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

function AIReviewProviderSelector({ value, onChange, disabled }: {
  value?: string;
  onChange: (id: string | undefined) => void;
  disabled: boolean;
}) {
  const activeServerId = useServerStore((s) => s.activeServerId);
  const storeProviders = useProviderMetaStore((s) => s.getProviders(activeServerId));
  const [providers, setProviders] = useState<ProviderConfig[]>(storeProviders);
  const [eligibleProviderIds, setEligibleProviderIds] = useState<Record<string, boolean>>({});

  useEffect(() => {
    if (storeProviders.length > 0) {
      setProviders(storeProviders);
      return;
    }

    let cancelled = false;
    void providersApi.getProviders()
      .then((loadedProviders) => {
        if (cancelled) return;
        setProviders(loadedProviders);
        useProviderMetaStore.getState().setProviders(loadedProviders, activeServerId);
      })
      .catch(() => {});

    return () => {
      cancelled = true;
    };
  }, [activeServerId, storeProviders]);

  useEffect(() => {
    let cancelled = false;

    const loadCapabilities = async () => {
      const results = await Promise.all(providers.map(async (provider) => {
        try {
          const capabilities = await providersApi.getProviderCapabilities(provider.id);
          return [provider.id, capabilities.supportsAIReview === true] as const;
        } catch {
          return [provider.id, false] as const;
        }
      }));

      if (!cancelled) {
        setEligibleProviderIds(Object.fromEntries(results));
      }
    };

    void loadCapabilities();
    return () => {
      cancelled = true;
    };
  }, [providers]);

  const eligibleProviders = providers.filter((provider) => eligibleProviderIds[provider.id] === true);
  const selectedProvider = value ? providers.find((provider) => provider.id === value) : undefined;
  const selectedProviderSupported = selectedProvider ? eligibleProviderIds[selectedProvider.id] === true : true;

  return (
    <div className="flex items-center justify-between">
      <div>
        <span className="text-xs font-medium">Review provider</span>
        <p className="text-[10px] text-muted-foreground">Only providers that support AI review are shown here</p>
      </div>
      <div className="flex flex-col items-end gap-1">
        <select
          value={value || ''}
          onChange={(e) => onChange(e.target.value || undefined)}
          disabled={disabled}
          className="h-6 px-1.5 text-[11px] bg-background border border-border rounded-md focus:outline-none focus:ring-1 focus:ring-primary max-w-[220px]"
        >
          <option value="">Session default</option>
          {selectedProvider && !selectedProviderSupported && (
            <option value={selectedProvider.id}>
              {selectedProvider.name} ({selectedProvider.type}) - unsupported
            </option>
          )}
          {eligibleProviders.map((provider) => (
            <option key={provider.id} value={provider.id}>{provider.name} ({provider.type})</option>
          ))}
        </select>
        {selectedProvider && !selectedProviderSupported && (
          <p className="text-[10px] text-amber-600">
            The selected provider does not support AI review and cannot be used here.
          </p>
        )}
      </div>
    </div>
  );
}

export function PermissionSettings() {
  const [policy, setPolicy] = useState<UnifiedPermissionPolicy>(DEFAULT_UNIFIED_POLICY);
  const [workflowOptions, setWorkflowOptions] = useState<Workflow[]>([]);
  const [selectedWorkflowId, setSelectedWorkflowId] = useState<string>('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadPolicy = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [config, workflows] = await Promise.all([
        getAgentConfig(),
        listAllWorkflows(),
      ]);

      setSelectedWorkflowId(config.permissionWorkflowOverrideId ?? '');
      setWorkflowOptions(
        workflows.filter((workflow) =>
          workflow.status === 'active'
          && !workflow.isSystem
          && workflow.templateId !== PERMISSION_FALLBACK_TEMPLATE_ID
        ),
      );

      if (config.permissionPolicy) {
        const raw = JSON.parse(config.permissionPolicy);
        setPolicy(normalizeToUnifiedPolicy(raw));
      } else {
        setPolicy(DEFAULT_UNIFIED_POLICY);
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to load');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadPolicy(); }, [loadPolicy]);

  const savePolicy = useCallback(async (updated: UnifiedPermissionPolicy) => {
    setSaving(true);
    try {
      await updateAgentConfig({ permissionPolicy: JSON.stringify(updated) });
      setPolicy(updated);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to save');
    } finally {
      setSaving(false);
    }
  }, []);

  const updatePermissionWorkflowOverride = useCallback(async (workflowId: string) => {
    setSaving(true);
    setError(null);
    try {
      const config = await updateAgentConfig({
        permissionWorkflowOverrideId: workflowId || null,
      });
      setSelectedWorkflowId(config.permissionWorkflowOverrideId ?? '');
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to save');
    } finally {
      setSaving(false);
    }
  }, []);

  const updateCategory = useCallback((category: PermissionCategory, action: CategoryAction) => {
    const updated = {
      ...policy,
      profile: { ...policy.profile, [category]: action },
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

  const updateAIReview = useCallback((patch: Partial<AIReviewConfig>) => {
    const updated = {
      ...policy,
      aiReview: { ...policy.aiReview, ...patch },
    };
    savePolicy(updated);
  }, [policy, savePolicy]);

  const toggleEnabled = useCallback(() => {
    const updated = { ...policy, enabled: !policy.enabled };
    savePolicy(updated);
  }, [policy, savePolicy]);

  const resetDefaults = useCallback(() => {
    savePolicy(DEFAULT_UNIFIED_POLICY);
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

      {/* Unified category profile */}
      {policy.enabled && (
        <div>
          <h3 className="text-sm font-medium mb-3">Permission Categories</h3>
          <div className="border border-border rounded-lg px-3 pb-2.5 pt-1 space-y-0.5">
            {CATEGORY_ORDER.map((cat) => (
              <CategoryRow
                key={cat}
                category={cat}
                value={policy.profile[cat]}
                onChange={(action) => updateCategory(cat, action)}
                disabled={saving}
              />
            ))}
          </div>
        </div>
      )}

      {/* AI Review */}
      {policy.enabled && (
        <div>
          <h3 className="text-sm font-medium mb-3">AI Review</h3>
          <div className="p-3 bg-secondary/50 rounded-lg space-y-3">
            <label className="flex items-center justify-between cursor-pointer">
              <div>
                <span className="text-xs font-medium">Enable AI Review</span>
                <p className="text-[10px] text-muted-foreground">
                  When a blacklisted command times out, AI reviews it before denying
                </p>
              </div>
              <button
                onClick={() => updateAIReview({ enabled: !policy.aiReview.enabled })}
                disabled={saving}
                className={`relative w-9 h-[18px] rounded-full transition-colors flex-shrink-0 ${
                  policy.aiReview.enabled ? 'bg-primary' : 'bg-muted'
                }`}
              >
                <span className={`absolute top-[2px] left-[2px] w-[14px] h-[14px] rounded-full bg-white shadow transition-transform ${
                  policy.aiReview.enabled ? 'translate-x-[18px]' : 'translate-x-0'
                }`} />
              </button>
            </label>

            {policy.aiReview.enabled && (
              <>
                <div className="flex items-center justify-between">
                  <div>
                    <span className="text-xs font-medium">Review timeout</span>
                    <p className="text-[10px] text-muted-foreground">Seconds before triggering AI review</p>
                  </div>
                  <input
                    type="number"
                    min={10}
                    max={300}
                    defaultValue={policy.aiReview.timeoutBeforeReview}
                    onBlur={(e) => updateAIReview({ timeoutBeforeReview: Math.max(10, parseInt(e.target.value) || 60) })}
                    disabled={saving}
                    className="w-16 h-6 px-1.5 text-[11px] text-right bg-background border border-border rounded-md focus:outline-none focus:ring-1 focus:ring-primary"
                  />
                </div>
                <div className="flex items-center justify-between">
                  <div>
                    <span className="text-xs font-medium">Confidence threshold</span>
                    <p className="text-[10px] text-muted-foreground">AI must be this confident to auto-approve (%)</p>
                  </div>
                  <input
                    type="number"
                    min={50}
                    max={100}
                    defaultValue={Math.round(policy.aiReview.confidenceThreshold * 100)}
                    onBlur={(e) => updateAIReview({ confidenceThreshold: Math.max(0.5, Math.min(1, (parseInt(e.target.value) || 80) / 100)) })}
                    disabled={saving}
                    className="w-16 h-6 px-1.5 text-[11px] text-right bg-background border border-border rounded-md focus:outline-none focus:ring-1 focus:ring-primary"
                  />
                </div>
                <div className="flex items-center justify-between">
                  <div>
                    <span className="text-xs font-medium">Rate limit</span>
                    <p className="text-[10px] text-muted-foreground">Max auto-approvals per minute</p>
                  </div>
                  <input
                    type="number"
                    min={1}
                    max={60}
                    defaultValue={policy.aiReview.maxAutoApprovalsPerMinute}
                    onBlur={(e) => updateAIReview({ maxAutoApprovalsPerMinute: Math.max(1, parseInt(e.target.value) || 10) })}
                    disabled={saving}
                    className="w-16 h-6 px-1.5 text-[11px] text-right bg-background border border-border rounded-md focus:outline-none focus:ring-1 focus:ring-primary"
                  />
                </div>
                <AIReviewProviderSelector
                  value={policy.aiReview.analysisProviderId}
                  onChange={(id) => updateAIReview({ analysisProviderId: id })}
                  disabled={saving}
                />
              </>
            )}
          </div>
        </div>
      )}

      <div>
        <h3 className="text-sm font-medium mb-3">Permission Workflow</h3>
        <div className="p-3 bg-secondary/50 rounded-lg space-y-3">
          <div className="flex items-center justify-between gap-4">
            <div>
              <span className="text-xs font-medium">Global override</span>
              <p className="text-[10px] text-muted-foreground">
                Optional workflow override. If unavailable, the system fallback workflow is still used.
              </p>
            </div>
            <select
              value={selectedWorkflowId}
              onChange={(e) => { void updatePermissionWorkflowOverride(e.target.value); }}
              disabled={saving || loading}
              className="h-7 min-w-[220px] px-2 text-[11px] bg-background border border-border rounded-md focus:outline-none focus:ring-1 focus:ring-primary"
            >
              <option value="">System fallback only</option>
              {workflowOptions.map((workflow) => (
                <option key={workflow.id} value={workflow.id}>
                  {workflow.projectId ? `[Project] ${workflow.name}` : `[Global] ${workflow.name}`}
                </option>
              ))}
            </select>
          </div>
          <p className="text-[10px] text-muted-foreground">
            Resolution order: project override, then global override, then immutable system fallback.
          </p>
        </div>
      </div>

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
