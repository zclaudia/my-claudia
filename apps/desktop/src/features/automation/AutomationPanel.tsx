/**
 * Global Automations Panel — embedded in main app view.
 *
 * Directly embeds the existing project-level panels (WorkflowsPanel,
 * ScheduledTasksPanel) with a project picker for scope selection,
 * plus a dedicated System Tasks tab.
 */

import { useState, useEffect, useCallback, type ReactNode } from 'react';
import {
  Zap, Clock, Server, RefreshCw, ArrowLeft, ExternalLink,
  Loader2, ChevronDown, ChevronRight,
  CheckCircle2, XCircle,
} from 'lucide-react';
import type { SystemTaskInfo } from '@my-claudia/shared';
import { useSystemTaskStore } from '../../stores/systemTaskStore';
import { useProjectStore } from '../../stores/projectStore';
import { ScheduledTasksPanel } from '../scheduled-tasks/components/ScheduledTasksPanel';
import { WorkflowsPanel } from '../workflows/components/WorkflowsPanel';
import { TaskRunHistory } from '../scheduled-tasks/components/TaskRunHistory';

type Tab = 'workflows' | 'scheduled' | 'system';

// ── Helpers ──────────────────────────────────────────────────────

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

// ── Project Picker ───────────────────────────────────────────────

function ProjectPicker({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const projects = useProjectStore((s) => s.projects);
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="px-2 py-1 text-xs rounded border border-border bg-background text-foreground"
    >
      {projects.map((p) => (
        <option key={p.id} value={p.id}>{p.name}</option>
      ))}
    </select>
  );
}

// ── System Tasks Tab ─────────────────────────────────────────────

function SystemTasksTab() {
  const tasks = useSystemTaskStore((s) => s.tasks);
  const loadTasks = useSystemTaskStore((s) => s.loadTasks);
  const [loading, setLoading] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    await loadTasks().catch(() => {});
    setLoading(false);
  }, [loadTasks]);

  useEffect(() => { refresh(); }, [refresh]);

  if (loading && tasks.length === 0) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 size={20} className="animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <div className="flex items-center justify-between px-3 py-2 border-b border-border shrink-0">
        <div className="flex items-center gap-2">
          <Server size={14} className="text-muted-foreground" />
          <span className="text-xs font-medium text-foreground">System Tasks</span>
          {tasks.length > 0 && (
            <span className="text-[10px] bg-primary/15 text-primary px-1.5 py-0.5 rounded-full leading-none">
              {tasks.length}
            </span>
          )}
        </div>
        <button onClick={refresh} className="p-1 rounded hover:bg-secondary text-muted-foreground" title="Refresh">
          <RefreshCw size={12} className={loading ? 'animate-spin' : ''} />
        </button>
      </div>
      <div className="flex-1 overflow-auto p-3 space-y-2">
        {tasks.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
            <Server size={24} className="mb-2 opacity-40" />
            <p className="text-xs">No system tasks running</p>
          </div>
        ) : (
          tasks.map((t) => (
            <SystemTaskRow
              key={t.id}
              task={t}
              expanded={expandedId === t.id}
              onToggleExpand={() => setExpandedId(expandedId === t.id ? null : t.id)}
            />
          ))
        )}
      </div>
    </div>
  );
}

function SystemTaskRow({ task, expanded, onToggleExpand }: {
  task: SystemTaskInfo;
  expanded: boolean;
  onToggleExpand: () => void;
}) {
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
      {expanded && (
        <div className="px-3 pb-3">
          <TaskRunHistory taskId={task.id} taskSource="system" />
        </div>
      )}
    </div>
  );
}

// ── Main Panel ───────────────────────────────────────────────────

interface AutomationPanelProps {
  onClose: () => void;
}

const TABS: { key: Tab; label: string; icon: ReactNode }[] = [
  { key: 'workflows', label: 'Workflows', icon: <Zap size={14} /> },
  { key: 'scheduled', label: 'Scheduled Tasks', icon: <Clock size={14} /> },
  { key: 'system', label: 'System', icon: <Server size={14} /> },
];

export function AutomationPanel({ onClose }: AutomationPanelProps) {
  const [tab, setTab] = useState<Tab>('workflows');
  const projects = useProjectStore((s) => s.projects);
  const [selectedProjectId, setSelectedProjectId] = useState<string>('');

  // Default to first project
  useEffect(() => {
    if (!selectedProjectId && projects.length > 0) {
      setSelectedProjectId(projects[0].id);
    }
  }, [projects, selectedProjectId]);

  const showProjectPicker = (tab === 'workflows' || tab === 'scheduled') && projects.length > 1;

  return (
    <div className="flex flex-col h-full bg-background">
      {/* Header */}
      <div className="flex items-center gap-3 px-4 py-3 border-b border-border bg-card/50">
        <button onClick={onClose} className="p-1 rounded hover:bg-secondary text-muted-foreground hover:text-foreground" title="Back">
          <ArrowLeft size={16} />
        </button>
        <Zap size={16} className="text-primary" />
        <h1 className="text-sm font-semibold">Automations</h1>
        <button
          onClick={() => import('./openAutomationWindow').then(m => m.openAutomationWindow())}
          className="p-1 rounded hover:bg-secondary text-muted-foreground hover:text-foreground"
          title="Open in separate window"
        >
          <ExternalLink size={14} />
        </button>
        <div className="flex-1" />
        {showProjectPicker && (
          <ProjectPicker value={selectedProjectId} onChange={setSelectedProjectId} />
        )}
        <div className="flex gap-0.5 bg-secondary/50 rounded-lg p-0.5">
          {TABS.map((t) => (
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

      {/* Content — embed existing panels directly */}
      <div className="flex-1 overflow-hidden">
        {tab === 'workflows' && selectedProjectId && (
          <WorkflowsPanel projectId={selectedProjectId} />
        )}
        {tab === 'scheduled' && selectedProjectId && (
          <ScheduledTasksPanel projectId={selectedProjectId} />
        )}
        {tab === 'system' && (
          <SystemTasksTab />
        )}
        {(tab === 'workflows' || tab === 'scheduled') && !selectedProjectId && (
          <div className="flex items-center justify-center h-full text-muted-foreground">
            <p className="text-xs">Create a project first to manage automations.</p>
          </div>
        )}
      </div>
    </div>
  );
}
