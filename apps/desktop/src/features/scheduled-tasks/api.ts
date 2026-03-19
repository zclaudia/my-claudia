import type { ScheduledTask, ScheduledTaskTemplate, SystemTaskInfo, TaskRun } from '@my-claudia/shared';
import { fetchApi } from '../../services/api/base';

export async function listScheduledTasks(projectId: string): Promise<ScheduledTask[]> {
  const result = await fetchApi<ScheduledTask[]>(`/api/projects/${projectId}/scheduled-tasks`);
  if (!result.success || !result.data) throw new Error(result.error?.message || 'Failed to list scheduled tasks');
  return result.data;
}

export async function listGlobalScheduledTasks(): Promise<ScheduledTask[]> {
  const result = await fetchApi<ScheduledTask[]>('/api/scheduled-tasks/global');
  if (!result.success || !result.data) throw new Error(result.error?.message || 'Failed to list global tasks');
  return result.data;
}

export async function createScheduledTask(projectId: string | undefined, data: Partial<ScheduledTask>): Promise<ScheduledTask> {
  const path = projectId
    ? `/api/projects/${projectId}/scheduled-tasks`
    : '/api/scheduled-tasks/global';
  const result = await fetchApi<ScheduledTask>(path, {
    method: 'POST',
    body: JSON.stringify(data),
  });
  if (!result.success || !result.data) throw new Error(result.error?.message || 'Failed to create scheduled task');
  return result.data;
}

export async function updateScheduledTask(taskId: string, data: Partial<ScheduledTask>): Promise<ScheduledTask> {
  const result = await fetchApi<ScheduledTask>(`/api/scheduled-tasks/${taskId}`, {
    method: 'PATCH',
    body: JSON.stringify(data),
  });
  if (!result.success || !result.data) throw new Error(result.error?.message || 'Failed to update scheduled task');
  return result.data;
}

export async function deleteScheduledTask(taskId: string): Promise<void> {
  const result = await fetchApi<void>(`/api/scheduled-tasks/${taskId}`, { method: 'DELETE' });
  if (!result.success) throw new Error(result.error?.message || 'Failed to delete scheduled task');
}

export async function triggerScheduledTask(taskId: string): Promise<ScheduledTask> {
  const result = await fetchApi<ScheduledTask>(`/api/scheduled-tasks/${taskId}/trigger`, { method: 'POST' });
  if (!result.success || !result.data) throw new Error(result.error?.message || 'Failed to trigger task');
  return result.data;
}

export async function listScheduledTaskTemplates(): Promise<ScheduledTaskTemplate[]> {
  const result = await fetchApi<ScheduledTaskTemplate[]>('/api/scheduled-task-templates');
  if (!result.success || !result.data) throw new Error(result.error?.message || 'Failed to list templates');
  return result.data;
}

export async function enableTemplateTask(projectId: string, templateId: string): Promise<ScheduledTask> {
  const result = await fetchApi<ScheduledTask>(
    `/api/projects/${projectId}/scheduled-tasks/from-template/${templateId}`,
    { method: 'POST' },
  );
  if (!result.success || !result.data) throw new Error(result.error?.message || 'Failed to enable template');
  return result.data;
}

// System Tasks & Task Run History

export async function listSystemTasks(): Promise<SystemTaskInfo[]> {
  const result = await fetchApi<SystemTaskInfo[]>('/api/system-tasks');
  if (!result.success || !result.data) throw new Error(result.error?.message || 'Failed to list system tasks');
  return result.data;
}

export async function listTaskRuns(taskId: string, limit: number = 50): Promise<TaskRun[]> {
  const result = await fetchApi<TaskRun[]>(`/api/task-runs?taskId=${encodeURIComponent(taskId)}&limit=${limit}`);
  if (!result.success || !result.data) throw new Error(result.error?.message || 'Failed to list task runs');
  return result.data;
}
