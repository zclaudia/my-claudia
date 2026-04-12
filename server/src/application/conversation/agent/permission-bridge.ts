/**
 * Permission Bridge — connects the workflow engine to the conversation permission system.
 *
 * When a permission request is escalated and a permission workflow is active,
 * the bridge holds the pending Promise and allows the workflow's `permission_decide`
 * step to resolve it.
 */

import type { PermissionDecision } from '../../../infrastructure/providers/types.js';
import type {
  PermissionBridgePort,
  PermissionEscalationContext,
} from '../../../domains/workflows/ports/step-executor.js';

interface PendingEntry {
  resolve: (decision: PermissionDecision) => void;
  context: PermissionEscalationContext;
  workflowRunId?: string;
}

export class PermissionBridge implements PermissionBridgePort {
  private pending = new Map<string, PendingEntry>();

  /**
   * Register a pending permission request that will be resolved by a workflow.
   */
  register(
    requestId: string,
    resolve: (decision: PermissionDecision) => void,
    context: PermissionEscalationContext,
  ): void {
    this.pending.set(requestId, { resolve, context });
  }

  /**
   * Associate a workflow run ID with a pending request (for cancellation tracking).
   */
  setWorkflowRunId(requestId: string, workflowRunId: string): void {
    const entry = this.pending.get(requestId);
    if (entry) {
      entry.workflowRunId = workflowRunId;
    }
  }

  /**
   * Get the workflow run ID for a pending request (for cancellation).
   */
  getWorkflowRunId(requestId: string): string | undefined {
    return this.pending.get(requestId)?.workflowRunId;
  }

  /**
   * Resolve a pending permission via workflow decision.
   * Returns false if the requestId is not found (already resolved by user).
   */
  resolvePermission(requestId: string, decision: 'allow' | 'deny', reason?: string): boolean {
    const entry = this.pending.get(requestId);
    if (!entry) return false;

    this.pending.delete(requestId);
    entry.resolve({
      behavior: decision,
      message: decision === 'deny' ? (reason || 'Denied by permission workflow') : undefined,
      updatedInput: decision === 'allow' ? entry.context.toolInput : undefined,
    });
    return true;
  }

  /**
   * Get the escalation context for a pending request.
   */
  getPermissionContext(requestId: string): PermissionEscalationContext | undefined {
    return this.pending.get(requestId)?.context;
  }

  /**
   * Check if a request is still pending.
   */
  isPending(requestId: string): boolean {
    return this.pending.has(requestId);
  }

  /**
   * Remove a pending request without resolving (e.g., user manually decided).
   */
  remove(requestId: string): boolean {
    return this.pending.delete(requestId);
  }

  /**
   * Remove a pending request and return its workflow run ID (for cancellation).
   * Used when the user manually decides — the associated workflow should be cancelled.
   */
  removeAndGetWorkflowRunId(requestId: string): string | undefined {
    const entry = this.pending.get(requestId);
    if (!entry) return undefined;
    const wfRunId = entry.workflowRunId;
    this.pending.delete(requestId);
    return wfRunId;
  }

  /**
   * Clear all pending entries (e.g., run ended).
   */
  clear(): void {
    this.pending.clear();
  }
}
