import { useEffect, useCallback, useState } from 'react';
import type { SupervisionTask } from '@my-claudia/shared';
import { ArrowLeft } from 'lucide-react';
import * as api from '../../services/api';
import { useSupervisionStore } from '../../features/supervision/store';
import { TaskBoard } from '../../features/supervision/components/TaskBoard';
import { ContextBrowser } from '../../features/supervision/components/ContextBrowser';
import { CheckpointFeed } from '../../features/supervision/components/CheckpointFeed';
import { SupervisorWorkspacePanel } from '../../features/supervision/components/SupervisorWorkspacePanel';
import { SessionChatLayout } from '../../features/chat/SessionChatLayout';
import { LocalPRsPanel } from '../../features/local-pr/components/LocalPRsPanel';
import { LocalIssuesPanel } from '../../features/local-issues/components/LocalIssuesPanel';
import { DashboardHome } from './DashboardHome';
import { useSelectionStore } from '../../stores/selectionStore';
import type { OpenAutomationWindowOptions } from '../automation/openAutomationWindow';

export type DashboardView = 'home' | 'tasks' | 'local-prs' | 'issues' | 'supervisor';

const VIEW_LABELS: Record<DashboardView, string> = {
  home: 'Dashboard',
  tasks: 'Tasks',
  'local-prs': 'Local Pull Requests',
  issues: 'Issues',
  supervisor: 'Supervisor Workspace',
};

interface ProjectDashboardProps {
  projectId: string;
  projectRootPath?: string;
  onOpenAutomations?: (opts: OpenAutomationWindowOptions) => void;
}

export function ProjectDashboard({ projectId, projectRootPath, onOpenAutomations }: ProjectDashboardProps) {
  const agent = useSupervisionStore((s) => s.agents[projectId]) ?? null;
  const tasks = useSupervisionStore((s) => s.tasks[projectId]) ?? [];
  const setAgent = useSupervisionStore((s) => s.setAgent);
  const setTasks = useSupervisionStore((s) => s.setTasks);
  const setActiveChange = useSupervisionStore((s) => s.setActiveChange);
  const setExecutionPlan = useSupervisionStore((s) => s.setExecutionPlan);
  const savedView = useSelectionStore((s) => s.dashboardViews[projectId] ?? 'home');
  const setDashboardView = useSelectionStore((s) => s.setDashboardView);
  const [view, setView] = useState<DashboardView>(savedView);
  const [supervisorPane, setSupervisorPane] = useState<'workspace' | 'chat'>('workspace');

  const navigate = useCallback((nextView: DashboardView) => {
    setView(nextView);
    setDashboardView(projectId, nextView);
  }, [projectId, setDashboardView]);

  // Restore last dashboard sub-view for this project
  useEffect(() => {
    setView(savedView);
    setSupervisorPane('workspace');
  }, [projectId, savedView]);

  // Hydrate supervision store
  const hydrate = useCallback(async () => {
    try {
      const [fetchedAgent, fetchedTasks] = await Promise.all([
        api.getSupervisionAgent(projectId),
        api.getSupervisionTasks(projectId).catch(() => [] as SupervisionTask[]),
      ]);
      if (fetchedAgent) setAgent(projectId, fetchedAgent);
      setTasks(projectId, fetchedTasks);
      const activeChange = await api.getActiveProjectChange(projectId).catch(() => null);
      setActiveChange(projectId, activeChange);
      if (activeChange) {
        const executionPlan = await api.getChangeExecutionPlan(activeChange.id).catch(() => null);
        if (executionPlan) {
          setExecutionPlan(activeChange.id, executionPlan);
        }
      }
    } catch {
      // Silently handle — agent may not exist yet
    }
  }, [projectId, setAgent, setTasks, setActiveChange, setExecutionPlan]);

  useEffect(() => {
    hydrate();
  }, [hydrate]);

  return (
    <div className="flex flex-col h-full bg-background">
      {/* Back button for drill-down views */}
      {view !== 'home' && (
        <div className="flex items-center gap-2 px-4 py-2 border-b border-border">
          <button
            onClick={() => navigate('home')}
            className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
          >
            <ArrowLeft className="w-3.5 h-3.5" />
            Dashboard
          </button>
          <span className="text-xs text-muted-foreground">/</span>
          <span className="text-xs font-medium">{VIEW_LABELS[view]}</span>
        </div>
      )}

      {/* View content */}
      {view === 'home' && (
        <DashboardHome
          projectId={projectId}
          projectRootPath={projectRootPath}
          onNavigate={navigate}
          onOpenAutomations={onOpenAutomations}
        />
      )}

      {view === 'tasks' && (
        <div className="flex-1 flex overflow-hidden">
          <div className="flex-[3] border-r border-border overflow-hidden">
            <TaskBoard projectId={projectId} tasks={tasks} />
          </div>
          <div className="flex-[2] flex flex-col overflow-hidden">
            <div className="flex-1 border-b border-border overflow-hidden">
              <ContextBrowser projectId={projectId} />
            </div>
            <div className="flex-1 overflow-hidden">
              <CheckpointFeed projectId={projectId} />
            </div>
          </div>
        </div>
      )}

      {view === 'local-prs' && (
        <div className="flex-1 overflow-hidden">
          <LocalPRsPanel projectId={projectId} projectRootPath={projectRootPath} />
        </div>
      )}

      {view === 'issues' && (
        <div className="flex-1 overflow-hidden">
          <LocalIssuesPanel projectId={projectId} />
        </div>
      )}

      {view === 'supervisor' && (
        <div className="flex-1 overflow-hidden">
          <div className="flex h-full flex-col overflow-hidden">
            <div className="flex items-center gap-2 border-b border-border px-4 py-2">
              {(['workspace', 'chat'] as const).map((pane) => (
                <button
                  key={pane}
                  type="button"
                  onClick={() => setSupervisorPane(pane)}
                  className={`rounded-md px-3 py-1.5 text-xs transition-colors ${
                    supervisorPane === pane
                      ? 'bg-primary text-primary-foreground'
                      : 'bg-secondary text-muted-foreground hover:text-foreground'
                  }`}
                >
                  {pane === 'workspace' ? 'Workspace' : 'Chat'}
                </button>
              ))}
            </div>
            <div className="flex-1 overflow-hidden">
              {supervisorPane === 'workspace' ? (
                <SupervisorWorkspacePanel projectId={projectId} agent={agent} />
              ) : agent?.mainSessionId ? (
                <SessionChatLayout sessionId={agent.mainSessionId} />
              ) : (
                <div className="flex items-center justify-center h-full text-muted-foreground">
                  <div className="text-center">
                    <p className="text-sm">No supervisor agent configured.</p>
                    <p className="text-xs mt-1">
                      Go to <button onClick={() => navigate('tasks')} className="text-primary hover:underline">Tasks</button> to initialize a supervisor agent.
                    </p>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
