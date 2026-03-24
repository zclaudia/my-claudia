/**
 * Automation management window — standalone Tauri window.
 *
 * Displays all workflows, scheduled tasks, and agent triggers
 * across all projects and global scope.
 */

import { useState, useEffect, useCallback, useMemo } from 'react';
import { Loader2, Zap, Clock, Radio, RefreshCw, Play, Pause, Trash2, Globe, FolderOpen } from 'lucide-react';
import type { Workflow, WorkflowTemplate } from '@my-claudia/shared';

interface AutomationWindowProps {
  serverUrl: string;
  authToken: string;
}

type Tab = 'workflows' | 'scheduled' | 'triggers';

interface ScheduledTask {
  id: string;
  name: string;
  description?: string;
  enabled: boolean;
  scheduleType: string;
  scheduleCron?: string;
  scheduleIntervalMinutes?: number;
  status: string;
  lastRunAt?: number;
  nextRun?: number;
  runCount: number;
  projectId?: string;
}

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
    return projects.find(p => p.id === projectId)?.name || projectId.slice(0, 8);
  }, [projects]);

  const tabs: { key: Tab; label: string; icon: React.ReactNode }[] = [
    { key: 'workflows', label: 'Workflows', icon: <Zap size={14} /> },
    { key: 'scheduled', label: 'Scheduled Tasks', icon: <Clock size={14} /> },
    { key: 'triggers', label: 'Agent Triggers', icon: <Radio size={14} /> },
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
        {tab === 'workflows' && <WorkflowsTab api={api} projectName={projectName} />}
        {tab === 'scheduled' && <ScheduledTasksTab api={api} projectName={projectName} />}
        {tab === 'triggers' && <TriggersTab api={api} projectName={projectName} />}
      </div>
    </div>
  );
}

// ── Workflows Tab ──────────────────────────────────────────

function WorkflowsTab({ api, projectName }: { api: ReturnType<typeof useApi>; projectName: (id?: string) => string }) {
  const [workflows, setWorkflows] = useState<Workflow[]>([]);
  const [templates, setTemplates] = useState<WorkflowTemplate[]>([]);
  const [loading, setLoading] = useState(true);

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
    try {
      await api.post(`/api/workflows/${id}/trigger`);
      refresh();
    } catch { /* ignore */ }
  };

  const handleDelete = async (id: string) => {
    try {
      await api.del(`/api/workflows/${id}`);
      setWorkflows(prev => prev.filter(w => w.id !== id));
    } catch { /* ignore */ }
  };

  if (loading) return <LoadingState />;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-medium text-muted-foreground">{workflows.length} workflow{workflows.length !== 1 ? 's' : ''}</h2>
        <button onClick={refresh} className="p-1.5 rounded hover:bg-secondary text-muted-foreground hover:text-foreground" title="Refresh">
          <RefreshCw size={14} />
        </button>
      </div>

      {workflows.length === 0 ? (
        <EmptyState message="No workflows yet" />
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

      {templates.length > 0 && (
        <div className="pt-4 border-t border-border">
          <h3 className="text-xs font-medium text-muted-foreground mb-2">Templates</h3>
          <div className="grid grid-cols-2 gap-2">
            {templates.map(t => (
              <div key={t.id} className="rounded-lg border border-border bg-card/30 p-2.5">
                <div className="text-xs font-medium">{t.name}</div>
                {t.description && <div className="text-[10px] text-muted-foreground mt-0.5 line-clamp-2">{t.description}</div>}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Scheduled Tasks Tab ────────────────────────────────────

function ScheduledTasksTab({ api, projectName }: { api: ReturnType<typeof useApi>; projectName: (id?: string) => string }) {
  const [tasks, setTasks] = useState<ScheduledTask[]>([]);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      // Fetch global + all project tasks
      const [globalTasks, projectsResp] = await Promise.all([
        api.get('/api/scheduled-tasks/global'),
        api.get('/api/projects'),
      ]);
      const projectTasks = await Promise.all(
        projectsResp.map((p: { id: string }) => api.get(`/api/projects/${p.id}/scheduled-tasks`).catch(() => []))
      );
      setTasks([...globalTasks, ...projectTasks.flat()]);
    } catch { /* ignore */ }
    setLoading(false);
  }, [api]);

  useEffect(() => { refresh(); }, [refresh]);

  const handleToggle = async (task: ScheduledTask) => {
    try {
      await api.patch(`/api/scheduled-tasks/${task.id}`, { enabled: !task.enabled });
      refresh();
    } catch { /* ignore */ }
  };

  const handleTrigger = async (id: string) => {
    try {
      await api.post(`/api/scheduled-tasks/${id}/trigger`);
      refresh();
    } catch { /* ignore */ }
  };

  if (loading) return <LoadingState />;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-medium text-muted-foreground">{tasks.length} task{tasks.length !== 1 ? 's' : ''}</h2>
        <button onClick={refresh} className="p-1.5 rounded hover:bg-secondary text-muted-foreground hover:text-foreground" title="Refresh">
          <RefreshCw size={14} />
        </button>
      </div>

      {tasks.length === 0 ? (
        <EmptyState message="No scheduled tasks" />
      ) : (
        <div className="space-y-2">
          {tasks.map(t => (
            <div key={t.id} className="rounded-lg border border-border bg-card/50 p-3 flex items-center gap-3">
              <span className={`w-2 h-2 rounded-full flex-shrink-0 ${
                t.status === 'running' ? 'bg-amber-500 animate-pulse' :
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
                  <span>{t.scheduleType}{t.scheduleCron ? ` (${t.scheduleCron})` : ''}{t.scheduleIntervalMinutes ? ` (${t.scheduleIntervalMinutes}m)` : ''}</span>
                  {t.runCount > 0 && <><span>·</span><span>{t.runCount} run{t.runCount !== 1 ? 's' : ''}</span></>}
                </div>
              </div>
              <div className="flex items-center gap-1">
                <button onClick={() => handleTrigger(t.id)} className="p-1.5 rounded hover:bg-secondary text-muted-foreground hover:text-foreground" title="Trigger now">
                  <Play size={12} />
                </button>
                <button onClick={() => handleToggle(t)} className="p-1.5 rounded hover:bg-secondary text-muted-foreground hover:text-foreground" title={t.enabled ? 'Disable' : 'Enable'}>
                  {t.enabled ? <Pause size={12} /> : <Play size={12} />}
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Triggers Tab ───────────────────────────────────────────

function TriggersTab({ api, projectName }: { api: ReturnType<typeof useApi>; projectName: (id?: string) => string }) {
  const [triggers, setTriggers] = useState<AgentTrigger[]>([]);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const data = await api.get('/api/agent-triggers');
      setTriggers(data);
    } catch { /* ignore */ }
    setLoading(false);
  }, [api]);

  useEffect(() => { refresh(); }, [refresh]);

  const handleDelete = async (id: string) => {
    try {
      await api.del(`/api/agent-triggers/${id}`);
      setTriggers(prev => prev.filter(t => t.id !== id));
    } catch { /* ignore */ }
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

// ── Shared Components ──────────────────────────────────────

function LoadingState() {
  return (
    <div className="flex items-center justify-center py-12">
      <Loader2 size={20} className="animate-spin text-muted-foreground" />
    </div>
  );
}

function EmptyState({ message }: { message: string }) {
  return (
    <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
      <Zap size={24} className="mb-2 opacity-40" />
      <p className="text-sm">{message}</p>
    </div>
  );
}
