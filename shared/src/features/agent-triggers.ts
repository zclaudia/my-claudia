// Agent Trigger Types — event-driven and scheduled agent task triggers

import type { ScheduleType } from './scheduled-tasks.js';

export interface AgentTrigger {
  id: string;
  name: string;
  description?: string;
  enabled: boolean;

  /** What fires it */
  triggerType: 'event' | 'schedule' | 'both';
  eventPattern?: string;            // glob/regex on pluginEvent name
  eventFilter?: Record<string, unknown>;
  scheduleType?: ScheduleType;
  scheduleCron?: string;
  scheduleIntervalMinutes?: number;

  /** What it does */
  promptTemplate: string;           // "Summarize: {{event.text}}"
  providerId?: string;
  projectId?: string;
  contextTemplate?: string;         // 'agent' | 'coding' | custom

  /** Delivery */
  feedDelivery: boolean;
  notifyDelivery: boolean;

  /** Metadata */
  sourcePluginId?: string;
  createdAt: number;
  updatedAt: number;
}
