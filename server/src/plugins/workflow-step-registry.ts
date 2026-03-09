/**
 * Workflow Step Registry
 *
 * Registry for plugin-contributed workflow step types.
 * Follows the same singleton Map pattern as tool-registry.ts.
 */

import type { WorkflowStepHandler, WorkflowStepTypeMeta } from '@my-claudia/shared';
import { pluginLoader } from './loader.js';

// ============================================
// Types
// ============================================

export interface WorkflowStepMeta {
  /** Full namespaced ID: pluginId/stepId */
  type: string;
  /** Display name */
  name: string;
  /** Description */
  description: string;
  /** Category for UI grouping */
  category: string;
  /** Icon name */
  icon?: string;
  /** JSON Schema for config */
  configSchema?: Record<string, unknown>;
  /** Step handler function */
  handler: WorkflowStepHandler;
  /** Plugin ID that registered this step */
  pluginId: string;
}

// ============================================
// Registry
// ============================================

class WorkflowStepRegistry {
  private steps = new Map<string, WorkflowStepMeta>();

  /**
   * Register a workflow step type.
   * If a step with the same type exists, it will be overwritten with a warning.
   */
  register(meta: WorkflowStepMeta): void {
    if (this.steps.has(meta.type)) {
      console.warn(
        `[WorkflowStepRegistry] Step "${meta.type}" already registered. Overwriting.`
      );
    }
    this.steps.set(meta.type, meta);
  }

  /**
   * Unregister a step type.
   */
  unregister(type: string): boolean {
    return this.steps.delete(type);
  }

  /**
   * Get a step's metadata by type.
   */
  get(type: string): WorkflowStepMeta | undefined {
    return this.steps.get(type);
  }

  /**
   * Check if a step type exists.
   */
  has(type: string): boolean {
    return this.steps.has(type);
  }

  /**
   * Get all registered step metadata.
   */
  getAll(): WorkflowStepMeta[] {
    return Array.from(this.steps.values());
  }

  /**
   * Get serializable metadata for the REST API (no handler function).
   */
  getAllMeta(): WorkflowStepTypeMeta[] {
    return this.getAll().map((s) => ({
      type: s.type,
      name: s.name,
      description: s.description,
      category: s.category,
      icon: s.icon,
      configSchema: s.configSchema,
      source: s.pluginId,
    }));
  }

  /**
   * Get all steps registered by a specific plugin.
   */
  getByPlugin(pluginId: string): WorkflowStepMeta[] {
    return Array.from(this.steps.values()).filter((s) => s.pluginId === pluginId);
  }

  /**
   * Clear all steps registered by a specific plugin.
   */
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

  /**
   * Execute a plugin step handler with permission checking and error handling.
   */
  async execute(
    type: string,
    config: Record<string, unknown>,
    context: {
      projectId: string;
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

    // Lazy permission check
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

  /**
   * Get the number of registered steps.
   */
  get size(): number {
    return this.steps.size;
  }

  /**
   * Clear all registered steps (mainly for testing).
   */
  clear(): void {
    this.steps.clear();
  }
}

// ============================================
// Singleton Export
// ============================================

export const workflowStepRegistry = new WorkflowStepRegistry();
