// Scheduled Task Types

export type ScheduleType = 'cron' | 'interval' | 'once';
export type ScheduledActionType = 'prompt' | 'command' | 'shell' | 'webhook' | 'plugin_event' | 'agent_task';
export type ScheduledTaskStatus = 'idle' | 'running' | 'error';

export interface PromptActionConfig {
  prompt: string;
  providerId?: string;
  sessionName?: string;
}

export interface CommandActionConfig {
  command: string;
}

export interface ShellActionConfig {
  command: string;
  cwd?: string;
  timeoutMs?: number;
}

export interface WebhookActionConfig {
  url: string;
  method?: 'GET' | 'POST' | 'PUT';
  headers?: Record<string, string>;
  body?: string;
}

export interface PluginEventActionConfig {
  event: string;
  data?: Record<string, unknown>;
}

export interface AgentTaskActionConfig {
  promptTemplate: string;
  providerId?: string;
  contextTemplate?: string;
  feedDelivery?: boolean;
  notifyDelivery?: boolean;
}

export type ActionConfig =
  | PromptActionConfig
  | CommandActionConfig
  | ShellActionConfig
  | WebhookActionConfig
  | PluginEventActionConfig
  | AgentTaskActionConfig;

export interface ScheduledTask {
  id: string;
  projectId?: string;
  name: string;
  description?: string;
  enabled: boolean;
  scheduleType: ScheduleType;
  scheduleCron?: string;
  scheduleIntervalMinutes?: number;
  scheduleOnceAt?: number;
  nextRun?: number;
  actionType: ScheduledActionType;
  actionConfig: ActionConfig;
  status: ScheduledTaskStatus;
  lastRunAt?: number;
  lastRunResult?: string;
  lastError?: string;
  runCount: number;
  templateId?: string;
  createdAt: number;
  updatedAt: number;
}

export interface ScheduledTaskTemplate {
  id: string;
  name: string;
  description: string;
  category: 'ai' | 'git' | 'maintenance' | 'quality';
  scheduleType: ScheduleType;
  defaultSchedule: { cron?: string; intervalMinutes?: number };
  actionType: ScheduledActionType;
  defaultActionConfig: ActionConfig;
}

// Task Run History

export type TaskRunStatus = 'running' | 'completed' | 'failed';
export type TaskSource = 'user' | 'system';

export interface TaskRun {
  id: string;
  taskId: string;
  taskSource: TaskSource;
  status: TaskRunStatus;
  startedAt: number;
  completedAt?: number;
  durationMs?: number;
  result?: string;
  error?: string;
  createdAt: number;
}
