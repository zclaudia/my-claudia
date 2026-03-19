import type {
  ProjectAgent,
  AgentMode,
  SupervisorConfig,
  SupervisionTask,
  SupervisionV2Log,
} from '@my-claudia/shared';
import { fetchApi } from './base';

export async function initSupervisionAgent(
  projectId: string,
  config?: Partial<SupervisorConfig>,
  providerId?: string,
  mode?: AgentMode,
): Promise<ProjectAgent> {
  const result = await fetchApi<ProjectAgent>(`/api/v2/projects/${projectId}/agent/init`, {
    method: 'POST',
    body: JSON.stringify({ config, providerId, mode }),
  });
  if (!result.success || !result.data) {
    throw new Error(result.error?.message || 'Failed to initialize agent');
  }
  return result.data;
}

export async function getSupervisionAgent(projectId: string): Promise<ProjectAgent | null> {
  const result = await fetchApi<ProjectAgent>(`/api/v2/projects/${projectId}/agent`);
  if (!result.success) {
    if (result.error?.code === 'NOT_FOUND') return null;
    throw new Error(result.error?.message || 'Failed to get agent');
  }
  return result.data ?? null;
}

export async function updateSupervisionAgentAction(
  projectId: string,
  action: 'pause' | 'resume' | 'archive' | 'approve_setup',
): Promise<ProjectAgent> {
  const result = await fetchApi<ProjectAgent>(`/api/v2/projects/${projectId}/agent/action`, {
    method: 'POST',
    body: JSON.stringify({ action }),
  });
  if (!result.success || !result.data) {
    throw new Error(result.error?.message || 'Failed to update agent');
  }
  return result.data;
}

export async function getSupervisionTasks(projectId: string): Promise<SupervisionTask[]> {
  const result = await fetchApi<SupervisionTask[]>(`/api/v2/projects/${projectId}/tasks`);
  if (!result.success || !result.data) {
    throw new Error(result.error?.message || 'Failed to fetch tasks');
  }
  return result.data;
}

export async function createSupervisionTask(
  projectId: string,
  data: {
    title: string;
    description: string;
    dependencies?: string[];
    dependencyMode?: 'all' | 'any';
    priority?: number;
    acceptanceCriteria?: string[];
    relevantDocIds?: string[];
    scope?: string[];
    scheduleCron?: string;
    scheduleEnabled?: boolean;
    retryDelayMs?: number;
  },
): Promise<SupervisionTask> {
  const result = await fetchApi<SupervisionTask>(`/api/v2/projects/${projectId}/tasks`, {
    method: 'POST',
    body: JSON.stringify(data),
  });
  if (!result.success || !result.data) {
    throw new Error(result.error?.message || 'Failed to create task');
  }
  return result.data;
}

export async function openTaskSession(taskId: string): Promise<{ sessionId: string }> {
  const result = await fetchApi<{ sessionId: string }>(`/api/v2/tasks/${taskId}/open-session`, {
    method: 'POST',
  });
  if (!result.success || !result.data) {
    throw new Error(result.error?.message || 'Failed to open task session');
  }
  return result.data;
}

export interface TaskPlanStatus {
  exists: boolean;
  ready: boolean;
  score: number;
  missing: string[];
  path: string;
}

export async function getTaskPlanStatus(taskId: string): Promise<TaskPlanStatus> {
  const result = await fetchApi<TaskPlanStatus>(`/api/v2/tasks/${taskId}/plan-status`);
  if (!result.success || !result.data) {
    throw new Error(result.error?.message || 'Failed to get task plan status');
  }
  return result.data;
}

export async function submitTaskPlan(taskId: string): Promise<{ task: SupervisionTask; sessionId: string }> {
  const result = await fetchApi<{ task: SupervisionTask; sessionId: string }>(`/api/v2/tasks/${taskId}/plan/submit`, {
    method: 'POST',
  });
  if (!result.success || !result.data) {
    throw new Error(result.error?.message || 'Failed to submit task plan');
  }
  return result.data;
}

export async function updateSupervisionTask(
  taskId: string,
  data: Partial<Pick<SupervisionTask,
    'title' | 'description' | 'priority' | 'dependencies' | 'dependencyMode'
    | 'acceptanceCriteria' | 'relevantDocIds' | 'scope' | 'taskSpecificContext'
  >>,
): Promise<SupervisionTask> {
  const result = await fetchApi<SupervisionTask>(`/api/v2/tasks/${taskId}`, {
    method: 'PUT',
    body: JSON.stringify(data),
  });
  if (!result.success || !result.data) {
    throw new Error(result.error?.message || 'Failed to update task');
  }
  return result.data;
}

export async function approveSupervisionTask(taskId: string): Promise<SupervisionTask> {
  const result = await fetchApi<SupervisionTask>(`/api/v2/tasks/${taskId}/approve`, {
    method: 'POST',
  });
  if (!result.success || !result.data) {
    throw new Error(result.error?.message || 'Failed to approve task');
  }
  return result.data;
}

export async function rejectSupervisionTask(taskId: string): Promise<SupervisionTask> {
  const result = await fetchApi<SupervisionTask>(`/api/v2/tasks/${taskId}/reject`, {
    method: 'POST',
  });
  if (!result.success || !result.data) {
    throw new Error(result.error?.message || 'Failed to reject task');
  }
  return result.data;
}

export async function approveSupervisionTaskResult(taskId: string): Promise<SupervisionTask> {
  const result = await fetchApi<SupervisionTask>(`/api/v2/tasks/${taskId}/review/approve`, {
    method: 'POST',
  });
  if (!result.success || !result.data) {
    throw new Error(result.error?.message || 'Failed to approve task result');
  }
  return result.data;
}

export async function rejectSupervisionTaskResult(
  taskId: string,
  notes: string,
): Promise<SupervisionTask> {
  const result = await fetchApi<SupervisionTask>(`/api/v2/tasks/${taskId}/review/reject`, {
    method: 'POST',
    body: JSON.stringify({ notes }),
  });
  if (!result.success || !result.data) {
    throw new Error(result.error?.message || 'Failed to reject task result');
  }
  return result.data;
}

export async function retryTask(taskId: string): Promise<SupervisionTask> {
  const result = await fetchApi<SupervisionTask>(`/api/v2/tasks/${taskId}/retry`, {
    method: 'POST',
  });
  if (!result.success || !result.data) {
    throw new Error(result.error?.message || 'Failed to retry task');
  }
  return result.data;
}

export async function cancelTask(taskId: string): Promise<SupervisionTask> {
  const result = await fetchApi<SupervisionTask>(`/api/v2/tasks/${taskId}/cancel`, {
    method: 'POST',
  });
  if (!result.success || !result.data) {
    throw new Error(result.error?.message || 'Failed to cancel task');
  }
  return result.data;
}

export async function runTaskNow(taskId: string): Promise<SupervisionTask> {
  const result = await fetchApi<SupervisionTask>(`/api/v2/tasks/${taskId}/run-now`, {
    method: 'POST',
  });
  if (!result.success || !result.data) {
    throw new Error(result.error?.message || 'Failed to run task');
  }
  return result.data;
}

export async function resolveSupervisionConflict(taskId: string): Promise<SupervisionTask> {
  const result = await fetchApi<SupervisionTask>(`/api/v2/tasks/${taskId}/resolve-conflict`, {
    method: 'POST',
  });
  if (!result.success || !result.data) {
    throw new Error(result.error?.message || 'Failed to resolve conflict');
  }
  return result.data;
}

export async function reloadSupervisionContext(projectId: string): Promise<void> {
  const result = await fetchApi<null>(`/api/v2/projects/${projectId}/context/reload`, {
    method: 'POST',
  });
  if (!result.success) {
    throw new Error(result.error?.message || 'Failed to reload context');
  }
}

export async function getSupervisionContext(projectId: string): Promise<any[]> {
  const result = await fetchApi<any[]>(`/api/v2/projects/${projectId}/context`);
  if (!result.success || !result.data) {
    throw new Error(result.error?.message || 'Failed to get context');
  }
  return result.data;
}

export async function getSupervisionBudget(projectId: string): Promise<{
  usage: number;
  limit?: number;
  remaining?: number;
}> {
  const result = await fetchApi<{ usage: number; limit?: number; remaining?: number }>(
    `/api/v2/projects/${projectId}/budget`,
  );
  if (!result.success || !result.data) {
    throw new Error(result.error?.message || 'Failed to get budget');
  }
  return result.data;
}

export async function getSupervisionV2Logs(
  projectId: string,
  limit?: number,
): Promise<SupervisionV2Log[]> {
  const params = limit ? `?limit=${limit}` : '';
  const result = await fetchApi<SupervisionV2Log[]>(`/api/v2/projects/${projectId}/logs${params}`);
  if (!result.success || !result.data) {
    throw new Error(result.error?.message || 'Failed to get logs');
  }
  return result.data;
}
