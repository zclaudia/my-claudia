import type { Project, Workflow } from '@my-claudia/shared';
import type { SelectOption } from '../../components/ui/Select';

export type ProjectInfo = Pick<Project, 'id' | 'name' | 'permissionWorkflowOverrideId'>;

export interface AgentConfigInfo {
  permissionWorkflowOverrideId: string | null;
}

export interface AutomationItem {
  id: string;
  name: string;
  description?: string;
  enabled: boolean;
  projectId?: string;
  triggerSummary: string;
  actionSummary: string;
  source: 'workflow';
  status: string;
  runCount: number;
  lastError?: string;
}

export function isInternalProject(name: string): boolean {
  return name.startsWith('__');
}

export function displayProjectName(name: string): string {
  if (!isInternalProject(name)) return name;
  const stripped = name.replace(/^_+/, '');
  return stripped.charAt(0).toUpperCase() + stripped.slice(1);
}

export function projectSelectOptions(projects: ProjectInfo[]): SelectOption[] {
  const internal = projects.filter(p => isInternalProject(p.name));
  const normal = projects.filter(p => !isInternalProject(p.name)).sort((a, b) => a.name.localeCompare(b.name));
  return [
    ...internal.map(p => ({ value: p.id, label: `\u25C8 ${displayProjectName(p.name)} (Global)` })),
    ...normal.map(p => ({ value: p.id, label: `\u25B8 ${p.name}` })),
  ];
}

export function formatInterval(ms: number): string {
  if (ms < 60000) return `${Math.round(ms / 1000)}s`;
  if (ms < 3600000) return `${Math.round(ms / 60000)}m`;
  return `${Math.round(ms / 3600000)}h`;
}

export const CATEGORY_COLORS: Record<string, string> = {
  ai: 'bg-primary/15 text-primary',
  git: 'bg-success/15 text-success',
  maintenance: 'bg-warning/15 text-warning',
  quality: 'bg-thinking/15 text-thinking',
  scheduling: 'bg-primary/15 text-primary',
  sync: 'bg-success/15 text-success',
  supervision: 'bg-thinking/15 text-thinking',
  plugin: 'bg-muted text-muted-foreground',
};

export function simpleWorkflowToItem(w: Workflow): AutomationItem {
  const trigger = w.definition.triggers[0];
  const node = w.definition.nodes[0];
  const triggerSummary = !trigger ? 'manual'
    : trigger.type === 'cron' ? `cron: ${trigger.cron}`
    : trigger.type === 'interval' ? `every ${trigger.intervalMinutes}m`
    : trigger.type === 'once' ? 'once'
    : trigger.type === 'event' ? `event: ${trigger.event}`
    : trigger.type;
  return {
    id: w.id,
    name: w.name,
    description: w.description,
    enabled: w.status === 'active',
    projectId: w.projectId,
    triggerSummary,
    actionSummary: node?.type ?? 'unknown',
    source: 'workflow',
    status: w.status === 'active' ? 'idle' : 'disabled',
    runCount: 0,
  };
}
