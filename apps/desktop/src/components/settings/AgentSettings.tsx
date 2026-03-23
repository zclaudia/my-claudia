import { useState, useEffect, useCallback } from 'react';
import { fetchApi, getProviders } from '../../services/api';
import type { ProviderConfig } from '@my-claudia/shared';
import { ShortcutSettings } from './ShortcutSettings';

interface AgentConfig {
  id: number;
  enabled: boolean;
  projectId: string | null;
  sessionId: string | null;
  providerId: string | null;
  permissionPolicy: string | null;
  createdAt: number;
  updatedAt: number;
}

interface AgentCapabilities {
  tools: Array<{ id: string; name: string; description: string; scope: string[] }>;
  skills: Array<{ id: string; name: string; description: string }>;
  contextTemplates: string[];
  maxConcurrentTasks: number;
}

export function AgentSettings() {
  const [config, setConfig] = useState<AgentConfig | null>(null);
  const [capabilities, setCapabilities] = useState<AgentCapabilities | null>(null);
  const [providers, setProviders] = useState<ProviderConfig[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [configRes, capsRes, providerList] = await Promise.all([
        fetchApi<AgentConfig>('/api/agent/config'),
        fetchApi<AgentCapabilities>('/api/agent/capabilities'),
        getProviders().catch(() => [] as ProviderConfig[]),
      ]);
      if (configRes.success && configRes.data) setConfig(configRes.data);
      if (capsRes.success && capsRes.data) setCapabilities(capsRes.data);
      setProviders(providerList);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to load agent settings');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadData(); }, [loadData]);

  const saveConfig = useCallback(async (updates: {
    enabled?: boolean;
    providerId?: string | null;
  }) => {
    setSaving(true);
    try {
      const res = await fetchApi<AgentConfig>('/api/agent/config', {
        method: 'PUT',
        body: JSON.stringify(updates),
      });
      if (res.success && res.data) setConfig(res.data);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to save');
    } finally {
      setSaving(false);
    }
  }, []);

  if (loading) {
    return (
      <div className="space-y-6">
        <div className="p-3 bg-secondary/50 rounded-lg text-sm text-muted-foreground">Loading...</div>
      </div>
    );
  }

  if (error && !config) {
    return (
      <div className="space-y-6">
        <div className="p-3 bg-destructive/10 rounded-lg text-sm">
          <p className="text-destructive">Could not load agent settings from server.</p>
          <p className="text-xs text-destructive/70 mt-1">{error}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">

      {/* General */}
      <div>
        <h3 className="text-sm font-medium mb-3">General</h3>
        <div className="p-3 bg-secondary/50 rounded-lg space-y-3">
          {/* Enable toggle */}
          <div className="flex items-center justify-between">
            <div>
              <span className="text-sm">Claudia</span>
              <p className="text-xs text-muted-foreground mt-0.5">
                Personal assistant with tools, skills, and task orchestration
              </p>
            </div>
            <button
              onClick={() => saveConfig({ enabled: !config?.enabled })}
              disabled={saving}
              className={`relative w-10 h-5 rounded-full transition-colors flex-shrink-0 ${
                config?.enabled ? 'bg-primary' : 'bg-muted'
              }`}
            >
              <span className={`absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform ${
                config?.enabled ? 'translate-x-5' : 'translate-x-0'
              }`} />
            </button>
          </div>

          {/* Provider */}
          <div className="pt-2 border-t border-border">
            <div className="flex items-center justify-between">
              <span className="text-sm">Provider</span>
              <select
                value={config?.providerId || ''}
                onChange={(e) => saveConfig({ providerId: e.target.value || null })}
                disabled={saving}
                className="h-7 px-2 text-xs bg-background border border-border rounded-md focus:outline-none focus:ring-1 focus:ring-primary"
              >
                <option value="">Default (same as chat)</option>
                {providers.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}{p.isDefault ? ' (default)' : ''}
                  </option>
                ))}
              </select>
            </div>
            <p className="text-[10px] text-muted-foreground/70 mt-1">
              Choose which provider the agent uses
            </p>
          </div>
        </div>
      </div>

      {/* Global Shortcut - desktop only */}
      {typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window && !navigator.userAgent.includes('Android') && (
        <div>
          <h3 className="text-sm font-medium mb-3">Shortcut</h3>
          <ShortcutSettings />
        </div>
      )}

      {/* Capabilities */}
      {capabilities && (
        <div>
          <h3 className="text-sm font-medium mb-3">Capabilities</h3>
          <div className="space-y-2">

            {/* Tools */}
            <div className="p-3 bg-secondary/50 rounded-lg">
              <div className="flex items-center justify-between mb-2">
                <span className="text-sm">Tools</span>
                <span className="text-xs text-muted-foreground">{capabilities.tools.length}</span>
              </div>
              {capabilities.tools.length === 0 ? (
                <p className="text-xs text-muted-foreground">No agent tools registered.</p>
              ) : (
                <div className="space-y-1">
                  {capabilities.tools.map((tool) => (
                    <div key={tool.id} className="flex items-center justify-between text-xs">
                      <span className="font-mono text-foreground/80">{tool.name}</span>
                      <span className="text-muted-foreground truncate ml-2 max-w-[50%] text-right">{tool.description}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Skills */}
            {capabilities.skills.length > 0 && (
              <div className="p-3 bg-secondary/50 rounded-lg">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-sm">Skills</span>
                  <span className="text-xs text-muted-foreground">{capabilities.skills.length}</span>
                </div>
                <div className="space-y-1">
                  {capabilities.skills.map((skill) => (
                    <div key={skill.id} className="flex items-center justify-between text-xs">
                      <span className="text-foreground/80">{skill.name}</span>
                      {skill.description && (
                        <span className="text-muted-foreground truncate ml-2 max-w-[50%] text-right">{skill.description}</span>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Runtime */}
            <div className="p-3 bg-secondary/50 rounded-lg">
              <div className="flex items-center justify-between mb-2">
                <span className="text-sm">Runtime</span>
              </div>
              <div className="space-y-1">
                <div className="flex items-center justify-between text-xs">
                  <span className="text-muted-foreground">Max Concurrent Tasks</span>
                  <span className="font-mono">{capabilities.maxConcurrentTasks}</span>
                </div>
                <div className="flex items-center justify-between text-xs">
                  <span className="text-muted-foreground">Context Templates</span>
                  <span className="font-mono">{capabilities.contextTemplates.join(', ')}</span>
                </div>
              </div>
            </div>

          </div>
        </div>
      )}

    </div>
  );
}
