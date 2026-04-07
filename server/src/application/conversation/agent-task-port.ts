import type { TaskResult, OrchestratorTask } from '../orchestration/types.js';

export interface AgentTaskPort {
  spawnTask(
    parentId: string | null,
    config: {
      task: string;
      projectId?: string;
      contextTemplate?: string;
      dependsOn?: string[];
    },
  ): Promise<string>;
  steerTask(taskId: string, instruction: string): Promise<void>;
  killTask(taskId: string): Promise<void>;
  listTasks(parentId?: string): OrchestratorTask[];
  waitForTask(taskId: string, timeoutMs?: number): Promise<TaskResult>;
  getTaskResult(taskId: string): Promise<TaskResult>;
}
