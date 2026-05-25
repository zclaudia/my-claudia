import type {
  AcceptanceDecision,
  ProjectAgent,
  AgentMode,
  ChangeExecutionPlan,
  DesignGateDecision,
  ExecutionGateDecision,
  ProjectChange,
  SupervisorConfig,
  SupervisionTask,
  SupervisionLog,
} from '@my-claudia/shared';
import { fetchApi } from './base';
import { apiCall, apiCallVoid } from './unwrap';

export async function initSupervisionAgent(
  projectId: string,
  config?: Partial<SupervisorConfig>,
  providerId?: string,
  mode?: AgentMode,
): Promise<ProjectAgent> {
  return apiCall<ProjectAgent>(`/api/projects/${projectId}/agent/init`, {
    method: 'POST',
    body: JSON.stringify({ config, providerId, mode }),
  });
}

export async function getSupervisionAgent(projectId: string): Promise<ProjectAgent | null> {
  const result = await fetchApi<ProjectAgent>(`/api/projects/${projectId}/agent`);
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
  return apiCall<ProjectAgent>(`/api/projects/${projectId}/agent/action`, {
    method: 'POST',
    body: JSON.stringify({ action }),
  });
}

export async function getSupervisionTasks(
  projectId: string,
  changeId?: string,
): Promise<SupervisionTask[]> {
  const params = changeId ? `?changeId=${encodeURIComponent(changeId)}` : '';
  return apiCall<SupervisionTask[]>(`/api/projects/${projectId}/tasks${params}`);
}

export async function getProjectChanges(projectId: string): Promise<ProjectChange[]> {
  return apiCall<ProjectChange[]>(`/api/projects/${projectId}/changes`);
}

export async function getActiveProjectChange(projectId: string): Promise<ProjectChange | null> {
  const result = await fetchApi<ProjectChange>(`/api/projects/${projectId}/changes/active`);
  if (!result.success) {
    if (result.error?.code === 'NOT_FOUND') return null;
    throw new Error(result.error?.message || 'Failed to get active change');
  }
  return result.data ?? null;
}

export async function createProjectChange(
  projectId: string,
  data: {
    title: string;
    summary: string;
    motivation?: string;
    nonGoals?: string[];
    scope?: string[];
    acceptanceCriteria?: string[];
  },
): Promise<ProjectChange> {
  return apiCall<ProjectChange>(`/api/projects/${projectId}/changes`, {
    method: 'POST',
    body: JSON.stringify(data),
  });
}

export async function getChangeExecutionPlan(changeId: string): Promise<ChangeExecutionPlan> {
  return apiCall<ChangeExecutionPlan>(`/api/changes/${changeId}/execution`);
}

export async function requestDesignGate(
  changeId: string,
  notes?: string,
): Promise<ProjectChange> {
  return apiCall<ProjectChange>(`/api/changes/${changeId}/gates/design/request`, {
    method: 'POST',
    body: JSON.stringify({ notes }),
  });
}

export async function resolveDesignGate(
  changeId: string,
  decision: DesignGateDecision,
  notes?: string,
): Promise<ProjectChange> {
  return apiCall<ProjectChange>(`/api/changes/${changeId}/gates/design/resolve`, {
    method: 'POST',
    body: JSON.stringify({ decision, notes }),
  });
}

export async function requestExecutionGate(
  changeId: string,
  notes?: string,
): Promise<ProjectChange> {
  return apiCall<ProjectChange>(`/api/changes/${changeId}/gates/execution/request`, {
    method: 'POST',
    body: JSON.stringify({ notes }),
  });
}

export async function resolveExecutionGate(
  changeId: string,
  decision: ExecutionGateDecision,
  notes?: string,
): Promise<ProjectChange> {
  return apiCall<ProjectChange>(`/api/changes/${changeId}/gates/execution/resolve`, {
    method: 'POST',
    body: JSON.stringify({ decision, notes }),
  });
}

export async function requestChangeSync(
  changeId: string,
  summary?: string,
): Promise<ProjectChange> {
  return apiCall<ProjectChange>(`/api/changes/${changeId}/sync/request`, {
    method: 'POST',
    body: JSON.stringify({ summary }),
  });
}

export async function requestAcceptance(
  changeId: string,
  notes?: string,
): Promise<ProjectChange> {
  return apiCall<ProjectChange>(`/api/changes/${changeId}/acceptance/request`, {
    method: 'POST',
    body: JSON.stringify({ notes }),
  });
}

export async function resolveAcceptance(
  changeId: string,
  decision: AcceptanceDecision,
  notes?: string,
): Promise<ProjectChange> {
  return apiCall<ProjectChange>(`/api/changes/${changeId}/acceptance/resolve`, {
    method: 'POST',
    body: JSON.stringify({ decision, notes }),
  });
}

export async function completeProjectChange(
  changeId: string,
  summary?: string,
): Promise<ProjectChange> {
  return apiCall<ProjectChange>(`/api/changes/${changeId}/complete`, {
    method: 'POST',
    body: JSON.stringify({ summary }),
  });
}

export async function updateChangeDocument(
  changeId: string,
  docType: 'design' | 'execution' | 'tasks',
  content: string,
): Promise<ProjectChange> {
  return apiCall<ProjectChange>(`/api/changes/${changeId}/docs/${docType}`, {
    method: 'PUT',
    body: JSON.stringify({ content }),
  });
}

export async function createSupervisionTask(
  projectId: string,
  data: {
    changeId?: string;
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
  return apiCall<SupervisionTask>(`/api/projects/${projectId}/tasks`, {
    method: 'POST',
    body: JSON.stringify(data),
  });
}

export async function openTaskSession(taskId: string): Promise<{ sessionId: string }> {
  return apiCall<{ sessionId: string }>(`/api/tasks/${taskId}/open-session`, {
    method: 'POST',
  });
}

export interface TaskPlanStatus {
  exists: boolean;
  ready: boolean;
  score: number;
  missing: string[];
  path: string;
}

export async function getTaskPlanStatus(taskId: string): Promise<TaskPlanStatus> {
  return apiCall<TaskPlanStatus>(`/api/tasks/${taskId}/plan-status`);
}

export async function submitTaskPlan(taskId: string): Promise<{ task: SupervisionTask; sessionId: string }> {
  return apiCall<{ task: SupervisionTask; sessionId: string }>(`/api/tasks/${taskId}/plan/submit`, {
    method: 'POST',
  });
}

export async function updateSupervisionTask(
  taskId: string,
  data: Partial<Pick<SupervisionTask,
    'title' | 'description' | 'priority' | 'dependencies' | 'dependencyMode'
    | 'acceptanceCriteria' | 'relevantDocIds' | 'scope' | 'taskSpecificContext'
  >>,
): Promise<SupervisionTask> {
  return apiCall<SupervisionTask>(`/api/tasks/${taskId}`, {
    method: 'PUT',
    body: JSON.stringify(data),
  });
}

export async function approveSupervisionTask(taskId: string): Promise<SupervisionTask> {
  return apiCall<SupervisionTask>(`/api/tasks/${taskId}/approve`, { method: 'POST' });
}

export async function rejectSupervisionTask(taskId: string): Promise<SupervisionTask> {
  return apiCall<SupervisionTask>(`/api/tasks/${taskId}/reject`, { method: 'POST' });
}

export async function approveSupervisionTaskResult(taskId: string): Promise<SupervisionTask> {
  return apiCall<SupervisionTask>(`/api/tasks/${taskId}/review/approve`, { method: 'POST' });
}

export async function rejectSupervisionTaskResult(
  taskId: string,
  notes: string,
): Promise<SupervisionTask> {
  return apiCall<SupervisionTask>(`/api/tasks/${taskId}/review/reject`, {
    method: 'POST',
    body: JSON.stringify({ notes }),
  });
}

export async function retryTask(taskId: string): Promise<SupervisionTask> {
  return apiCall<SupervisionTask>(`/api/tasks/${taskId}/retry`, { method: 'POST' });
}

export async function cancelTask(taskId: string): Promise<SupervisionTask> {
  return apiCall<SupervisionTask>(`/api/tasks/${taskId}/cancel`, { method: 'POST' });
}

export async function runTaskNow(taskId: string): Promise<SupervisionTask> {
  return apiCall<SupervisionTask>(`/api/tasks/${taskId}/run-now`, { method: 'POST' });
}

export async function resolveSupervisionConflict(taskId: string): Promise<SupervisionTask> {
  return apiCall<SupervisionTask>(`/api/tasks/${taskId}/resolve-conflict`, { method: 'POST' });
}

export async function reloadSupervisionContext(projectId: string): Promise<void> {
  return apiCallVoid(`/api/projects/${projectId}/context/reload`, { method: 'POST' });
}

export async function getSupervisionContext(projectId: string): Promise<any[]> {
  return apiCall<any[]>(`/api/projects/${projectId}/context`);
}

export async function getSupervisionBudget(projectId: string): Promise<{
  usage: number;
  limit?: number;
  remaining?: number;
}> {
  return apiCall<{ usage: number; limit?: number; remaining?: number }>(
    `/api/projects/${projectId}/budget`,
  );
}

export async function getSupervisionLogs(
  projectId: string,
  limit?: number,
): Promise<SupervisionLog[]> {
  const params = limit ? `?limit=${limit}` : '';
  return apiCall<SupervisionLog[]>(`/api/projects/${projectId}/logs${params}`);
}
