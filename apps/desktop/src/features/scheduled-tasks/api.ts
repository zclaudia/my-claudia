import type { ScheduledTask, ScheduledTaskTemplate, SystemTaskInfo, TaskRun } from '@my-claudia/shared';
import { apiCall, apiCallVoid } from '../../services/api/unwrap';

export async function listScheduledTasks(projectId: string): Promise<ScheduledTask[]> {
  return apiCall<ScheduledTask[]>(`/api/projects/${projectId}/scheduled-tasks`);
}

export async function listGlobalScheduledTasks(): Promise<ScheduledTask[]> {
  return apiCall<ScheduledTask[]>('/api/scheduled-tasks/global');
}

export async function createScheduledTask(projectId: string | undefined, data: Partial<ScheduledTask>): Promise<ScheduledTask> {
  const path = projectId
    ? `/api/projects/${projectId}/scheduled-tasks`
    : '/api/scheduled-tasks/global';
  return apiCall<ScheduledTask>(path, {
    method: 'POST',
    body: JSON.stringify(data),
  });
}

export async function updateScheduledTask(taskId: string, data: Partial<ScheduledTask>): Promise<ScheduledTask> {
  return apiCall<ScheduledTask>(`/api/scheduled-tasks/${taskId}`, {
    method: 'PATCH',
    body: JSON.stringify(data),
  });
}

export async function deleteScheduledTask(taskId: string): Promise<void> {
  return apiCallVoid(`/api/scheduled-tasks/${taskId}`, { method: 'DELETE' });
}

export async function triggerScheduledTask(taskId: string): Promise<ScheduledTask> {
  return apiCall<ScheduledTask>(`/api/scheduled-tasks/${taskId}/trigger`, { method: 'POST' });
}

export async function listScheduledTaskTemplates(): Promise<ScheduledTaskTemplate[]> {
  return apiCall<ScheduledTaskTemplate[]>('/api/scheduled-task-templates');
}

export async function enableTemplateTask(projectId: string, templateId: string): Promise<ScheduledTask> {
  return apiCall<ScheduledTask>(
    `/api/projects/${projectId}/scheduled-tasks/from-template/${templateId}`,
    { method: 'POST' },
  );
}

// System Tasks & Task Run History

export async function listSystemTasks(): Promise<SystemTaskInfo[]> {
  return apiCall<SystemTaskInfo[]>('/api/system-tasks');
}

export async function listTaskRuns(taskId: string, limit: number = 50): Promise<TaskRun[]> {
  return apiCall<TaskRun[]>(`/api/task-runs?taskId=${encodeURIComponent(taskId)}&limit=${limit}`);
}
