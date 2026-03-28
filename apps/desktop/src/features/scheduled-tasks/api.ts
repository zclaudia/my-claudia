import type { ScheduledTask, ScheduledTaskTemplate, SystemTaskInfo, TaskRun } from '@my-claudia/shared';
import { apiCall, apiCallForBackend, apiCallVoidForBackend } from '../../services/api/unwrap';
import { useOwnershipStore } from '../../stores/ownershipStore';

function resolveTaskBackendId(taskId: string, backendId?: string | null): string | null {
  if (backendId) return backendId;
  const state = useOwnershipStore.getState() as { getTaskBackendId?: (taskId: string) => string | null };
  return state.getTaskBackendId?.(taskId) ?? null;
}

export async function listScheduledTasks(projectId: string, backendId?: string | null): Promise<ScheduledTask[]> {
  return apiCallForBackend<ScheduledTask[]>(backendId, `/api/projects/${projectId}/scheduled-tasks`);
}

export async function listGlobalScheduledTasks(backendId?: string | null): Promise<ScheduledTask[]> {
  return apiCallForBackend<ScheduledTask[]>(backendId, '/api/scheduled-tasks/global');
}

export async function createScheduledTask(
  projectId: string | undefined,
  data: Partial<ScheduledTask>,
  backendId?: string | null
): Promise<ScheduledTask> {
  const path = projectId
    ? `/api/projects/${projectId}/scheduled-tasks`
    : '/api/scheduled-tasks/global';
  return apiCallForBackend<ScheduledTask>(backendId, path, {
    method: 'POST',
    body: JSON.stringify(data),
  });
}

export async function updateScheduledTask(
  taskId: string,
  data: Partial<ScheduledTask>,
  backendId?: string | null
): Promise<ScheduledTask> {
  return apiCallForBackend<ScheduledTask>(resolveTaskBackendId(taskId, backendId), `/api/scheduled-tasks/${taskId}`, {
    method: 'PATCH',
    body: JSON.stringify(data),
  });
}

export async function deleteScheduledTask(taskId: string, backendId?: string | null): Promise<void> {
  return apiCallVoidForBackend(resolveTaskBackendId(taskId, backendId), `/api/scheduled-tasks/${taskId}`, { method: 'DELETE' });
}

export async function triggerScheduledTask(taskId: string, backendId?: string | null): Promise<ScheduledTask> {
  return apiCallForBackend<ScheduledTask>(resolveTaskBackendId(taskId, backendId), `/api/scheduled-tasks/${taskId}/trigger`, { method: 'POST' });
}

export async function listScheduledTaskTemplates(): Promise<ScheduledTaskTemplate[]> {
  return apiCall<ScheduledTaskTemplate[]>('/api/scheduled-task-templates');
}

export async function enableTemplateTask(
  projectId: string,
  templateId: string,
  backendId?: string | null
): Promise<ScheduledTask> {
  return apiCallForBackend<ScheduledTask>(
    backendId,
    `/api/projects/${projectId}/scheduled-tasks/from-template/${templateId}`,
    { method: 'POST' },
  );
}

// System Tasks & Task Run History

export async function listSystemTasks(): Promise<SystemTaskInfo[]> {
  return apiCall<SystemTaskInfo[]>('/api/system-tasks');
}

export async function listTaskRuns(taskId: string, limit: number = 50, backendId?: string | null): Promise<TaskRun[]> {
  return apiCallForBackend<TaskRun[]>(
    resolveTaskBackendId(taskId, backendId),
    `/api/task-runs?taskId=${encodeURIComponent(taskId)}&limit=${limit}`,
  );
}
