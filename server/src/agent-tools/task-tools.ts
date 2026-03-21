/**
 * Agent task orchestration tools — spawn/steer/kill/list/get_result.
 * Registered to toolRegistry with scope 'agent-assistant'.
 */

import { toolRegistry } from '../plugins/tool-registry.js';
import type { TaskOrchestrator } from '../orchestration/types.js';

export function registerTaskTools(orchestrator: TaskOrchestrator): void {
  // ============================================
  // spawn_task — create a sub-task
  // ============================================
  toolRegistry.register({
    id: 'spawn_task',
    source: 'interaction',
    scope: ['agent-assistant'],
    definition: {
      type: 'function',
      function: {
        name: 'spawn_task',
        description: 'Create a sub-task that runs in a separate background session. The sub-task has access to the same project and tools.',
        parameters: {
          type: 'object',
          properties: {
            task: { type: 'string', description: 'Task description / prompt for the sub-agent' },
            wait: { type: 'boolean', description: 'If true, block until the task completes and return the result. Default: false.' },
            depends_on: { type: 'array', items: { type: 'string' }, description: 'Task IDs that must complete before this task starts' },
          },
          required: ['task'],
        },
      },
    },
    handler: async (args, context) => {
      const sessionId = context?.sessionId as string | undefined;
      let projectId: string | undefined;
      if (sessionId) {
        // Resolve project from session — imported dynamically to avoid circular deps
        const db = (globalThis as any).__orchestratorDb;
        if (db) {
          const row = db.prepare('SELECT project_id FROM sessions WHERE id = ?').get(sessionId) as { project_id: string } | undefined;
          projectId = row?.project_id;
        }
      }

      const taskId = await orchestrator.spawnTask(null, {
        task: args.task as string,
        projectId,
        contextTemplate: 'agent',
        dependsOn: args.depends_on as string[] | undefined,
      });

      if (args.wait) {
        const result = await orchestrator.waitForTask(taskId, 10 * 60 * 1000);
        return JSON.stringify(result);
      }

      return JSON.stringify({ taskId, status: 'spawned' });
    },
  });

  // ============================================
  // steer_task — inject instruction into running task
  // ============================================
  toolRegistry.register({
    id: 'steer_task',
    source: 'interaction',
    scope: ['agent-assistant'],
    definition: {
      type: 'function',
      function: {
        name: 'steer_task',
        description: 'Send additional instructions to a running task.',
        parameters: {
          type: 'object',
          properties: {
            task_id: { type: 'string', description: 'ID of the task to steer' },
            instruction: { type: 'string', description: 'New instruction to inject' },
          },
          required: ['task_id', 'instruction'],
        },
      },
    },
    handler: async (args) => {
      try {
        await orchestrator.steerTask(args.task_id as string, args.instruction as string);
        return JSON.stringify({ success: true });
      } catch (err: any) {
        return JSON.stringify({ error: err.message });
      }
    },
  });

  // ============================================
  // kill_task — terminate a task
  // ============================================
  toolRegistry.register({
    id: 'kill_task',
    source: 'interaction',
    scope: ['agent-assistant'],
    definition: {
      type: 'function',
      function: {
        name: 'kill_task',
        description: 'Terminate a running or queued task.',
        parameters: {
          type: 'object',
          properties: {
            task_id: { type: 'string', description: 'ID of the task to kill' },
          },
          required: ['task_id'],
        },
      },
    },
    handler: async (args) => {
      try {
        await orchestrator.killTask(args.task_id as string);
        return JSON.stringify({ success: true, killed: args.task_id });
      } catch (err: any) {
        return JSON.stringify({ error: err.message });
      }
    },
  });

  // ============================================
  // list_tasks — list tasks and their statuses
  // ============================================
  toolRegistry.register({
    id: 'list_tasks',
    source: 'interaction',
    scope: ['agent-assistant'],
    definition: {
      type: 'function',
      function: {
        name: 'list_tasks',
        description: 'List current tasks and their statuses. Optionally filter by parent task ID.',
        parameters: {
          type: 'object',
          properties: {
            parent_id: { type: 'string', description: 'Parent task ID to filter by (omit for root tasks)' },
          },
        },
      },
    },
    handler: async (args) => {
      const tasks = orchestrator.listTasks(args.parent_id as string | undefined);
      return JSON.stringify(tasks.map(t => ({
        id: t.id,
        kind: t.kind,
        status: t.status,
        task: t.task.slice(0, 200),
        createdAt: t.createdAt,
        startedAt: t.startedAt,
        completedAt: t.completedAt,
      })));
    },
  });

  // ============================================
  // get_task_result — get task result (optionally wait)
  // ============================================
  toolRegistry.register({
    id: 'get_task_result',
    source: 'interaction',
    scope: ['agent-assistant'],
    definition: {
      type: 'function',
      function: {
        name: 'get_task_result',
        description: 'Get the result of a task. If wait=true, blocks until the task completes (up to 10 minutes).',
        parameters: {
          type: 'object',
          properties: {
            task_id: { type: 'string', description: 'ID of the task' },
            wait: { type: 'boolean', description: 'If true, block until the task settles. Default: false.' },
          },
          required: ['task_id'],
        },
      },
    },
    handler: async (args) => {
      try {
        if (args.wait) {
          const result = await orchestrator.waitForTask(args.task_id as string, 10 * 60 * 1000);
          return JSON.stringify(result);
        }
        const result = await orchestrator.getTaskResult(args.task_id as string);
        return JSON.stringify(result);
      } catch (err: any) {
        return JSON.stringify({ error: err.message });
      }
    },
  });
}
