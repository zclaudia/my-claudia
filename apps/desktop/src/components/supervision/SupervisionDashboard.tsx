import { useEffect, useCallback } from 'react';
import type { SupervisionTask } from '@my-claudia/shared';
import * as api from '../../services/api';
import { useSupervisionStore } from '../../stores/supervisionStore';
import { AgentStatusBar } from './AgentStatusBar';
import { TaskBoard } from './TaskBoard';
import { ContextBrowser } from './ContextBrowser';
import { CheckpointFeed } from './CheckpointFeed';

interface SupervisionDashboardProps {
  projectId: string;
}

export function SupervisionDashboard({ projectId }: SupervisionDashboardProps) {
  const agent = useSupervisionStore((s) => s.agents[projectId]) ?? null;
  const tasks = useSupervisionStore((s) => s.tasks[projectId]) ?? [];
  const setAgent = useSupervisionStore((s) => s.setAgent);
  const setTasks = useSupervisionStore((s) => s.setTasks);

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

      {/* Main content: task board + sidebar */}
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
    </div>
  );
}
