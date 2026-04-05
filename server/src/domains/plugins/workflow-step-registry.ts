/**
 * Workflow Step Registry
 *
 * Registry for plugin-contributed workflow step types.
 * Follows the same singleton Map pattern as tool-registry.ts.
 */

import type { WorkflowStepHandler, WorkflowStepTypeMeta } from '@my-claudia/shared';
import { pluginLoader } from './loader.js';

export interface WorkflowStepMeta {
  type: string;
  name: string;
  description: string;
  category: string;
  icon?: string;
  configSchema?: Record<string, unknown>;
  handler: WorkflowStepHandler;
  pluginId: string;
}

class WorkflowStepRegistry {
  private steps = new Map<string, WorkflowStepMeta>();

  register(meta: WorkflowStepMeta): void {
    if (this.steps.has(meta.type)) {
      console.warn(
        `[WorkflowStepRegistry] Step "${meta.type}" already registered. Overwriting.`
      );
    }
    this.steps.set(meta.type, meta);
  }

  unregister(type: string): boolean {
    return this.steps.delete(type);
  }

  get(type: string): WorkflowStepMeta | undefined {
    return this.steps.get(type);
  }

  has(type: string): boolean {
    return this.steps.has(type);
  }

  getAll(): WorkflowStepMeta[] {
    return Array.from(this.steps.values());
  }

  getAllMeta(): WorkflowStepTypeMeta[] {
    return this.getAll().map((step) => ({
      type: step.type,
      name: step.name,
      description: step.description,
      category: step.category,
      icon: step.icon,
      configSchema: step.configSchema,
      source: step.pluginId,
    }));
  }

  getByPlugin(pluginId: string): WorkflowStepMeta[] {
    return Array.from(this.steps.values()).filter((step) => step.pluginId === pluginId);
  }

  clearByPlugin(pluginId: string): number {
    let count = 0;
    for (const [type, step] of this.steps) {
      if (step.pluginId === pluginId) {
        this.steps.delete(type);
        count++;
      }
    }
    return count;
  }

  async execute(
    type: string,
    config: Record<string, unknown>,
    context: {
      projectId?: string;
      projectRootPath?: string;
      providerId?: string;
      stepRunId: string;
      runId: string;
    },
  ): Promise<{ status: 'completed' | 'failed'; output: Record<string, unknown>; error?: string }> {
    const step = this.steps.get(type);
    if (!step) {
      return { status: 'failed', output: {}, error: `Unknown plugin step type: ${type}` };
    }

    if (step.pluginId) {
      const permitted = await pluginLoader.checkPermissions(step.pluginId);
      if (!permitted) {
        return { status: 'failed', output: {}, error: `Plugin "${step.pluginId}" permissions denied` };
      }
    }

    try {
      return await step.handler(config, context);
    } catch (err) {
      return {
        status: 'failed',
        output: {},
        error: `Plugin step execution failed: ${err instanceof Error ? err.message : String(err)}`,
      };
    }
  }

  get size(): number {
    return this.steps.size;
  }

  clear(): void {
    this.steps.clear();
  }
}

export const workflowStepRegistry = new WorkflowStepRegistry();
