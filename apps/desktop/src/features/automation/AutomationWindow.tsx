/**
 * Automation management window — standalone Tauri window.
 *
 * Displays all workflows, scheduled tasks, system tasks, and agent triggers
 * across all projects and global scope. Uses direct HTTP API (no zustand stores).
 */

import { useState, useEffect, useCallback, useMemo } from 'react';
import {
  Loader2, Zap, Clock, Radio, Server, RefreshCw, Play, Pause, Trash2,
  Globe, FolderOpen, ChevronDown, ChevronRight, Plus,
  CheckCircle2, XCircle,
} from 'lucide-react';
import type { Workflow, WorkflowTemplate, ScheduledTask, ScheduledTaskTemplate, SystemTaskInfo, TaskRun } from '@my-claudia/shared';

interface AutomationWindowProps {
  serverUrl: string;
  authToken: string;
}

type Tab = 'workflows' | 'scheduled' | 'system' | 'triggers';

interface AgentTrigger {
  id: string;
  name: string;
  description?: string;
  enabled: boolean;
  triggerType: string;
  eventPattern?: string;
  promptTemplate: string;
  projectId?: string;
}

interface ProjectInfo {
  id: string;
  name: string;
}

// ── HTTP API helper ──────────────────────────────────────────

function useApi(serverUrl: string, authToken: string) {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (authToken) headers['Authorization'] = authToken;

  const request = useCallback(async (path: string, method = 'GET', body?: unknown): Promise<any> => {
    const opts: RequestInit = { method, headers };
    if (body) opts.body = JSON.stringify(body);
    const resp = await fetch(`${serverUrl}${path}`, opts);
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    if (method === 'DELETE') return;
    const json = await resp.json();
    if (!json.success) throw new Error(json.error?.message || 'Request failed');
    return json.data;
  }, [serverUrl, authToken]);

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

/** Render project options: Global first (optgroup), then projects (optgroup) */
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

// ── Main Component ───────────────────────────────────────────

export function AutomationWindow({ serverUrl, authToken }: AutomationWindowProps) {
  const [tab, setTab] = useState<Tab>('workflows');
  const api = useApi(serverUrl, authToken);

  // Projects lookup
  const [projects, setProjects] = useState<ProjectInfo[]>([]);
  useEffect(() => {
    api.get('/api/projects').then(setProjects).catch(() => {});
  }, [api]);

  const projectName = useCallback((projectId?: string) => {
    if (!projectId) return 'Global';
    const project = projects.find(p => p.id === projectId);
    if (!project) return projectId.slice(0, 8);
    return isInternalProject(project.name) ? 'Global' : project.name;
  }, [projects]);

  const tabs: { key: Tab; label: string; icon: React.ReactNode }[] = [
    { key: 'workflows', label: 'Workflows', icon: <Zap size={14} /> },
    { key: 'scheduled', label: 'Scheduled Tasks', icon: <Clock size={14} /> },
    { key: 'system', label: 'System', icon: <Server size={14} /> },
    { key: 'triggers', label: 'Triggers', icon: <Radio size={14} /> },
  ];

  return (
    <div className="flex flex-col h-screen bg-background text-foreground">
      {/* Header */}
      <div className="flex items-center gap-3 px-4 py-3 border-b border-border bg-card/50">
        <Zap size={18} className="text-primary" />
        <h1 className="text-sm font-semibold">Automation</h1>
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
        {tab === 'workflows' && <WorkflowsTab api={api} projects={projects} projectName={projectName} />}
        {tab === 'scheduled' && <ScheduledTasksTab api={api} projects={projects} projectName={projectName} />}
        {tab === 'system' && <SystemTasksTab api={api} />}
        {tab === 'triggers' && <TriggersTab api={api} projectName={projectName} />}
      </div>
    </div>
  );
}

// ── Workflows Tab ────────────────────────────────────────────

function WorkflowsTab({ api, projects, projectName }: { api: ApiType; projects: ProjectInfo[]; projectName: (id?: string) => string }) {
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
      const [wfs, tpls] = await Promise.all([
        api.get('/api/workflows'),
        api.get('/api/workflow-templates'),
      ]);
      setWorkflows(wfs);
      setTemplates(tpls);
    } catch { /* ignore */ }
    setLoading(false);
  }, [api]);

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
    const path = selectedIsGlobal
      ? `/api/workflows/from-template/${templateId}`
      : `/api/projects/${projectId}/workflows/from-template/${templateId}`;
    await api.post(path).catch(() => {});
    refresh();
  };

  const handleCreate = async () => {
    if (!effectiveProjectId) return;
    const name = `New Workflow ${new Date().toLocaleTimeString()}`;
    const path = selectedIsGlobal
      ? '/api/workflows'
      : `/api/projects/${effectiveProjectId}/workflows`;
    await api.post(path, {
      name,
      definition: { nodes: [], edges: [], entryNodeId: '', triggers: [{ type: 'manual' }] },
    }).catch(() => {});
    refresh();
  };

  if (loading) return <LoadingState />;

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-medium text-muted-foreground">{workflows.length} workflow{workflows.length !== 1 ? 's' : ''}</h2>
        <div className="flex items-center gap-1.5">
          {projects.length > 1 && (
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

      {/* Quick Start Templates */}
      {templates.length > 0 && (
        <div>
          <h3 className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider mb-2">Quick Start Templates</h3>
          <div className="grid grid-cols-3 gap-2">
            {templates.map(t => {
              const enabled = workflows.some((w) => {
                if (w.templateId !== t.id) return false;
                return selectedIsGlobal ? !w.projectId : w.projectId === effectiveProjectId;
              });
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

      {/* Workflow list */}
      {workflows.length === 0 ? (
        <EmptyState message="No workflows yet" subtitle="Create one or enable a template to get started" />
      ) : (
        <div className="space-y-2">
          {workflows.map(w => (
            <div key={w.id} className="rounded-lg border border-border bg-card/50 p-3 flex items-center gap-3">
              <span className={`w-2 h-2 rounded-full flex-shrink-0 ${w.status === 'active' ? 'bg-green-500' : 'bg-muted-foreground'}`} />
              <div className="flex-1 min-w-0">
                <div className="text-sm font-medium truncate">{w.name}</div>
                <div className="flex items-center gap-2 text-[11px] text-muted-foreground mt-0.5">
                  <span className="flex items-center gap-1">
                    {w.projectId ? <FolderOpen size={10} /> : <Globe size={10} />}
                    {projectName(w.projectId)}
                  </span>
                  {w.description && <><span>·</span><span className="truncate">{w.description}</span></>}
                </div>
              </div>
              <div className="flex items-center gap-1">
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

// ── Scheduled Tasks Tab ──────────────────────────────────────

function ScheduledTasksTab({ api, projects, projectName }: { api: ApiType; projects: ProjectInfo[]; projectName: (id?: string) => string }) {
  const [userTasks, setUserTasks] = useState<ScheduledTask[]>([]);
  const [templates, setTemplates] = useState<ScheduledTaskTemplate[]>([]);
  const [loading, setLoading] = useState(true);
  const [createProjectId, setCreateProjectId] = useState('');
  const [showCreate, setShowCreate] = useState(false);
  const [newName, setNewName] = useState('');
  const [newScheduleType, setNewScheduleType] = useState('interval');
  const [newIntervalMinutes, setNewIntervalMinutes] = useState('60');
  const [newCron, setNewCron] = useState('');
  const [newActionType, setNewActionType] = useState('prompt');
  const [newPrompt, setNewPrompt] = useState('');

  const effectiveProjectId = createProjectId || projects[0]?.id || '';
  const selectedProject = projects.find(p => p.id === effectiveProjectId);
  const selectedIsGlobal = selectedProject ? isInternalProject(selectedProject.name) : false;

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const [globalTasks, projectsResp, tpls] = await Promise.all([
        api.get('/api/scheduled-tasks/global').catch(() => []),
        api.get('/api/projects').catch(() => []),
        api.get('/api/scheduled-task-templates').catch(() => []),
      ]);
      const projectTasks = await Promise.all(
        projectsResp.map((p: { id: string }) => api.get(`/api/projects/${p.id}/scheduled-tasks`).catch(() => []))
      );
      setUserTasks([...globalTasks, ...projectTasks.flat()]);
      setTemplates(tpls);
    } catch { /* ignore */ }
    setLoading(false);
  }, [api]);

  useEffect(() => { refresh(); }, [refresh]);

  const handleToggle = async (task: ScheduledTask) => {
    await api.patch(`/api/scheduled-tasks/${task.id}`, { enabled: !task.enabled }).catch(() => {});
    refresh();
  };

  const handleTrigger = async (id: string) => {
    await api.post(`/api/scheduled-tasks/${id}/trigger`).catch(() => {});
    refresh();
  };

  const handleDelete = async (id: string) => {
    await api.del(`/api/scheduled-tasks/${id}`).catch(() => {});
    setUserTasks(prev => prev.filter(t => t.id !== id));
  };

  const handleEnableTemplate = async (templateId: string, projectId: string) => {
    await api.post(`/api/projects/${projectId}/scheduled-tasks/from-template/${templateId}`).catch(() => {});
    refresh();
  };

  const handleCreateTask = async () => {
    if (!effectiveProjectId || !newName.trim()) return;
    const path = `/api/projects/${effectiveProjectId}/scheduled-tasks`;
    const body: Record<string, unknown> = {
      name: newName.trim(),
      enabled: true,
      scheduleType: newScheduleType,
      actionType: newActionType,
      actionConfig: newActionType === 'prompt' ? { prompt: newPrompt } : {},
    };
    if (newScheduleType === 'interval') body.scheduleIntervalMinutes = parseInt(newIntervalMinutes) || 60;
    if (newScheduleType === 'cron') body.scheduleCron = newCron;
    await api.post(path, body).catch(() => {});
    setShowCreate(false);
    setNewName('');
    setNewPrompt('');
    refresh();
  };

  const enabledTasks = userTasks.filter(t => t.enabled);
  const disabledTasks = userTasks.filter(t => !t.enabled);

  if (loading) return <LoadingState />;

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-medium text-muted-foreground">{userTasks.length} task{userTasks.length !== 1 ? 's' : ''}</h2>
        <div className="flex items-center gap-1.5">
          {projects.length > 1 && (
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

      {/* Inline Create Form */}
      {showCreate && (
        <div className="rounded-lg border border-primary/30 bg-primary/5 p-3 space-y-2">
          <input
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            placeholder="Task name"
            className="w-full px-2 py-1 text-xs rounded border border-border bg-background text-foreground"
          />
          <div className="flex gap-2">
            <select value={newScheduleType} onChange={(e) => setNewScheduleType(e.target.value)} className="px-2 py-1 text-xs rounded border border-border bg-background text-foreground">
              <option value="interval">Interval</option>
              <option value="cron">Cron</option>
              <option value="once">Once</option>
            </select>
            {newScheduleType === 'interval' && (
              <input value={newIntervalMinutes} onChange={(e) => setNewIntervalMinutes(e.target.value)} placeholder="Minutes" className="w-20 px-2 py-1 text-xs rounded border border-border bg-background text-foreground" />
            )}
            {newScheduleType === 'cron' && (
              <input value={newCron} onChange={(e) => setNewCron(e.target.value)} placeholder="*/5 * * * *" className="flex-1 px-2 py-1 text-xs rounded border border-border bg-background text-foreground" />
            )}
            <select value={newActionType} onChange={(e) => setNewActionType(e.target.value)} className="px-2 py-1 text-xs rounded border border-border bg-background text-foreground">
              <option value="prompt">AI Prompt</option>
              <option value="shell">Shell</option>
              <option value="webhook">Webhook</option>
            </select>
          </div>
          {newActionType === 'prompt' && (
            <textarea value={newPrompt} onChange={(e) => setNewPrompt(e.target.value)} placeholder="Enter prompt..." rows={2} className="w-full px-2 py-1 text-xs rounded border border-border bg-background text-foreground resize-y" />
          )}
          <div className="flex justify-end gap-2">
            <button onClick={() => setShowCreate(false)} className="px-2 py-1 text-xs rounded border border-border hover:bg-secondary">Cancel</button>
            <button onClick={handleCreateTask} disabled={!newName.trim()} className="px-2 py-1 text-xs rounded bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50">Create</button>
          </div>
        </div>
      )}

      {/* Quick Start Templates — hidden when Global project is selected */}
      {templates.length > 0 && !selectedIsGlobal && (
        <div>
          <h3 className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider mb-2">Quick Start</h3>
          <div className="grid grid-cols-2 gap-2">
            {templates.map(t => {
              const enabled = userTasks.some(task => task.templateId === t.id);
              return (
                <div key={t.id} className="rounded-lg border border-border bg-card p-3 flex flex-col gap-2">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="text-xs font-medium">{t.name}</div>
                      {t.description && <div className="text-[10px] text-muted-foreground mt-0.5 line-clamp-2">{t.description}</div>}
                    </div>
                    {t.category && (
                      <span className={`px-1.5 py-0.5 rounded text-[9px] font-medium shrink-0 ${CATEGORY_COLORS[t.category] ?? 'bg-muted text-muted-foreground'}`}>
                        {t.category}
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

      {/* Enabled Tasks */}
      {enabledTasks.length > 0 && (
        <div>
          <h3 className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider mb-2">Enabled ({enabledTasks.length})</h3>
          <div className="space-y-1.5">
            {enabledTasks.map(t => (
              <ScheduledTaskCard
                key={t.id}
                task={t}
                projectName={projectName}
                onToggle={() => handleToggle(t)}
                onTrigger={() => handleTrigger(t.id)}
                onDelete={() => handleDelete(t.id)}
              />
            ))}
          </div>
        </div>
      )}

      {/* Disabled Tasks */}
      {disabledTasks.length > 0 && (
        <div>
          <h3 className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider mb-2">Disabled ({disabledTasks.length})</h3>
          <div className="space-y-1.5">
            {disabledTasks.map(t => (
              <ScheduledTaskCard
                key={t.id}
                task={t}
                projectName={projectName}
                onToggle={() => handleToggle(t)}
                onTrigger={() => handleTrigger(t.id)}
                onDelete={() => handleDelete(t.id)}
              />
            ))}
          </div>
        </div>
      )}

      {userTasks.length === 0 && (
        <EmptyState message="No scheduled tasks" subtitle="Enable a template to get started" />
      )}
    </div>
  );
}

function ScheduledTaskCard({ task: t, projectName, onToggle, onTrigger, onDelete }: {
  task: ScheduledTask;
  projectName: (id?: string) => string;
  onToggle: () => void;
  onTrigger: () => void;
  onDelete: () => void;
}) {
  const schedule = t.scheduleType === 'cron' ? `cron: ${t.scheduleCron}`
    : t.scheduleType === 'interval' ? `every ${t.scheduleIntervalMinutes}m`
    : t.scheduleType;

  return (
    <div className={`rounded-lg border p-3 flex items-center gap-3 ${t.enabled ? 'border-border bg-card/50' : 'border-border/50 bg-muted/30 opacity-60'}`}>
      <span className={`w-2 h-2 rounded-full flex-shrink-0 ${
        t.status === 'running' ? 'bg-amber-500 animate-pulse' :
        t.status === 'error' ? 'bg-red-500' :
        t.enabled ? 'bg-green-500' : 'bg-muted-foreground'
      }`} />
      <div className="flex-1 min-w-0">
        <div className="text-sm font-medium truncate">{t.name}</div>
        <div className="flex items-center gap-2 text-[11px] text-muted-foreground mt-0.5">
          <span className="flex items-center gap-1">
            {t.projectId ? <FolderOpen size={10} /> : <Globe size={10} />}
            {projectName(t.projectId)}
          </span>
          <span>·</span>
          <span>{schedule}</span>
          {t.runCount > 0 && <><span>·</span><span>{t.runCount} runs</span></>}
          {t.lastError && (
            <span className="text-destructive truncate max-w-[120px]" title={t.lastError}>· {t.lastError.slice(0, 30)}</span>
          )}
        </div>
      </div>
      <div className="flex items-center gap-1">
        <button onClick={onTrigger} className="p-1.5 rounded hover:bg-secondary text-muted-foreground hover:text-foreground" title="Trigger now">
          <Play size={12} />
        </button>
        <button onClick={onToggle} className="p-1.5 rounded hover:bg-secondary text-muted-foreground hover:text-foreground" title={t.enabled ? 'Disable' : 'Enable'}>
          {t.enabled ? <Pause size={12} /> : <Play size={12} />}
        </button>
        <button onClick={onDelete} className="p-1.5 rounded hover:bg-secondary text-muted-foreground hover:text-red-400" title="Delete">
          <Trash2 size={12} />
        </button>
      </div>
    </div>
  );
}

function SystemTaskCard({ task, api, expanded, onToggleExpand }: {
  task: SystemTaskInfo;
  api: ApiType;
  expanded: boolean;
  onToggleExpand: () => void;
}) {
  const [runs, setRuns] = useState<TaskRun[]>([]);

  useEffect(() => {
    if (expanded) {
      api.get(`/api/task-runs?taskId=${encodeURIComponent(task.id)}&limit=10`).then(setRuns).catch(() => {});
    }
  }, [expanded, api, task.id]);

  return (
    <div className="rounded-lg border border-border bg-card">
      <div className="flex items-center gap-3 px-3 py-2.5">
        <button onClick={onToggleExpand} className="shrink-0 text-muted-foreground hover:text-foreground p-0.5">
          {expanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
        </button>
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
      {expanded && runs.length > 0 && (
        <div className="px-3 pb-3 space-y-1">
          {runs.map(r => (
            <div key={r.id} className="flex items-center justify-between text-[10px] text-muted-foreground py-0.5">
              <span className={r.status === 'failed' ? 'text-destructive' : r.status === 'completed' ? 'text-success' : ''}>
                {r.status}
              </span>
              <span>{r.durationMs ? `${r.durationMs}ms` : '-'}</span>
              <span>{new Date(r.startedAt).toLocaleTimeString()}</span>
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
  const [expandedId, setExpandedId] = useState<string | null>(null);

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
            <SystemTaskCard
              key={t.id}
              task={t}
              api={api}
              expanded={expandedId === t.id}
              onToggleExpand={() => setExpandedId(prev => prev === t.id ? null : t.id)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

// ── Triggers Tab ─────────────────────────────────────────────

function TriggersTab({ api, projectName }: { api: ApiType; projectName: (id?: string) => string }) {
  const [triggers, setTriggers] = useState<AgentTrigger[]>([]);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    setLoading(true);
    await api.get('/api/agent-triggers').then(setTriggers).catch(() => setTriggers([]));
    setLoading(false);
  }, [api]);

  useEffect(() => { refresh(); }, [refresh]);

  const handleDelete = async (id: string) => {
    await api.del(`/api/agent-triggers/${id}`).catch(() => {});
    setTriggers(prev => prev.filter(t => t.id !== id));
  };

  if (loading) return <LoadingState />;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-medium text-muted-foreground">{triggers.length} trigger{triggers.length !== 1 ? 's' : ''}</h2>
        <button onClick={refresh} className="p-1.5 rounded hover:bg-secondary text-muted-foreground hover:text-foreground" title="Refresh">
          <RefreshCw size={14} />
        </button>
      </div>
      {triggers.length === 0 ? (
        <EmptyState message="No agent triggers" />
      ) : (
        <div className="space-y-2">
          {triggers.map(t => (
            <div key={t.id} className="rounded-lg border border-border bg-card/50 p-3 flex items-center gap-3">
              <span className={`w-2 h-2 rounded-full flex-shrink-0 ${t.enabled ? 'bg-green-500' : 'bg-muted-foreground'}`} />
              <div className="flex-1 min-w-0">
                <div className="text-sm font-medium truncate">{t.name}</div>
                <div className="flex items-center gap-2 text-[11px] text-muted-foreground mt-0.5">
                  <span className="flex items-center gap-1">
                    {t.projectId ? <FolderOpen size={10} /> : <Globe size={10} />}
                    {projectName(t.projectId)}
                  </span>
                  <span>·</span>
                  <span>{t.triggerType}</span>
                  {t.eventPattern && <><span>·</span><span className="truncate">{t.eventPattern}</span></>}
                </div>
                {t.description && <div className="text-[10px] text-muted-foreground mt-1 line-clamp-1">{t.description}</div>}
              </div>
              <button onClick={() => handleDelete(t.id)} className="p-1.5 rounded hover:bg-secondary text-muted-foreground hover:text-red-400" title="Delete">
                <Trash2 size={12} />
              </button>
            </div>
          ))}
        </div>
      )}
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
