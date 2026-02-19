import { useState, useEffect, useCallback } from 'react';
import type { Project, ProviderConfig, AgentPermissionPolicy } from '@my-claudia/shared';
import { useServerStore } from '../stores/serverStore';
import { useProjectStore } from '../stores/projectStore';
import * as api from '../services/api';

const TRUST_LEVELS: Array<{ id: AgentPermissionPolicy['trustLevel']; label: string; description: string }> = [
  { id: 'conservative', label: 'Conservative', description: 'Only auto-approve read-only tools' },
  { id: 'moderate', label: 'Moderate', description: 'Auto-approve reads + file edits' },
  { id: 'aggressive', label: 'Aggressive', description: 'Auto-approve most ops, network commands still ask' },
  { id: 'full_trust', label: 'Full Trust', description: 'Auto-approve everything except dangerous bash' },
];

interface ProjectSettingsProps {
  project: Project | null;
  isOpen: boolean;
  onClose: () => void;
}

export function ProjectSettings({ project, isOpen, onClose }: ProjectSettingsProps) {
  const { connectionStatus } = useServerStore();
  const { updateProject } = useProjectStore();
  const isConnected = connectionStatus === 'connected';

  const [providers, setProviders] = useState<ProviderConfig[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);

  // Form state
  const [name, setName] = useState('');
  const [rootPath, setRootPath] = useState('');
  const [providerId, setProviderId] = useState<string>('');
  const [systemPrompt, setSystemPrompt] = useState('');

  // Permission override state
  const [hasOverride, setHasOverride] = useState(false);
  const [permOverride, setPermOverride] = useState<Partial<AgentPermissionPolicy>>({});

  const updateOverride = useCallback((update: Partial<AgentPermissionPolicy>) => {
    setPermOverride(prev => ({ ...prev, ...update }));
  }, []);

  // Load providers and populate form when project changes
  useEffect(() => {
    if (isOpen && isConnected) {
      loadProviders();
    }
    if (project) {
      setName(project.name);
      setRootPath(project.rootPath || '');
      setProviderId(project.providerId || '');
      setSystemPrompt(project.systemPrompt || '');
      // Permission override
      if (project.agentPermissionOverride) {
        setHasOverride(true);
        setPermOverride(project.agentPermissionOverride);
      } else {
        setHasOverride(false);
        setPermOverride({});
      }
    }
  }, [isOpen, project, isConnected]);

  const loadProviders = async () => {
    setLoading(true);
    try {
      const data = await api.getProviders();
      setProviders(data);
    } catch (error) {
      console.error('Failed to load providers:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleSave = async () => {
    if (!project || !name.trim()) return;

    setSaving(true);
    try {
      const updates: Partial<Project> = {
        name: name.trim(),
        rootPath: rootPath.trim() || undefined,
        providerId: providerId || undefined,
        systemPrompt: systemPrompt.trim() || undefined,
        agentPermissionOverride: hasOverride ? permOverride : undefined,
      };

      await api.updateProject(project.id, updates);
      updateProject(project.id, updates);

      onClose();
    } catch (error) {
      console.error('Failed to update project:', error);
    } finally {
      setSaving(false);
    }
  };

  if (!isOpen || !project) return null;

  return (
    <>
      {/* Backdrop */}
      <div className="fixed inset-0 bg-black/50 z-50" onClick={onClose} />

      {/* Modal */}
      <div className="fixed inset-4 md:inset-auto md:top-1/2 md:left-1/2 md:-translate-x-1/2 md:-translate-y-1/2 md:w-[500px] md:max-h-[80vh] bg-card border border-border rounded-lg shadow-xl z-50 flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-border">
          <h2 className="text-lg font-semibold text-card-foreground">Project Settings</h2>
          <button
            onClick={onClose}
            className="p-1 rounded hover:bg-muted text-muted-foreground hover:text-foreground"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          {/* Project Name */}
          <div>
            <label className="block text-sm font-medium text-muted-foreground mb-1">
              Project Name *
            </label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full px-3 py-2 bg-input border border-border rounded-lg text-sm text-foreground focus:outline-none focus:border-primary"
            />
          </div>

          {/* Working Directory */}
          <div>
            <label className="block text-sm font-medium text-muted-foreground mb-1">
              Working Directory
            </label>
            <input
              type="text"
              value={rootPath}
              onChange={(e) => setRootPath(e.target.value)}
              placeholder="/path/to/project"
              className="w-full px-3 py-2 bg-input border border-border rounded-lg text-sm text-foreground focus:outline-none focus:border-primary font-mono"
            />
            <p className="text-xs text-muted-foreground mt-1">
              The directory where Claude will execute commands
            </p>
          </div>

          {/* Provider */}
          <div>
            <label className="block text-sm font-medium text-muted-foreground mb-1">
              Provider
            </label>
            <select
              value={providerId}
              onChange={(e) => setProviderId(e.target.value)}
              disabled={loading}
              className="w-full h-[38px] px-3 bg-input border border-border rounded-lg text-sm text-foreground focus:outline-none focus:border-primary"
            >
              <option value="">Default Provider</option>
              {providers.map((provider) => (
                <option key={provider.id} value={provider.id}>
                  {provider.name} ({provider.type})
                  {provider.isDefault ? ' - Default' : ''}
                </option>
              ))}
            </select>
            <p className="text-xs text-muted-foreground mt-1">
              Select which Claude configuration to use for this project
            </p>
          </div>

          {/* System Prompt */}
          <div>
            <label className="block text-sm font-medium text-muted-foreground mb-1">
              System Prompt
            </label>
            <textarea
              value={systemPrompt}
              onChange={(e) => setSystemPrompt(e.target.value)}
              placeholder="You are a helpful assistant..."
              rows={4}
              className="w-full px-3 py-2 bg-input border border-border rounded-lg text-sm text-foreground focus:outline-none focus:border-primary resize-none"
            />
            <p className="text-xs text-muted-foreground mt-1">
              Custom instructions to prepend to every conversation
            </p>
          </div>

          {/* Permission Override */}
          <div className="border-t border-border pt-4">
            <div className="flex items-center justify-between mb-2">
              <div>
                <label className="block text-sm font-medium text-muted-foreground">
                  Agent Permission Override
                </label>
                <p className="text-xs text-muted-foreground mt-0.5">
                  Override the global agent permission policy for this project
                </p>
              </div>
              <button
                onClick={() => {
                  setHasOverride(!hasOverride);
                  if (!hasOverride) {
                    setPermOverride({ trustLevel: 'moderate' });
                  }
                }}
                className={`relative w-10 h-5 rounded-full transition-colors flex-shrink-0 ${
                  hasOverride ? 'bg-primary' : 'bg-muted'
                }`}
              >
                <span
                  className={`absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform ${
                    hasOverride ? 'translate-x-5' : 'translate-x-0'
                  }`}
                />
              </button>
            </div>

            {!hasOverride && (
              <p className="text-xs text-muted-foreground/70 italic">
                Using global default policy
              </p>
            )}

            {hasOverride && (
              <div className="space-y-3 mt-3 pl-3 border-l-2 border-primary/30">
                {/* Trust level */}
                <div>
                  <p className="text-xs font-medium text-muted-foreground mb-1.5">Trust Level</p>
                  <div className="space-y-1.5">
                    {TRUST_LEVELS.map(level => (
                      <button
                        key={level.id}
                        onClick={() => updateOverride({ trustLevel: level.id })}
                        className={`w-full text-left p-2 rounded-lg border transition-colors ${
                          permOverride.trustLevel === level.id
                            ? 'border-primary bg-primary/5'
                            : 'border-border hover:border-muted-foreground/30'
                        }`}
                      >
                        <div className="flex items-center gap-2">
                          <div className={`w-2.5 h-2.5 rounded-full border-2 flex items-center justify-center ${
                            permOverride.trustLevel === level.id ? 'border-primary' : 'border-muted-foreground/40'
                          }`}>
                            {permOverride.trustLevel === level.id && (
                              <div className="w-1 h-1 rounded-full bg-primary" />
                            )}
                          </div>
                          <span className="text-xs font-medium">{level.label}</span>
                        </div>
                        <p className="text-[10px] text-muted-foreground mt-0.5 ml-[18px]">
                          {level.description}
                        </p>
                      </button>
                    ))}
                  </div>
                </div>

              </div>
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="flex justify-end gap-2 px-4 py-3 border-t border-border">
          <button
            onClick={onClose}
            className="px-4 py-2 bg-secondary hover:bg-secondary/80 text-secondary-foreground rounded-lg text-sm font-medium"
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            disabled={!name.trim() || saving}
            className="px-4 py-2 bg-primary hover:bg-primary/90 text-primary-foreground rounded-lg text-sm font-medium disabled:opacity-50"
          >
            {saving ? 'Saving...' : 'Save'}
          </button>
        </div>
      </div>
    </>
  );
}

