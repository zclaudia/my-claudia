import { useEffect, useCallback, useState } from 'react';
import type { SupervisionTask } from '@my-claudia/shared';
import { ArrowLeft } from 'lucide-react';
import * as api from '../../services/api';
import { useSupervisionStore } from '../../stores/supervisionStore';
import { AgentStatusBar } from '../supervision/AgentStatusBar';
import { TaskBoard } from '../supervision/TaskBoard';
import { ContextBrowser } from '../supervision/ContextBrowser';
import { CheckpointFeed } from '../supervision/CheckpointFeed';
import { ChatInterface } from '../chat/ChatInterface';
import { LocalPRsPanel } from '../local-prs/LocalPRsPanel';
import { ScheduledTasksPanel } from '../scheduled-tasks/ScheduledTasksPanel';
import { DashboardHome } from './DashboardHome';

export type DashboardView = 'home' | 'tasks' | 'local-prs' | 'scheduled' | 'supervisor';

const VIEW_LABELS: Record<DashboardView, string> = {
  home: 'Dashboard',
  tasks: 'Tasks',
  'local-prs': 'Local Pull Requests',
  scheduled: 'Scheduled Tasks',
  supervisor: 'Supervisor Chat',
};

interface ProjectDashboardProps {
  projectId: string;
  projectRootPath?: string;
}

export function ProjectDashboard({ projectId, projectRootPath }: ProjectDashboardProps) {
  const agent = useSupervisionStore((s) => s.agents[projectId]) ?? null;
  const tasks = useSupervisionStore((s) => s.tasks[projectId]) ?? [];
  const setAgent = useSupervisionStore((s) => s.setAgent);
  const setTasks = useSupervisionStore((s) => s.setTasks);
  const [view, setView] = useState<DashboardView>('home');

  // Reset to home when project changes
  useEffect(() => {
    setView('home');
  }, [projectId]);

  // Hydrate supervision store
  const hydrate = useCallback(async () => {
    try {
      const [fetchedAgent, fetchedTasks] = await Promise.all([
        api.getSupervisionAgent(projectId),
        api.getSupervisionTasks(projectId).catch(() => [] as SupervisionTask[]),
      ]);
      if (fetchedAgent) setAgent(projectId, fetchedAgent);
      setTasks(projectId, fetchedTasks);
    } catch {
      // Silently handle — agent may not exist yet
    }
  }, [projectId, setAgent, setTasks]);

  useEffect(() => {
    hydrate();
  }, [hydrate]);

  const handleOpenSession = () => setView('supervisor');

  return (
    <div className="flex flex-col h-full bg-background">
      {/* Fixed header: Agent status bar */}
      <AgentStatusBar
        projectId={projectId}
        agent={agent}
        onOpenSession={handleOpenSession}
      />

      {/* Back button for drill-down views */}
      {view !== 'home' && (
        <div className="flex items-center gap-2 px-4 py-2 border-b border-border">
          <button
            onClick={() => setView('home')}
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
          onNavigate={setView}
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

      {view === 'scheduled' && (
        <div className="flex-1 overflow-hidden">
          <ScheduledTasksPanel projectId={projectId} />
        </div>
      )}

      {view === 'supervisor' && (
        <div className="flex-1 overflow-hidden">
          {agent?.mainSessionId ? (
            <ChatInterface sessionId={agent.mainSessionId} />
          ) : (
            <div className="flex items-center justify-center h-full text-muted-foreground">
              <div className="text-center">
                <p className="text-sm">No supervisor agent configured.</p>
                <p className="text-xs mt-1">
                  Go to <button onClick={() => setView('tasks')} className="text-primary hover:underline">Tasks</button> to initialize a supervisor agent.
                </p>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
