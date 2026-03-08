import { useEffect, useCallback, useState } from 'react';
import type { SupervisionTask } from '@my-claudia/shared';
import * as api from '../../services/api';
import { useSupervisionStore } from '../../stores/supervisionStore';
import { AgentStatusBar } from './AgentStatusBar';
import { TaskBoard } from './TaskBoard';
import { ContextBrowser } from './ContextBrowser';
import { CheckpointFeed } from './CheckpointFeed';
import { LocalPRsPanel } from '../local-prs/LocalPRsPanel';
import { useLocalPRStore } from '../../stores/localPRStore';

interface SupervisionDashboardProps {
  projectId: string;
  projectRootPath?: string;
}

type Tab = 'tasks' | 'local-prs';

export function SupervisionDashboard({ projectId, projectRootPath }: SupervisionDashboardProps) {
  const agent = useSupervisionStore((s) => s.agents[projectId]) ?? null;
  const tasks = useSupervisionStore((s) => s.tasks[projectId]) ?? [];
  const setAgent = useSupervisionStore((s) => s.setAgent);
  const setTasks = useSupervisionStore((s) => s.setTasks);
  const [activeTab, setActiveTab] = useState<Tab>('tasks');

  // Badge count for Local PRs
  const prs = useLocalPRStore((s) => s.prs[projectId] ?? []);
  const activePRCount = prs.filter((pr) => !['merged', 'closed'].includes(pr.status)).length;

  // Hydrate store on mount
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

  return (
    <div className="flex flex-col h-full bg-background">
      {/* Agent status bar */}
      <AgentStatusBar projectId={projectId} agent={agent} />

      {/* Tab bar */}
      <div className="flex border-b border-border px-3 pt-1 gap-1">
        <button
          onClick={() => setActiveTab('tasks')}
          className={`text-xs px-3 py-1.5 rounded-t-md border-b-2 transition-colors ${
            activeTab === 'tasks'
              ? 'border-primary text-foreground font-medium'
              : 'border-transparent text-muted-foreground hover:text-foreground'
          }`}
        >
          Tasks
        </button>
        <button
          onClick={() => setActiveTab('local-prs')}
          className={`text-xs px-3 py-1.5 rounded-t-md border-b-2 transition-colors flex items-center gap-1.5 ${
            activeTab === 'local-prs'
              ? 'border-primary text-foreground font-medium'
              : 'border-transparent text-muted-foreground hover:text-foreground'
          }`}
        >
          Local PRs
          {activePRCount > 0 && (
            <span className="text-xs bg-primary/20 text-primary px-1 py-0.5 rounded-full leading-none">
              {activePRCount}
            </span>
          )}
        </button>
      </div>

      {/* Tab content */}
      {activeTab === 'tasks' ? (
        /* Main content: task board + sidebar */
        <div className="flex-1 flex overflow-hidden">
          {/* Left: Task board (60%) */}
          <div className="flex-[3] border-r border-border overflow-hidden">
            <TaskBoard projectId={projectId} tasks={tasks} />
          </div>

          {/* Right: Context + Checkpoints (40%) */}
          <div className="flex-[2] flex flex-col overflow-hidden">
            <div className="flex-1 border-b border-border overflow-hidden">
              <ContextBrowser projectId={projectId} />
            </div>
            <div className="flex-1 overflow-hidden">
              <CheckpointFeed projectId={projectId} />
            </div>
          </div>
        </div>
      ) : (
        <div className="flex-1 overflow-hidden">
          <LocalPRsPanel projectId={projectId} projectRootPath={projectRootPath} />
        </div>
      )}
    </div>
  );
}
