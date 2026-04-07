/**
 * Workflow Trigger Source Registry
 *
 * Registry for plugin-contributed (and built-in) workflow trigger sources.
 * Follows the same singleton Map pattern as workflow-step-registry.ts.
 */

import type { WorkflowTriggerSourceMeta } from '@my-claudia/shared/features/workflows';

class WorkflowTriggerSourceRegistry {
  private sources = new Map<string, WorkflowTriggerSourceMeta>();

  register(meta: WorkflowTriggerSourceMeta): void {
    if (this.sources.has(meta.id)) {
      console.warn(
        `[WorkflowTriggerRegistry] Source "${meta.id}" already registered. Overwriting.`
      );
    }
    this.sources.set(meta.id, meta);
  }

  unregister(id: string): boolean {
    return this.sources.delete(id);
  }

  get(id: string): WorkflowTriggerSourceMeta | undefined {
    return this.sources.get(id);
  }

  has(id: string): boolean {
    return this.sources.has(id);
  }

  getAll(): WorkflowTriggerSourceMeta[] {
    return Array.from(this.sources.values());
  }

  getByPlugin(pluginId: string): WorkflowTriggerSourceMeta[] {
    return Array.from(this.sources.values()).filter((source) => source.source === pluginId);
  }

  clearByPlugin(pluginId: string): number {
    let count = 0;
    for (const [id, source] of this.sources) {
      if (source.source === pluginId) {
        this.sources.delete(id);
        count++;
      }
    }
    return count;
  }

  get size(): number {
    return this.sources.size;
  }

  clear(): void {
    this.sources.clear();
  }
}

export const workflowTriggerRegistry = new WorkflowTriggerSourceRegistry();

const BUILTIN_SOURCES: WorkflowTriggerSourceMeta[] = [
  {
    id: 'builtin/run.started',
    name: 'Run Started',
    description: 'Fires when a Claude session run starts',
    eventPattern: 'run.started',
    category: 'Run Events',
    source: 'builtin',
  },
  {
    id: 'builtin/run.completed',
    name: 'Run Completed',
    description: 'Fires when a Claude session run completes successfully',
    eventPattern: 'run.completed',
    category: 'Run Events',
    source: 'builtin',
  },
  {
    id: 'builtin/run.failed',
    name: 'Run Failed',
    description: 'Fires when a Claude session run fails',
    eventPattern: 'run.error',
    category: 'Run Events',
    source: 'builtin',
  },
  {
    id: 'builtin/run.toolCall',
    name: 'Tool Called',
    description: 'Fires when a tool is called during a run',
    eventPattern: 'run.toolCall',
    category: 'Run Events',
    source: 'builtin',
  },
  {
    id: 'builtin/session.created',
    name: 'Session Created',
    description: 'Fires when a new session is created',
    eventPattern: 'session.created',
    category: 'Session Events',
    source: 'builtin',
  },
  {
    id: 'builtin/session.deleted',
    name: 'Session Deleted',
    description: 'Fires when a session is deleted',
    eventPattern: 'session.deleted',
    category: 'Session Events',
    source: 'builtin',
  },
  {
    id: 'builtin/session.archived',
    name: 'Session Archived',
    description: 'Fires when a session is archived',
    eventPattern: 'session.archived',
    category: 'Session Events',
    source: 'builtin',
  },
  {
    id: 'builtin/plugin.activated',
    name: 'Plugin Activated',
    description: 'Fires when a plugin is activated',
    eventPattern: 'plugin.activated',
    category: 'Plugin Events',
    source: 'builtin',
  },
  {
    id: 'builtin/plugin.deactivated',
    name: 'Plugin Deactivated',
    description: 'Fires when a plugin is deactivated',
    eventPattern: 'plugin.deactivated',
    category: 'Plugin Events',
    source: 'builtin',
  },
  {
    id: 'builtin/plugin.error',
    name: 'Plugin Error',
    description: 'Fires when a plugin encounters an error',
    eventPattern: 'plugin.error',
    category: 'Plugin Events',
    source: 'builtin',
  },
  {
    id: 'builtin/project.opened',
    name: 'Project Opened',
    description: 'Fires when a project is opened',
    eventPattern: 'project.opened',
    category: 'Project Events',
    source: 'builtin',
  },
  {
    id: 'builtin/project.closed',
    name: 'Project Closed',
    description: 'Fires when a project is closed',
    eventPattern: 'project.closed',
    category: 'Project Events',
    source: 'builtin',
  },
  {
    id: 'builtin/run.*',
    name: 'Any Run Event',
    description: 'Fires on any run-related event (run.started, run.completed, etc.)',
    eventPattern: 'run.*',
    category: 'Run Events',
    source: 'builtin',
  },
  {
    id: 'builtin/session.*',
    name: 'Any Session Event',
    description: 'Fires on any session-related event',
    eventPattern: 'session.*',
    category: 'Session Events',
    source: 'builtin',
  },
];

for (const source of BUILTIN_SOURCES) {
  workflowTriggerRegistry.register(source);
}
