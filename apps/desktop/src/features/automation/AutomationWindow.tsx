/**
 * Automation management window — standalone Tauri window.
 *
 * Tabs:
 *   - Workflows: full DAG workflows (graph editor)
 *   - Automations: simple single-action automations (schedule/event + prompt/shell/webhook)
 *   - System: internal system tasks (readonly)
 */

import { useState, useEffect, useCallback, useMemo } from 'react';
import {
  Loader2, Zap, Clock, Server, RefreshCw, Play, Pause, Trash2,
  Globe, FolderOpen, Plus, Pencil, ChevronDown,
  CheckCircle2, XCircle,
} from 'lucide-react';
import type { Workflow, WorkflowTemplate, SystemTaskInfo } from '@my-claudia/shared';
import { isDesktopTauri } from '../../utils/platform';
import { buildPopoutUrl, openPopoutWindow } from '../../utils/popoutWindow';
import { getAuthHeadersForBackend, getBaseUrlForBackend } from '../../services/api/base';
import { useFacadeStore } from '../../stores/facadeStore';
import { useServerStore } from '../../stores/serverStore';
import {
  resolveInitialAutomationBackendId,
  useAutomationBackendOptions,
  type AutomationBackendOption,
} from './useAutomationBackendOptions';

interface AutomationWindowProps {
  serverUrl: string;
  authToken: string;
  serverId?: string;
}

type Tab = 'workflows' | 'automations' | 'system';

interface ProjectInfo {
  id: string;
  name: string;
}

// ── HTTP API helper ──────────────────────────────────────────

function useApi(selectedBackendId: string | null, fallbackServerUrl: string, fallbackAuthToken: string) {
  const request = useCallback(async (path: string, method = 'GET', body?: unknown): Promise<any> => {
    let baseUrl = fallbackServerUrl;
    let authorization = fallbackAuthToken;

    if (selectedBackendId) {
      try {
        baseUrl = getBaseUrlForBackend(selectedBackendId);
      } catch {
        // Fall back to the URL passed at window creation time until facade state is ready.
      }

      try {
        const resolvedAuth = (getAuthHeadersForBackend(selectedBackendId) as Record<string, string>)['Authorization'] || '';
        if (resolvedAuth) authorization = resolvedAuth;
      } catch {
        // Same as above — keep fallback auth while the shared registry is still warming up.
      }
    }

    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (authorization) headers.Authorization = authorization;
    const opts: RequestInit = { method, headers };
    if (body) opts.body = JSON.stringify(body);
    if (!baseUrl) throw new Error('No backend connection available');
    const resp = await fetch(`${baseUrl}${path}`, opts);
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    if (method === 'DELETE') return;
    const json = await resp.json();
    if (!json.success) throw new Error(json.error?.message || 'Request failed');
    return json.data;
  }, [fallbackAuthToken, fallbackServerUrl, selectedBackendId]);

  return useMemo(() => ({
    get: (path: string) => request(path),
    post: (path: string, body?: unknown) => request(path, 'POST', body),
    patch: (path: string, body?: unknown) => request(path, 'PATCH', body),
    del: (path: string) => request(path, 'DELETE'),
  }), [request]);
}

type ApiType = ReturnType<typeof useApi>;

// ── Helpers ──────────────────────────────────────────────────

function isInternalProject(name: string): boolean {
  return name.startsWith('__');
}

function displayProjectName(name: string): string {
  if (!isInternalProject(name)) return name;
  const stripped = name.replace(/^_+/, '');
  return stripped.charAt(0).toUpperCase() + stripped.slice(1);
}

function renderProjectOptions(projects: ProjectInfo[]) {
  const internal = projects.filter(p => isInternalProject(p.name));
  const normal = projects.filter(p => !isInternalProject(p.name)).sort((a, b) => a.name.localeCompare(b.name));
  return (
    <>
      {internal.length > 0 && (
        <optgroup label="Global">
          {internal.map(p => (
            <option key={p.id} value={p.id}>◈ {displayProjectName(p.name)}</option>
          ))}
        </optgroup>
      )}
      {normal.length > 0 && (
        <optgroup label="Projects">
          {normal.map(p => (
            <option key={p.id} value={p.id}>▸ {p.name}</option>
          ))}
        </optgroup>
      )}
    </>
  );
}

function formatInterval(ms: number): string {
  if (ms < 60000) return `${Math.round(ms / 1000)}s`;
  if (ms < 3600000) return `${Math.round(ms / 60000)}m`;
  return `${Math.round(ms / 3600000)}h`;
}

const CATEGORY_COLORS: Record<string, string> = {
  ai: 'bg-primary/15 text-primary',
  git: 'bg-success/15 text-success',
  maintenance: 'bg-warning/15 text-warning',
  quality: 'bg-thinking/15 text-thinking',
  scheduling: 'bg-primary/15 text-primary',
  sync: 'bg-success/15 text-success',
  supervision: 'bg-thinking/15 text-thinking',
  plugin: 'bg-muted text-muted-foreground',
};

// ── Unified Automation Item ──────────────────────────────────

interface AutomationItem {
  id: string;
  name: string;
  description?: string;
  enabled: boolean;
  projectId?: string;
  triggerSummary: string;
  actionSummary: string;
  source: 'workflow';
  status: string;
  runCount: number;
  lastError?: string;
}

function simpleWorkflowToItem(w: Workflow): AutomationItem {
  const trigger = w.definition.triggers[0];
  const node = w.definition.nodes[0];
  const triggerSummary = !trigger ? 'manual'
    : trigger.type === 'cron' ? `cron: ${trigger.cron}`
    : trigger.type === 'interval' ? `every ${trigger.intervalMinutes}m`
    : trigger.type === 'once' ? 'once'
    : trigger.type === 'event' ? `event: ${trigger.event}`
    : trigger.type;
  return {
    id: w.id,
    name: w.name,
    description: w.description,
    enabled: w.status === 'active',
    projectId: w.projectId,
    triggerSummary,
    actionSummary: node?.type ?? 'unknown',
    source: 'workflow',
    status: w.status === 'active' ? 'idle' : 'disabled',
    runCount: 0,
  };
}

// ── Main Component ───────────────────────────────────────────

export function AutomationWindow({ serverUrl, authToken, serverId }: AutomationWindowProps) {
  const [tab, setTab] = useState<Tab>('automations');
  const backendOptions = useAutomationBackendOptions();
  const localBackendId = useFacadeStore((state) => state.localBackendId);
  const activeServerId = useServerStore((state) => state.activeServerId);
  const [selectedBackendId, setSelectedBackendId] = useState<string | null>(null);

  useEffect(() => {
    setSelectedBackendId((prev) => {
      const resolved = resolveInitialAutomationBackendId({
        preferredBackendId: prev || serverId,
        activeServerId,
        localBackendId,
        options: backendOptions,
      });
      return resolved !== prev ? resolved : prev;
    });
  }, [activeServerId, backendOptions, localBackendId, serverId]);

  const selectedBackend = backendOptions.find((option) => option.backendId === selectedBackendId) ?? null;
  const api = useApi(selectedBackend?.backendId ?? null, serverUrl, authToken);

  const [projects, setProjects] = useState<ProjectInfo[]>([]);
  useEffect(() => {
    setProjects([]);
    api.get('/api/projects').then(setProjects).catch(() => {});
  }, [api]);

  const projectName = useCallback((projectId?: string) => {
    if (!projectId) return 'Global';
    const project = projects.find(p => p.id === projectId);
    if (!project) return projectId.slice(0, 8);
    return isInternalProject(project.name) ? 'Global' : project.name;
  }, [projects]);

  const tabs: { key: Tab; label: string; icon: React.ReactNode }[] = [
    { key: 'automations', label: 'Automations', icon: <Zap size={14} /> },
    { key: 'workflows', label: 'Workflows', icon: <Clock size={14} /> },
    { key: 'system', label: 'System', icon: <Server size={14} /> },
  ];
  const scopeKey = selectedBackendId || 'fallback';

  return (
    <div className="flex flex-col h-screen bg-background text-foreground">
      {/* Header */}
      <div className="flex items-center gap-3 px-4 py-3 border-b border-border bg-card/50">
        <Zap size={18} className="text-primary" />
        <h1 className="text-sm font-semibold">
          Automation{selectedBackend ? ` · ${selectedBackend.name}` : ''}
        </h1>
        <AutomationBackendSelector
          options={backendOptions}
          selectedBackendId={selectedBackendId}
          onSelect={setSelectedBackendId}
        />
        <div className="flex-1" />
        <div className="flex gap-1 bg-secondary/50 rounded-lg p-0.5">
          {tabs.map(t => (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${
                tab === t.key ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              {t.icon}
              {t.label}
            </button>
          ))}
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-auto p-4">
        {tab === 'automations' && (
          <AutomationsTab
            key={`automations-${scopeKey}`}
            api={api}
            projects={projects}
            projectName={projectName}
          />
        )}
        {tab === 'workflows' && (
          <WorkflowsTab
            key={`workflows-${scopeKey}`}
            api={api}
            projects={projects}
            projectName={projectName}
            serverUrl={serverUrl}
            selectedBackendId={selectedBackendId}
          />
        )}
        {tab === 'system' && <SystemTasksTab key={`system-${scopeKey}`} api={api} />}
      </div>
    </div>
  );
}

// ── Automations Tab (unified) ────────────────────────────────

function AutomationsTab({
  api,
  projects,
  projectName,
}: {
  api: ApiType;
  projects: ProjectInfo[];
  projectName: (id?: string) => string;
}) {
  const [simpleWorkflows, setSimpleWorkflows] = useState<Workflow[]>([]);
  const [loading, setLoading] = useState(true);

  // Create form state
  const [createProjectId, setCreateProjectId] = useState('');
  const [showCreate, setShowCreate] = useState(false);
  const [newName, setNewName] = useState('');
  const [newTriggerType, setNewTriggerType] = useState<string>('interval');
  const [newIntervalMinutes, setNewIntervalMinutes] = useState('60');
  const [newCron, setNewCron] = useState('');
  const [newOnceAt, setNewOnceAt] = useState('');
  const [newEvent, setNewEvent] = useState('');
  const [newActionType, setNewActionType] = useState('ai_prompt');
  const [newPrompt, setNewPrompt] = useState('');
  const [newShellCmd, setNewShellCmd] = useState('');
  const [createError, setCreateError] = useState<string | null>(null);

  const effectiveProjectId = createProjectId || projects[0]?.id || '';

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const query = effectiveProjectId ? `?projectId=${encodeURIComponent(effectiveProjectId)}` : '';
      const allWorkflows: Workflow[] = await api.get(`/api/automations${query}`).catch(() => []);
      setSimpleWorkflows(allWorkflows);
    } catch { /* ignore */ }
    setLoading(false);
  }, [api, effectiveProjectId]);

  useEffect(() => { refresh(); }, [refresh]);

  // Build unified list
  const items: AutomationItem[] = useMemo(() => {
    return simpleWorkflows.map(simpleWorkflowToItem).sort((a, b) =>
      (b.enabled ? 1 : 0) - (a.enabled ? 1 : 0)
    );
  }, [simpleWorkflows]);

  // ── Handlers ──

  const handleCreate = async () => {
    if (!newName.trim()) return;
    const actionConfig: Record<string, unknown> =
      newActionType === 'ai_prompt' ? { prompt: newPrompt }
      : newActionType === 'shell' ? { command: newShellCmd }
      : {};

    const trigger: Record<string, unknown> = { type: newTriggerType };
    if (newTriggerType === 'interval') trigger.intervalMinutes = parseInt(newIntervalMinutes) || 60;
    if (newTriggerType === 'cron') trigger.cron = newCron;
    if (newTriggerType === 'once') {
      const onceAt = newOnceAt ? new Date(newOnceAt).getTime() : NaN;
      if (!Number.isFinite(onceAt)) {
        setCreateError('Please choose a valid run time');
        return;
      }
      trigger.onceAt = onceAt;
    }
    if (newTriggerType === 'event') trigger.event = newEvent;

    try {
      setCreateError(null);
      await api.post('/api/automations', {
        name: newName.trim(),
        projectId: effectiveProjectId || undefined,
        trigger,
        action: { type: newActionType, config: actionConfig },
      });

      setShowCreate(false);
      setNewName('');
      setNewPrompt('');
      setNewShellCmd('');
      setNewCron('');
      setNewEvent('');
      setNewOnceAt('');
      refresh();
    } catch (error) {
      setCreateError(error instanceof Error ? error.message : 'Failed to create automation');
    }
  };

  const handleToggle = async (item: AutomationItem) => {
    await api.patch(`/api/workflows/${item.id}`, { status: item.enabled ? 'disabled' : 'active' }).catch(() => {});
    refresh();
  };

  const handleTriggerNow = async (item: AutomationItem) => {
    await api.post(`/api/automations/${item.id}/trigger`).catch(() => {});
    refresh();
  };

  const handleDelete = async (item: AutomationItem) => {
    await api.del(`/api/workflows/${item.id}`).catch(() => {});
    refresh();
  };

  if (loading) return <LoadingState />;

  const enabledItems = items.filter(i => i.enabled);
  const disabledItems = items.filter(i => !i.enabled);

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-medium text-muted-foreground">
          {items.length} automation{items.length !== 1 ? 's' : ''}
        </h2>
        <div className="flex items-center gap-1.5">
          {projects.length > 0 && (
            <select
              value={effectiveProjectId}
              onChange={(e) => setCreateProjectId(e.target.value)}
              className="px-2 py-1 text-xs rounded border border-border bg-background text-foreground"
            >
              {renderProjectOptions(projects)}
            </select>
          )}
          <button
            onClick={() => setShowCreate(!showCreate)}
            className="flex items-center gap-1 px-2.5 py-1 text-xs rounded-md bg-primary text-primary-foreground hover:bg-primary/90 transition-colors"
          >
            <Plus size={12} />
            New
          </button>
          <button onClick={refresh} className="p-1.5 rounded hover:bg-secondary text-muted-foreground hover:text-foreground" title="Refresh">
            <RefreshCw size={14} />
          </button>
        </div>
      </div>

      {/* Create Form */}
      {showCreate && (
        <div className="rounded-lg border border-primary/30 bg-primary/5 p-3 space-y-2">
          <input
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            placeholder="Automation name"
            className="w-full px-2 py-1.5 text-xs rounded border border-border bg-background text-foreground"
          />
          <div className="flex gap-2 flex-wrap">
            <div className="flex items-center gap-1">
              <span className="text-[10px] text-muted-foreground">Trigger:</span>
              <select value={newTriggerType} onChange={(e) => setNewTriggerType(e.target.value)} className="px-2 py-1 text-xs rounded border border-border bg-background text-foreground">
                <option value="manual">Manual</option>
                <option value="interval">Interval</option>
                <option value="cron">Cron</option>
                <option value="once">Once</option>
                <option value="event">Event</option>
              </select>
            </div>
            {newTriggerType === 'interval' && (
              <div className="flex items-center gap-1">
                <span className="text-[10px] text-muted-foreground">every</span>
                <input value={newIntervalMinutes} onChange={(e) => setNewIntervalMinutes(e.target.value)} placeholder="60" className="w-16 px-2 py-1 text-xs rounded border border-border bg-background text-foreground" />
                <span className="text-[10px] text-muted-foreground">min</span>
              </div>
            )}
            {newTriggerType === 'cron' && (
              <input value={newCron} onChange={(e) => setNewCron(e.target.value)} placeholder="0 9 * * *" className="flex-1 px-2 py-1 text-xs rounded border border-border bg-background text-foreground font-mono" />
            )}
            {newTriggerType === 'once' && (
              <input
                type="datetime-local"
                value={newOnceAt}
                onChange={(e) => setNewOnceAt(e.target.value)}
                className="px-2 py-1 text-xs rounded border border-border bg-background text-foreground"
              />
            )}
            {newTriggerType === 'event' && (
              <input value={newEvent} onChange={(e) => setNewEvent(e.target.value)} placeholder="plugin.event.name" className="flex-1 px-2 py-1 text-xs rounded border border-border bg-background text-foreground" />
            )}
          </div>
          <div className="flex items-center gap-1">
            <span className="text-[10px] text-muted-foreground">Action:</span>
            <select value={newActionType} onChange={(e) => setNewActionType(e.target.value)} className="px-2 py-1 text-xs rounded border border-border bg-background text-foreground">
              <option value="ai_prompt">AI Prompt</option>
              <option value="shell">Shell Command</option>
              <option value="webhook">Webhook</option>
            </select>
          </div>
          {newActionType === 'ai_prompt' && (
            <textarea value={newPrompt} onChange={(e) => setNewPrompt(e.target.value)} placeholder="Enter prompt... (supports {{event.key}} templates)" rows={3} className="w-full px-2 py-1 text-xs rounded border border-border bg-background text-foreground resize-y" />
          )}
          {newActionType === 'shell' && (
            <input value={newShellCmd} onChange={(e) => setNewShellCmd(e.target.value)} placeholder="command to run" className="w-full px-2 py-1 text-xs rounded border border-border bg-background text-foreground font-mono" />
          )}
          {createError && (
            <div className="text-[11px] text-destructive">{createError}</div>
          )}
          <div className="flex justify-end gap-2">
            <button
              onClick={() => {
                setShowCreate(false);
                setCreateError(null);
              }}
              className="px-2 py-1 text-xs rounded border border-border hover:bg-secondary"
            >
              Cancel
            </button>
            <button onClick={handleCreate} disabled={!newName.trim()} className="px-2 py-1 text-xs rounded bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50">Create</button>
          </div>
        </div>
      )}

      {/* Enabled Automations */}
      {enabledItems.length > 0 && (
        <div>
          <h3 className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider mb-2">Active ({enabledItems.length})</h3>
          <div className="space-y-1.5">
            {enabledItems.map(item => (
              <AutomationCard key={item.id} item={item} projectName={projectName} onToggle={() => handleToggle(item)} onTrigger={() => handleTriggerNow(item)} onDelete={() => handleDelete(item)} />
            ))}
          </div>
        </div>
      )}

      {/* Disabled Automations */}
      {disabledItems.length > 0 && (
        <div>
          <h3 className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider mb-2">Disabled ({disabledItems.length})</h3>
          <div className="space-y-1.5">
            {disabledItems.map(item => (
              <AutomationCard key={item.id} item={item} projectName={projectName} onToggle={() => handleToggle(item)} onTrigger={() => handleTriggerNow(item)} onDelete={() => handleDelete(item)} />
            ))}
          </div>
        </div>
      )}

      {items.length === 0 && !showCreate && (
        <EmptyState message="No automations yet" subtitle="Create one or enable a template to get started" />
      )}
    </div>
  );
}

function AutomationCard({ item, projectName, onToggle, onTrigger, onDelete }: {
  item: AutomationItem;
  projectName: (id?: string) => string;
  onToggle: () => void;
  onTrigger: () => void;
  onDelete: () => void;
}) {
  return (
    <div className={`rounded-lg border p-3 flex items-center gap-3 ${item.enabled ? 'border-border bg-card/50' : 'border-border/50 bg-muted/30 opacity-60'}`}>
      <span className={`w-2 h-2 rounded-full flex-shrink-0 ${
        item.status === 'running' ? 'bg-amber-500 animate-pulse' :
        item.status === 'error' ? 'bg-red-500' :
        item.enabled ? 'bg-green-500' : 'bg-muted-foreground'
      }`} />
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium truncate">{item.name}</span>
        </div>
        <div className="flex items-center gap-2 text-[11px] text-muted-foreground mt-0.5">
          <span className="flex items-center gap-1">
            {item.projectId ? <FolderOpen size={10} /> : <Globe size={10} />}
            {projectName(item.projectId)}
          </span>
          <span>·</span>
          <span>{item.triggerSummary}</span>
          <span>·</span>
          <span>{item.actionSummary}</span>
          {item.runCount > 0 && <><span>·</span><span>{item.runCount} runs</span></>}
          {item.lastError && (
            <span className="text-destructive truncate max-w-[120px]" title={item.lastError}>· {item.lastError.slice(0, 30)}</span>
          )}
        </div>
      </div>
      <div className="flex items-center gap-1">
        <button onClick={onTrigger} className="p-1.5 rounded hover:bg-secondary text-muted-foreground hover:text-foreground" title="Run now">
          <Play size={12} />
        </button>
        <button onClick={onToggle} className="p-1.5 rounded hover:bg-secondary text-muted-foreground hover:text-foreground" title={item.enabled ? 'Disable' : 'Enable'}>
          {item.enabled ? <Pause size={12} /> : <Play size={12} />}
        </button>
        <button onClick={onDelete} className="p-1.5 rounded hover:bg-secondary text-muted-foreground hover:text-red-400" title="Delete">
          <Trash2 size={12} />
        </button>
      </div>
    </div>
  );
}

// ── Workflows Tab ────────────────────────────────────────────

function WorkflowsTab({ api, projects, projectName, serverUrl, selectedBackendId }: {
  api: ApiType; projects: ProjectInfo[]; projectName: (id?: string) => string; serverUrl: string; selectedBackendId: string | null;
}) {
  const [workflows, setWorkflows] = useState<Workflow[]>([]);
  const [templates, setTemplates] = useState<WorkflowTemplate[]>([]);
  const [loading, setLoading] = useState(true);
  const [createProjectId, setCreateProjectId] = useState('');

  const effectiveProjectId = createProjectId || projects[0]?.id || '';
  const selectedProject = projects.find(p => p.id === effectiveProjectId);
  const selectedIsGlobal = selectedProject ? isInternalProject(selectedProject.name) : false;

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const query = effectiveProjectId ? `?projectId=${encodeURIComponent(effectiveProjectId)}` : '';
      const [wfs, tpls] = await Promise.all([
        api.get(`/api/workflows${query}`),
        api.get('/api/workflow-templates'),
      ]);
      // Filter out simple automations — they belong in Automations tab
      setWorkflows(wfs.filter((w: Workflow) => w.authoringMode !== 'simple'));
      setTemplates(tpls);
    } catch { /* ignore */ }
    setLoading(false);
  }, [api, effectiveProjectId]);

  useEffect(() => { refresh(); }, [refresh]);

  const handleTrigger = async (id: string) => {
    await api.post(`/api/workflows/${id}/trigger`).catch(() => {});
    refresh();
  };

  const handleDelete = async (id: string) => {
    await api.del(`/api/workflows/${id}`).catch(() => {});
    setWorkflows(prev => prev.filter(w => w.id !== id));
  };

  const handleEnableTemplate = async (templateId: string, projectId: string) => {
    await api.post(`/api/projects/${projectId}/workflows/from-template/${templateId}`).catch(() => {});
    refresh();
  };

  const handleCreate = async () => {
    if (!effectiveProjectId) return;
    const name = `New Workflow ${new Date().toLocaleTimeString()}`;
    await api.post(`/api/projects/${effectiveProjectId}/workflows`, {
      name,
      definition: { nodes: [], edges: [], entryNodeId: '', triggers: [{ type: 'manual' }] },
    }).catch(() => {});
    refresh();
  };

  const handleEdit = (w: Workflow) => {
    // Include serverUrl as fallback for standalone windows where stores are empty
    const params: Record<string, string> = {
      // Use workflow's own project; fall back to selected project so editor has a real project for AI generation
      workflowEditor: w.projectId || effectiveProjectId,
      workflowId: w.id,
      ...(serverUrl ? { serverUrl } : {}),
    };
    if (isDesktopTauri()) {
      void openPopoutWindow({
        type: 'workflow-editor',
        params,
        title: `Edit: ${w.name}`,
        width: 1200,
        height: 800,
        connectionTarget: { backendId: selectedBackendId },
      });
      return;
    }
    window.open(buildPopoutUrl(params, { backendId: selectedBackendId }), '_blank', 'width=1200,height=800');
  };

  if (loading) return <LoadingState />;

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-medium text-muted-foreground">{workflows.length} workflow{workflows.length !== 1 ? 's' : ''}</h2>
        <div className="flex items-center gap-1.5">
          {projects.length > 0 && (
            <select
              value={effectiveProjectId}
              onChange={(e) => setCreateProjectId(e.target.value)}
              className="px-2 py-1 text-xs rounded border border-border bg-background text-foreground"
            >
              {renderProjectOptions(projects)}
            </select>
          )}
          <button
            onClick={handleCreate}
            className="flex items-center gap-1 px-2.5 py-1 text-xs rounded-md bg-primary text-primary-foreground hover:bg-primary/90 transition-colors"
          >
            <Plus size={12} />
            New
          </button>
          <button onClick={refresh} className="p-1.5 rounded hover:bg-secondary text-muted-foreground hover:text-foreground" title="Refresh">
            <RefreshCw size={14} />
          </button>
        </div>
      </div>

      {/* Templates */}
      {templates.length > 0 && !selectedIsGlobal && (
        <div>
          <h3 className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider mb-2">Quick Start Templates</h3>
          <div className="grid grid-cols-3 gap-2">
            {templates.map(t => {
              const enabled = workflows.some(w => w.templateId === t.id);
              return (
                <div key={t.id} className="rounded-lg border border-border bg-card p-3 flex flex-col gap-2">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="text-xs font-medium">{t.name}</div>
                      {t.description && <div className="text-[10px] text-muted-foreground mt-0.5 line-clamp-2">{t.description}</div>}
                    </div>
                    {(t as any).category && (
                      <span className={`px-1.5 py-0.5 rounded text-[9px] font-medium shrink-0 ${CATEGORY_COLORS[(t as any).category] ?? 'bg-muted text-muted-foreground'}`}>
                        {(t as any).category}
                      </span>
                    )}
                  </div>
                  {effectiveProjectId && (
                    <button
                      onClick={() => handleEnableTemplate(t.id, effectiveProjectId)}
                      disabled={enabled}
                      className={`self-start text-[10px] px-2 py-0.5 rounded transition-colors ${
                        enabled ? 'bg-success/15 text-success' : 'bg-primary/10 text-primary hover:bg-primary/20'
                      }`}
                    >
                      {enabled ? 'Enabled' : 'Enable'}
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Workflow List */}
      {workflows.length === 0 ? (
        <EmptyState message="No workflows yet" subtitle="Create one or enable a template to get started" />
      ) : (
        <div className="space-y-2">
          {workflows.map(w => (
            <div
              key={w.id}
              className="rounded-lg border border-border bg-card/50 p-3 flex items-center gap-3 cursor-pointer hover:bg-secondary/30 transition-colors"
              onClick={() => handleEdit(w)}
            >
              <span className={`w-2 h-2 rounded-full flex-shrink-0 ${w.status === 'active' ? 'bg-green-500' : 'bg-muted-foreground'}`} />
              <div className="flex-1 min-w-0">
                <div className="text-sm font-medium truncate">{w.name}</div>
                <div className="flex items-center gap-2 text-[11px] text-muted-foreground mt-0.5">
                  <span className="flex items-center gap-1">
                    {w.projectId ? <FolderOpen size={10} /> : <Globe size={10} />}
                    {projectName(w.projectId)}
                  </span>
                  {w.description && <><span>·</span><span className="truncate">{w.description}</span></>}
                  {w.definition.nodes.length > 0 && <><span>·</span><span>{w.definition.nodes.length} nodes</span></>}
                </div>
              </div>
              <div className="flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
                <button onClick={() => handleEdit(w)} className="p-1.5 rounded hover:bg-secondary text-muted-foreground hover:text-foreground" title="Edit">
                  <Pencil size={12} />
                </button>
                {w.status === 'active' && (
                  <button onClick={() => handleTrigger(w.id)} className="p-1.5 rounded hover:bg-secondary text-muted-foreground hover:text-foreground" title="Trigger">
                    <Play size={12} />
                  </button>
                )}
                <button onClick={() => handleDelete(w.id)} className="p-1.5 rounded hover:bg-secondary text-muted-foreground hover:text-red-400" title="Delete">
                  <Trash2 size={12} />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── System Tasks Tab ─────────────────────────────────────────

function SystemTasksTab({ api }: { api: ApiType }) {
  const [tasks, setTasks] = useState<SystemTaskInfo[]>([]);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    setLoading(true);
    await api.get('/api/system-tasks').then(setTasks).catch(() => setTasks([]));
    setLoading(false);
  }, [api]);

  useEffect(() => { refresh(); }, [refresh]);

  if (loading) return <LoadingState />;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-medium text-muted-foreground">{tasks.length} system task{tasks.length !== 1 ? 's' : ''}</h2>
        <button onClick={refresh} className="p-1.5 rounded hover:bg-secondary text-muted-foreground hover:text-foreground" title="Refresh">
          <RefreshCw size={14} />
        </button>
      </div>
      {tasks.length === 0 ? (
        <EmptyState message="No system tasks running" />
      ) : (
        <div className="space-y-1.5">
          {tasks.map(t => (
            <SystemTaskCard key={t.id} task={t} />
          ))}
        </div>
      )}
    </div>
  );
}

function SystemTaskCard({ task }: {
  task: SystemTaskInfo;
}) {
  return (
    <div className="rounded-lg border border-border bg-card">
      <div className="flex items-center gap-3 px-3 py-2.5">
        <div className="shrink-0">
          {task.status === 'running' ? (
            <Loader2 size={14} className="text-primary animate-spin" />
          ) : task.status === 'error' ? (
            <XCircle size={14} className="text-destructive" />
          ) : (
            <CheckCircle2 size={14} className="text-success" />
          )}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-xs font-medium text-foreground truncate">{task.name}</span>
            <span className={`px-1.5 py-0.5 rounded text-[9px] font-medium ${CATEGORY_COLORS[task.category] ?? 'bg-muted text-muted-foreground'}`}>
              {task.category}
            </span>
          </div>
          <div className="flex items-center gap-3 mt-0.5">
            <span className="text-[10px] text-muted-foreground">every {formatInterval(task.intervalMs)}</span>
            <span className="text-[10px] text-muted-foreground">Runs: {task.runCount}</span>
            {task.lastRunDurationMs !== undefined && (
              <span className="text-[10px] text-muted-foreground">Last: {task.lastRunDurationMs}ms</span>
            )}
            {task.lastError && (
              <span className="text-[10px] text-destructive truncate max-w-[120px]" title={task.lastError}>
                {task.lastError.slice(0, 40)}
              </span>
            )}
          </div>
        </div>
        <span className="text-[9px] text-muted-foreground/60 bg-muted/40 px-1.5 py-0.5 rounded shrink-0">System</span>
      </div>
    </div>
  );
}

// ── Shared Components ────────────────────────────────────────

function LoadingState() {
  return (
    <div className="flex items-center justify-center py-12">
      <Loader2 size={20} className="animate-spin text-muted-foreground" />
    </div>
  );
}

function EmptyState({ message, subtitle }: { message: string; subtitle?: string }) {
  return (
    <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
      <Zap size={24} className="mb-2 opacity-40" />
      <p className="text-sm">{message}</p>
      {subtitle && <p className="text-xs mt-1 opacity-60">{subtitle}</p>}
    </div>
  );
}

function AutomationBackendSelector({
  options,
  selectedBackendId,
  onSelect,
}: {
  options: AutomationBackendOption[];
  selectedBackendId: string | null;
  onSelect: (backendId: string) => void;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const selected = options.find((option) => option.backendId === selectedBackendId) ?? options[0] ?? null;

  if (!selected) return null;

  const getStatusColor = (option: AutomationBackendOption) => {
    switch (option.status) {
      case 'ready':
        return 'bg-success';
      case 'transport_reconnecting':
      case 'backend_subscribing':
      case 'data_syncing':
      case 'session_syncing':
        return 'bg-warning animate-pulse';
      case 'error':
        return 'bg-destructive';
      default:
        return 'bg-muted-foreground';
    }
  };

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setIsOpen((open) => !open)}
        className="flex items-center gap-2 rounded-full bg-secondary px-3 py-1.5 text-sm hover:bg-muted transition-colors"
        data-testid="automation-backend-selector"
      >
        <span className={`h-2.5 w-2.5 rounded-full ${getStatusColor(selected)}`} />
        <span className="max-w-[180px] truncate">{selected.name}</span>
        <ChevronDown className={`h-4 w-4 transition-transform ${isOpen ? 'rotate-180' : ''}`} />
      </button>

      {isOpen && (
        <>
          <div className="absolute left-0 top-full z-[70] mt-2 w-72 rounded-xl border border-border bg-card p-1 shadow-xl">
            {options.map((option) => (
              <button
                key={option.backendId}
                type="button"
                onClick={() => {
                  onSelect(option.backendId);
                  setIsOpen(false);
                }}
                className={`flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left transition-colors ${
                  option.backendId === selected.backendId ? 'bg-secondary' : 'hover:bg-secondary/60'
                }`}
              >
                <span className={`h-2.5 w-2.5 rounded-full shrink-0 ${getStatusColor(option)}`} />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-medium">{option.name}</div>
                  <div className="text-[11px] text-muted-foreground">
                    {option.isLocal ? 'Local' : 'Remote'}
                    {option.latencyMs != null ? ` · ${option.latencyMs}ms` : ''}
                  </div>
                </div>
              </button>
            ))}
          </div>
          <div className="fixed inset-0 z-[65]" onClick={() => setIsOpen(false)} />
        </>
      )}
    </div>
  );
}
