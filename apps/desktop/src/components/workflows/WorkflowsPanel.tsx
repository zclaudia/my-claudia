import { useEffect, useState, useMemo } from 'react';
import { Workflow as WorkflowIcon, Plus, Loader2 } from 'lucide-react';
import type { Workflow, WorkflowRun } from '@my-claudia/shared';
import { useWorkflowStore } from '../../stores/workflowStore';
import { WorkflowCard } from './WorkflowCard';
import { WorkflowEditor } from './WorkflowEditor';
import { WorkflowRunViewer } from './WorkflowRunViewer';

interface WorkflowsPanelProps {
  projectId: string;
}

type ViewState =
  | { type: 'list' }
  | { type: 'editor'; workflow?: Workflow }
  | { type: 'run-viewer'; runId: string };

export function WorkflowsPanel({ projectId }: WorkflowsPanelProps) {
  const {
    workflows,
    runs,
    templates,
    loadWorkflows,
    loadTemplates,
    triggerWorkflow,
    updateWorkflow,
    deleteWorkflow,
    createFromTemplate,
    loadRuns,
  } = useWorkflowStore();

  const [view, setView] = useState<ViewState>({ type: 'list' });
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([loadWorkflows(projectId), loadTemplates()])
      .finally(() => setLoading(false));
  }, [projectId, loadWorkflows, loadTemplates]);

  const projectWorkflows = workflows[projectId] ?? [];

  const activeWorkflows = useMemo(
    () => projectWorkflows.filter((w) => w.status === 'active'),
    [projectWorkflows]
  );
  const disabledWorkflows = useMemo(
    () => projectWorkflows.filter((w) => w.status !== 'active'),
    [projectWorkflows]
  );

  // Load runs for each workflow
  useEffect(() => {
    for (const wf of projectWorkflows) {
      if (!runs[wf.id]) {
        loadRuns(wf.id);
      }
    }
  }, [projectWorkflows, runs, loadRuns]);

  const getLatestRun = (workflowId: string): WorkflowRun | undefined => {
    return (runs[workflowId] ?? [])[0];
  };

  // Active template IDs for this project
  const activeTemplateIds = useMemo(
    () => new Set(projectWorkflows.filter((w) => w.templateId).map((w) => w.templateId)),
    [projectWorkflows]
  );

  // ── Render sub-views ──────────────────────────────────

  if (view.type === 'editor') {
    return (
      <WorkflowEditor
        workflow={view.workflow}
        projectId={projectId}
        onBack={() => setView({ type: 'list' })}
        onSaved={() => {
          setView({ type: 'list' });
          loadWorkflows(projectId);
        }}
      />
    );
  }

  if (view.type === 'run-viewer') {
    return (
      <WorkflowRunViewer
        runId={view.runId}
        onBack={() => setView({ type: 'list' })}
      />
    );
  }

  // ── List view ─────────────────────────────────────────

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-border">
        <div className="flex items-center gap-2">
          <WorkflowIcon size={16} className="text-primary" />
          <h2 className="text-sm font-medium">Workflows</h2>
          {projectWorkflows.length > 0 && (
            <span className="text-xs px-1.5 py-0.5 rounded-full bg-muted text-muted-foreground">
              {projectWorkflows.length}
            </span>
          )}
        </div>
        <button
          onClick={() => setView({ type: 'editor' })}
          className="flex items-center gap-1 px-2.5 py-1 text-xs rounded-md bg-primary text-primary-foreground hover:bg-primary/90 transition-colors"
        >
          <Plus size={14} />
          New
        </button>
      </div>

      <div className="flex-1 overflow-y-auto p-4">
        {loading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 size={20} className="animate-spin text-muted-foreground" />
          </div>
        ) : (
          <>
            {/* Quick Start Templates */}
            {templates.length > 0 && (
              <div className="mb-6">
                <h3 className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-2">
                  Quick Start Templates
                </h3>
                <div className="grid grid-cols-2 gap-2">
                  {templates.map((template) => {
                    const isEnabled = activeTemplateIds.has(template.id);
                    const catColors: Record<string, string> = {
                      git: 'text-orange-500',
                      ai: 'text-purple-500',
                      ci: 'text-blue-500',
                      custom: 'text-muted-foreground',
                    };
                    return (
                      <div
                        key={template.id}
                        className={`border rounded-lg p-3 transition-colors ${
                          isEnabled ? 'border-primary/40 bg-primary/5' : 'border-border hover:border-primary/20'
                        }`}
                      >
                        <div className="flex items-start justify-between">
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-1.5">
                              <span className={`text-xs font-medium ${catColors[template.category]}`}>
                                {template.category}
                              </span>
                            </div>
                            <div className="text-sm font-medium mt-0.5 truncate">{template.name}</div>
                            <div className="text-xs text-muted-foreground mt-0.5 line-clamp-2">
                              {template.description}
                            </div>
                          </div>
                        </div>
                        <button
                          onClick={() => createFromTemplate(projectId, template.id)}
                          className={`mt-2 w-full py-1 text-xs rounded-md border transition-colors ${
                            isEnabled
                              ? 'border-primary/40 text-primary hover:bg-primary/10'
                              : 'border-border hover:bg-secondary'
                          }`}
                        >
                          {isEnabled ? 'Enabled' : 'Enable'}
                        </button>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Active Workflows */}
            {activeWorkflows.length > 0 && (
              <div className="mb-4">
                <h3 className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-2">
                  Active Workflows
                </h3>
                <div className="space-y-2">
                  {activeWorkflows.map((wf) => (
                    <WorkflowCard
                      key={wf.id}
                      workflow={wf}
                      latestRun={getLatestRun(wf.id)}
                      onTrigger={async () => {
                        const run = await triggerWorkflow(wf.id);
                        setView({ type: 'run-viewer', runId: run.id });
                      }}
                      onEdit={() => setView({ type: 'editor', workflow: wf })}
                      onToggle={() => updateWorkflow(wf.id, projectId, { status: 'disabled' })}
                      onDelete={() => deleteWorkflow(wf.id, projectId)}
                      onViewRuns={() => {
                        const latest = getLatestRun(wf.id);
                        if (latest) {
                          setView({ type: 'run-viewer', runId: latest.id });
                        }
                      }}
                    />
                  ))}
                </div>
              </div>
            )}

            {/* Disabled Workflows */}
            {disabledWorkflows.length > 0 && (
              <div>
                <h3 className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-2">
                  Disabled
                </h3>
                <div className="space-y-2">
                  {disabledWorkflows.map((wf) => (
                    <WorkflowCard
                      key={wf.id}
                      workflow={wf}
                      latestRun={getLatestRun(wf.id)}
                      onTrigger={() => {}}
                      onEdit={() => setView({ type: 'editor', workflow: wf })}
                      onToggle={() => updateWorkflow(wf.id, projectId, { status: 'active' })}
                      onDelete={() => deleteWorkflow(wf.id, projectId)}
                      onViewRuns={() => {}}
                    />
                  ))}
                </div>
              </div>
            )}

            {/* Empty state */}
            {projectWorkflows.length === 0 && !loading && (
              <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
                <WorkflowIcon size={32} className="mb-2 opacity-30" />
                <div className="text-sm font-medium">No workflows yet</div>
                <div className="text-xs mt-1">Create one or enable a template to get started</div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
