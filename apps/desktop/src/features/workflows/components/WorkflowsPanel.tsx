import { useEffect, useState, useMemo } from 'react';
import { Workflow as WorkflowIcon, Loader2 } from 'lucide-react';
import type { Workflow, WorkflowRun } from '@my-claudia/shared';
import { useWorkflowStore } from '../store';
import { useIsMobile } from '../../../hooks/useMediaQuery';
import { WorkflowCard } from './WorkflowCard';
import { WorkflowEditor } from './WorkflowEditor';
import { WorkflowRunViewer } from './WorkflowRunViewer';
import { isDesktopTauri } from '../../../utils/platform';
import { openPopoutWindow } from '../../../utils/popoutWindow';
import { useOwnershipStore } from '../../../stores/ownershipStore';
import { useProjectStore } from '../../../stores/projectStore';
import { useAgentConfigStore } from '../../../stores/agentConfigStore';

async function openEditorInNewWindow(projectId: string, workflow?: Workflow) {
  const backendId = useOwnershipStore.getState().getProjectBackendId(projectId);
  await openPopoutWindow({
    type: 'workflow-editor',
    params: {
      workflowEditor: projectId,
      ...(workflow?.id ? { workflowId: workflow.id } : {}),
    },
    title: workflow ? `Edit: ${workflow.name}` : 'New Workflow',
    width: 1100,
    connectionTarget: { backendId },
  });
}

interface WorkflowsPanelProps {
  projectId: string;
  onViewModeChange?: (mode: 'list' | 'detail') => void;
  onOpenAutomations?: () => void;
}

type ViewState =
  | { type: 'list' }
  | { type: 'editor'; workflow?: Workflow; initialMode?: 'toolbox' | 'ai' }
  | { type: 'run-viewer'; runId: string };

export function WorkflowsPanel({ projectId, onViewModeChange, onOpenAutomations }: WorkflowsPanelProps) {
  const isMobile = useIsMobile();
  const project = useProjectStore((state) => state.projects.find((item) => item.id === projectId));
  const globalPermissionWorkflowOverrideId = useAgentConfigStore((state) => state.config?.permissionWorkflowOverrideId ?? null);
  const {
    workflows,
    runs,
    loadWorkflows,
    triggerWorkflow,
    updateWorkflow,
    deleteWorkflow,
    loadRuns,
  } = useWorkflowStore();

  const [view, setView] = useState<ViewState>({ type: 'list' });
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!onViewModeChange) return;
    onViewModeChange(view.type === 'list' ? 'list' : 'detail');
  }, [view.type, onViewModeChange]);

  useEffect(() => {
    loadWorkflows(projectId).finally(() => setLoading(false));
  }, [projectId, loadWorkflows]);

  // Exclude simple automations — they are managed in the Automations tab
  const projectWorkflows = (workflows[projectId] ?? []).filter(w => w.authoringMode !== 'simple');

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

  const getBindingBadges = (workflow: Workflow) => {
    const badges: Array<{ label: string; tone?: 'primary' | 'success' | 'muted' }> = [];
    if (project?.permissionWorkflowOverrideId === workflow.id) {
      badges.push({ label: 'Project override', tone: 'primary' });
    }
    if (globalPermissionWorkflowOverrideId === workflow.id) {
      badges.push({ label: 'Global override', tone: 'success' });
    }
    return badges;
  };

  // ── Render sub-views ──────────────────────────────────

  if (view.type === 'editor' && !isMobile) {
    return (
      <WorkflowEditor
        workflow={view.workflow}
        projectId={projectId}
        onBack={() => setView({ type: 'list' })}
        onSaved={() => {
          setView({ type: 'list' });
          loadWorkflows(projectId);
        }}
        initialMode={view.initialMode}
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
        {onOpenAutomations && (
          <button
            onClick={onOpenAutomations}
            className="flex items-center gap-1 text-[10px] text-muted-foreground hover:text-primary transition-colors"
          >
            Manage in Automations →
          </button>
        )}
      </div>

      <div className="flex-1 overflow-y-auto p-4">
        {loading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 size={20} className="animate-spin text-muted-foreground" />
          </div>
        ) : (
          <>
            {/* Active Workflows (read-only — management in Automations window) */}
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
                      bindingBadges={getBindingBadges(wf)}
                      onTrigger={async () => {
                        const run = await triggerWorkflow(wf.id);
                        setView({ type: 'run-viewer', runId: run.id });
                      }}
                      onEdit={isMobile ? undefined : () => setView({ type: 'editor', workflow: wf })}
                      onToggle={isMobile ? undefined : () => updateWorkflow(wf.id, projectId, { status: 'disabled' })}
                      onDelete={isMobile ? undefined : () => deleteWorkflow(wf.id, projectId)}
                      onViewRuns={() => {
                        const latest = getLatestRun(wf.id);
                        if (latest) {
                          setView({ type: 'run-viewer', runId: latest.id });
                        }
                      }}
                      onPopOut={isDesktopTauri() && !isMobile ? () => openEditorInNewWindow(projectId, wf) : undefined}
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
                      bindingBadges={getBindingBadges(wf)}
                      onTrigger={() => {}}
                      onEdit={isMobile ? undefined : () => setView({ type: 'editor', workflow: wf })}
                      onToggle={isMobile ? undefined : () => updateWorkflow(wf.id, projectId, { status: 'active' })}
                      onDelete={isMobile ? undefined : () => deleteWorkflow(wf.id, projectId)}
                      onPopOut={isDesktopTauri() && !isMobile ? () => openEditorInNewWindow(projectId, wf) : undefined}
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
