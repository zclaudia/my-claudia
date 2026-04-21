import { useState, useEffect, useRef, useCallback } from 'react';
import type { Project, ProviderConfig, UnifiedPermissionPolicy, PermissionCategory, CategoryAction, CategoryProfile, Workflow } from '@my-claudia/shared';
import { useServerStore } from '../stores/serverStore';
import { useFacadeStore } from '../stores/facadeStore';
import { useProjectStore } from '../stores/projectStore';
import { useProviderMetaStore } from '../stores/providerMetaStore';
import { useSupervisionStore } from '../stores/supervisionStore';
import * as api from '../services/api';
import { useAndroidBack } from '../hooks/useAndroidBack';
import { isMobileBackendUsable } from '../services/mobileConnectionState';

const CATEGORY_LABELS: Record<PermissionCategory, { label: string; description: string }> = {
  fileRead: { label: 'File Read', description: 'Read, Glob, Grep, WebFetch' },
  fileWrite: { label: 'File Write', description: 'Write, Edit, NotebookEdit' },
  shellSafe: { label: 'Shell (safe)', description: 'Non-network, non-destructive bash' },
  networkOps: { label: 'Network Ops', description: 'curl, ssh, git push, npm publish' },
  destructiveOps: { label: 'Destructive', description: 'rm -rf, sudo, mkfs, dd' },
  userQuestions: { label: 'User Questions', description: 'AskUserQuestion' },
};

const CATEGORY_ORDER: PermissionCategory[] = [
  'fileRead', 'fileWrite', 'shellSafe', 'networkOps', 'destructiveOps', 'userQuestions',
];

const ACTION_OPTIONS: Array<{ value: CategoryAction | 'inherit'; label: string }> = [
  { value: 'inherit', label: 'Inherit' },
  { value: 'auto-approve', label: 'Auto-approve' },
  { value: 'ask', label: 'Ask' },
  { value: 'block', label: 'Block' },
];

const PERMISSION_FALLBACK_TEMPLATE_ID = 'permission-escalation-default';

interface ProjectSettingsProps {
  project: Project | null;
  isOpen: boolean;
  onClose: () => void;
}

export function ProjectSettings({ project, isOpen, onClose }: ProjectSettingsProps) {
  const activeServerId = useServerStore((s) => s.activeServerId);
  const facadeConnectionState = useFacadeStore((s) => s.connectionState);
  const facadeBackends = useFacadeStore((s) => s.backends);
  const isConnected = isMobileBackendUsable({
    backendId: activeServerId,
    connectionState: facadeConnectionState,
    backends: facadeBackends,
  });
  const legacyProviders = useProjectStore((s) => s.providers);
  const { updateProject } = useProjectStore();

  // Supervisor state
  const supervisorAgent = useSupervisionStore((s) => project ? s.agents[project.id] : undefined);
  const setAgent = useSupervisionStore((s) => s.setAgent);
  const removeAgent = useSupervisionStore((s) => s.removeAgent);
  const [supervisorLoading, setSupervisorLoading] = useState(false);

  const scopedProviders = useProviderMetaStore((s) => s.getProviders(activeServerId));
  const storeProviders = scopedProviders.length > 0 ? scopedProviders : legacyProviders;
  const [providers, setProviders] = useState<ProviderConfig[]>(storeProviders);
  const [saving, setSaving] = useState(false);
  const [saveFeedback, setSaveFeedback] = useState<{ type: 'success' | 'error'; message: string } | null>(null);
  const closeTimeoutRef = useRef<number | null>(null);

  // Form state
  const [name, setName] = useState('');
  const [rootPath, setRootPath] = useState('');
  const [providerId, setProviderId] = useState<string>('');
  const [reviewProviderId, setReviewProviderId] = useState<string>('');
  const [permissionWorkflowOverrideId, setPermissionWorkflowOverrideId] = useState<string>('');
  const [systemPrompt, setSystemPrompt] = useState('');
  const [workflowOptions, setWorkflowOptions] = useState<Workflow[]>([]);

  // Permission override state
  const [hasOverride, setHasOverride] = useState(false);
  const [permOverride, setPermOverride] = useState<Partial<UnifiedPermissionPolicy>>({});

  const effectiveAgent = supervisorAgent ?? project?.agent;
  const isSupervisorEnabled = Boolean(effectiveAgent && effectiveAgent.phase !== 'archived');

  // Keep local providers in sync with global store
  useEffect(() => {
    if (storeProviders.length > 0) {
      setProviders(storeProviders);
    }
  }, [storeProviders]);

  // Load providers and populate form when project changes
  useEffect(() => {
    if (!isOpen) {
      if (closeTimeoutRef.current !== null) {
        window.clearTimeout(closeTimeoutRef.current);
        closeTimeoutRef.current = null;
      }
      setSaveFeedback(null);
      return;
    }

    if (isOpen && isConnected) {
      loadProviders();
    }
  }, [isOpen, isConnected]);

  useEffect(() => {
    return () => {
      if (closeTimeoutRef.current !== null) {
        window.clearTimeout(closeTimeoutRef.current);
      }
    };
  }, []);

  useEffect(() => {
    if (!project) return;

    setName(project.name);
    setRootPath(project.rootPath || '');
    setProviderId(project.providerId || '');
    setReviewProviderId(project.reviewProviderId || '');
    setPermissionWorkflowOverrideId(project.permissionWorkflowOverrideId || '');
    setSystemPrompt(project.systemPrompt || '');
    if (project.agentPermissionOverride) {
      setHasOverride(true);
      setPermOverride(project.agentPermissionOverride);
    } else {
      setHasOverride(false);
      setPermOverride({});
    }
  }, [
    project?.id,
    project?.name,
    project?.rootPath,
    project?.providerId,
    project?.reviewProviderId,
    project?.permissionWorkflowOverrideId,
    project?.systemPrompt,
    project?.agentPermissionOverride,
  ]);

  // Keep supervisor toggle state consistent with backend source of truth.
  useEffect(() => {
    if (!isOpen || !project?.id || !isConnected) return;

    let cancelled = false;
    (async () => {
      try {
        const fetchedAgent = await api.getSupervisionAgent(project.id);
        if (cancelled) return;

        if (fetchedAgent) {
          setAgent(project.id, fetchedAgent);
          updateProject(project.id, { agent: fetchedAgent });
        } else {
          removeAgent(project.id);
          updateProject(project.id, { agent: undefined });
        }
      } catch (error) {
        console.error('Failed to sync supervisor agent state:', error);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [isOpen, project?.id, isConnected, setAgent, removeAgent, updateProject]);

  const loadProviders = async () => {
    const current = useProviderMetaStore.getState().getProviders(activeServerId);
    if (current.length > 0) {
      setProviders(current);
    }
    try {
      const data = await api.getProviders();
      setProviders(data);
      useProviderMetaStore.getState().setProviders(data, activeServerId);
    } catch (error) {
      console.error('Failed to load providers:', error);
    }
  };

  const loadPermissionWorkflowOptions = useCallback(async () => {
    if (!project?.id) return;
    try {
      const workflows = await api.listAllWorkflows();
      setWorkflowOptions(
        workflows.filter((workflow) =>
          workflow.status === 'active'
          && !workflow.isSystem
          && workflow.templateId !== PERMISSION_FALLBACK_TEMPLATE_ID
          && (!workflow.projectId || workflow.projectId === project.id)
        ),
      );
    } catch (error) {
      console.error('Failed to load permission workflows:', error);
      setWorkflowOptions([]);
    }
  }, [project?.id]);

  useEffect(() => {
    if (!isOpen || !project?.id || !isConnected) return;
    void loadPermissionWorkflowOptions();
  }, [isOpen, project?.id, isConnected, loadPermissionWorkflowOptions]);

  const handleSave = async () => {
    if (!project || !name.trim()) return;

    setSaving(true);
    setSaveFeedback(null);
    try {
      const updates: Partial<Project> = {
        name: name.trim(),
        rootPath: rootPath.trim() || undefined,
        providerId: providerId || undefined,
        reviewProviderId: reviewProviderId || undefined,
        permissionWorkflowOverrideId: permissionWorkflowOverrideId || undefined,
        systemPrompt: systemPrompt.trim() || undefined,
        agentPermissionOverride: hasOverride ? permOverride : undefined,
      };

      await api.updateProject(project.id, updates);
      updateProject(project.id, updates);
      setSaveFeedback({ type: 'success', message: 'Project settings saved.' });
      closeTimeoutRef.current = window.setTimeout(() => {
        closeTimeoutRef.current = null;
        onClose();
      }, 800);
    } catch (error) {
      console.error('Failed to update project:', error);
      setSaveFeedback({
        type: 'error',
        message: error instanceof Error ? error.message : 'Failed to save project settings',
      });
    } finally {
      setSaving(false);
    }
  };

  const handleToggleSupervisor = async () => {
    if (!project || !isConnected) return;
    setSupervisorLoading(true);
    try {
      if (!isSupervisorEnabled) {
        const result = await api.initSupervisionAgent(
          project.id,
          { maxConcurrentTasks: 2, trustLevel: 'medium' },
          undefined,
          'lite'
        );
        setAgent(project.id, result);
        updateProject(project.id, { agent: result });
      } else {
        const archivedAgent = await api.updateSupervisionAgentAction(project.id, 'archive');
        setAgent(project.id, archivedAgent);
        updateProject(project.id, { agent: archivedAgent });
      }
    } catch (err) {
      console.error('Failed to toggle supervisor:', err);
    } finally {
      setSupervisorLoading(false);
    }
  };

  useAndroidBack(onClose, isOpen && !!project, 25);

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

          {/* Review Provider (for Local PR workflow) */}
          <div>
            <label className="block text-sm font-medium text-muted-foreground mb-1">
              Review Provider
            </label>
            <select
              value={reviewProviderId}
              onChange={(e) => setReviewProviderId(e.target.value)}
              className="w-full h-[38px] px-3 bg-input border border-border rounded-lg text-sm text-foreground focus:outline-none focus:border-primary"
            >
              <option value="">Same as Project Provider</option>
              {providers.map((provider) => (
                <option key={provider.id} value={provider.id}>
                  {provider.name} ({provider.type})
                  {provider.isDefault ? ' - Default' : ''}
                </option>
              ))}
            </select>
            <p className="text-xs text-muted-foreground mt-1">
              Provider used for AI review of Local Pull Requests. Defaults to the project provider above.
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

          <div>
            <label className="block text-sm font-medium text-muted-foreground mb-1">
              Permission Workflow Override
            </label>
            <select
              value={permissionWorkflowOverrideId}
              onChange={(e) => setPermissionWorkflowOverrideId(e.target.value)}
              className="w-full h-[38px] px-3 bg-input border border-border rounded-lg text-sm text-foreground focus:outline-none focus:border-primary"
            >
              <option value="">Inherit global or system fallback</option>
              {workflowOptions.map((workflow) => (
                <option key={workflow.id} value={workflow.id}>
                  {workflow.projectId ? `[Project] ${workflow.name}` : `[Global] ${workflow.name}`}
                </option>
              ))}
            </select>
            <p className="text-xs text-muted-foreground mt-1">
              Project override takes precedence over the global override. If unavailable, the system fallback still runs.
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
                    // Start with empty override — all categories inherit from global
                    setPermOverride({});
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
              <div className="space-y-2 mt-3 pl-3 border-l-2 border-primary/30">
                <p className="text-xs font-medium text-muted-foreground mb-1">Permission Categories</p>
                <div className="border border-border rounded-lg px-3 pb-2 pt-0.5 space-y-0.5">
                  {CATEGORY_ORDER.map((cat) => {
                    const info = CATEGORY_LABELS[cat];
                    const isLocked = cat === 'userQuestions';
                    const currentValue = permOverride.profile?.[cat];

                    return (
                      <div key={cat} className="flex items-center justify-between py-1">
                        <div className="min-w-0 mr-3">
                          <span className="text-xs font-medium">{info.label}</span>
                          <p className="text-[10px] text-muted-foreground truncate">{info.description}</p>
                        </div>
                        <select
                          value={isLocked ? 'ask' : (currentValue ?? 'inherit')}
                          onChange={(e) => {
                            const val = e.target.value;
                            if (val === 'inherit') {
                              const newProfile = { ...permOverride.profile } as Record<string, CategoryAction>;
                              delete newProfile[cat];
                              setPermOverride(prev => ({
                                ...prev,
                                profile: Object.keys(newProfile).length > 0 ? newProfile as CategoryProfile : undefined,
                              }));
                            } else {
                              setPermOverride(prev => ({
                                ...prev,
                                profile: { ...prev.profile, [cat]: val as CategoryAction } as CategoryProfile,
                              }));
                            }
                          }}
                          disabled={isLocked}
                          className={`h-6 px-1.5 text-[11px] bg-background border border-border rounded-md focus:outline-none focus:ring-1 focus:ring-primary flex-shrink-0 ${
                            isLocked ? 'opacity-50 cursor-not-allowed' : ''
                          } ${currentValue ? 'text-primary font-medium' : 'text-muted-foreground'}`}
                          title={isLocked ? 'User questions always require approval' : undefined}
                        >
                          {ACTION_OPTIONS.map((opt) => (
                            <option key={opt.value} value={opt.value}>{opt.label}</option>
                          ))}
                        </select>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>

          {/* Supervisor Agent */}
          <div className="border-t border-border pt-4">
            <div className="flex items-center justify-between mb-2">
              <div>
                <label className="block text-sm font-medium text-muted-foreground">
                  Supervisor Agent
                </label>
                <p className="text-xs text-muted-foreground mt-0.5">
                  Enable a supervisor to manage tasks and sub-sessions
                </p>
              </div>
              <button
                onClick={handleToggleSupervisor}
                disabled={supervisorLoading || !isConnected}
                className={`relative w-10 h-5 rounded-full transition-colors flex-shrink-0 disabled:opacity-50 ${
                  isSupervisorEnabled ? 'bg-primary' : 'bg-muted'
                }`}
              >
                <span
                  className={`absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform ${
                    isSupervisorEnabled ? 'translate-x-5' : 'translate-x-0'
                  }`}
                />
              </button>
            </div>

            {!isSupervisorEnabled && (
              <p className="text-xs text-muted-foreground/70 italic">
                Supervisor is not enabled for this project
              </p>
            )}

            {effectiveAgent && isSupervisorEnabled && (
              <div className="space-y-2 mt-3 pl-3 border-l-2 border-primary/30">
                <div className="flex items-center gap-2">
                  <span className="text-xs font-medium text-muted-foreground">Status:</span>
                  <span className={`text-xs font-medium ${
                    effectiveAgent.phase === 'active' ? 'text-green-500' :
                    effectiveAgent.phase === 'paused' ? 'text-yellow-500' :
                    'text-muted-foreground'
                  }`}>
                    {effectiveAgent.phase.charAt(0).toUpperCase() + effectiveAgent.phase.slice(1)}
                  </span>
                  {effectiveAgent.phase === 'active' && (
                    <span className="w-1.5 h-1.5 rounded-full bg-green-500 animate-pulse" />
                  )}
                </div>
                <div className="text-xs text-muted-foreground">
                  Mode: {(effectiveAgent.mode ?? 'full') === 'lite' ? 'Workflow Runner' : 'Full Supervisor'}
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="flex justify-end gap-2 px-4 py-3 border-t border-border">
          {saveFeedback && (
            <div
              className={`mr-auto self-center text-xs ${
                saveFeedback.type === 'error' ? 'text-destructive' : 'text-emerald-600'
              }`}
            >
              {saveFeedback.message}
            </div>
          )}
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
