import { useState, useEffect, useCallback, useMemo } from 'react';
import { Plus, RefreshCw, Play, Pause, Trash2, FolderOpen, Globe } from 'lucide-react';
import type { Workflow } from '@my-claudia/shared';
import type { AutomationApiType } from './useAutomationApi';
import type { ProjectInfo, AutomationItem } from './automation-types';
import { renderProjectOptions, simpleWorkflowToItem } from './automation-types';
import { LoadingState, EmptyState } from './AutomationSharedComponents';

interface AutomationsTabProps {
  api: AutomationApiType;
  projects: ProjectInfo[];
  projectName: (id?: string) => string;
  initialProjectId?: string;
}

export function AutomationsTab({ api, projects, projectName, initialProjectId }: AutomationsTabProps) {
  const [simpleWorkflows, setSimpleWorkflows] = useState<Workflow[]>([]);
  const [loading, setLoading] = useState(true);

  // Create form state
  const [createProjectId, setCreateProjectId] = useState(initialProjectId ?? '');
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
